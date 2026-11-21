use gif::{DecodeOptions, Repeat};
use image::codecs::{jpeg::JpegDecoder, png::PngDecoder};
use image::{DynamicImage, ImageDecoder, ImageFormat, Limits};
use image_webp::{ColorType, WebPEncoder};
use std::cell::RefCell;
use std::io::Cursor;

const MAX_INPUT_BYTES: usize = 16_000_000;
const MAX_PIXELS: u64 = 12_500_000;
const MAX_EDGE: u32 = 8192;
const MAX_GIF_PIXELS: u64 = 24_000_000;
const MAX_GIF_FRAMES: u32 = 240;
const MAX_OUTPUT_BYTES: usize = 64_000_000;

#[derive(Debug, PartialEq, Eq)]
#[repr(u32)]
enum Failure {
    Format = 1,
    Decode = 2,
    Limit = 3,
    Encode = 4,
}

thread_local! {
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

// The worker copies the selected file into this buffer before calling convert.
#[unsafe(no_mangle)]
pub extern "C" fn prepare_input(length: usize) -> *mut u8 {
    if length == 0 || length > MAX_INPUT_BYTES {
        return std::ptr::null_mut();
    }
    INPUT.with_borrow_mut(|input| {
        input.resize(length, 0);
        input.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn convert() -> u32 {
    let input = INPUT.with_borrow_mut(std::mem::take);
    let result = convert_file(&input);
    OUTPUT.with_borrow_mut(|output| match result {
        Ok(bytes) => {
            *output = bytes;
            0
        }
        Err(error) => {
            output.clear();
            error as u32
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn output_pointer() -> *const u8 {
    OUTPUT.with_borrow(|output| output.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn output_length() -> usize {
    OUTPUT.with_borrow(Vec::len)
}

fn convert_file(input: &[u8]) -> Result<Vec<u8>, Failure> {
    if input.len() > MAX_INPUT_BYTES {
        return Err(Failure::Limit);
    }
    let mut limits = Limits::default();
    limits.max_alloc = Some(128_000_000);
    match image::guess_format(input).map_err(|_| Failure::Format)? {
        ImageFormat::Jpeg => {
            let decoder = JpegDecoder::new(Cursor::new(input)).map_err(decode_error)?;
            encode_still(decoder, limits)
        }
        ImageFormat::Png => {
            let decoder = PngDecoder::with_limits(Cursor::new(input), limits.clone())
                .map_err(decode_error)?;
            if decoder.is_apng().map_err(decode_error)? {
                return Err(Failure::Format);
            }
            encode_still(decoder, limits)
        }
        ImageFormat::Gif => encode_gif(input),
        _ => Err(Failure::Format),
    }
}

fn decode_error(error: image::ImageError) -> Failure {
    match error {
        image::ImageError::Limits(_) => Failure::Limit,
        _ => Failure::Decode,
    }
}

fn canvas_pixels(width: u32, height: u32) -> Result<u64, Failure> {
    let pixels = u64::from(width) * u64::from(height);
    if pixels == 0 || pixels > MAX_PIXELS || width > MAX_EDGE || height > MAX_EDGE {
        return Err(Failure::Limit);
    }
    Ok(pixels)
}

fn encode_still(mut decoder: impl ImageDecoder, limits: Limits) -> Result<Vec<u8>, Failure> {
    let (width, height) = decoder.dimensions();
    canvas_pixels(width, height)?;
    decoder.set_limits(limits).map_err(decode_error)?;
    let orientation = decoder.orientation().map_err(decode_error)?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(decode_error)?;
    image.apply_orientation(orientation);
    let pixels = image.into_rgba8();
    encode_pixels(&pixels, pixels.width(), pixels.height())
}

fn encode_pixels(pixels: &[u8], width: u32, height: u32) -> Result<Vec<u8>, Failure> {
    let mut bytes = Vec::new();
    WebPEncoder::new(&mut bytes)
        .encode(pixels, width, height, ColorType::Rgba8)
        .map_err(|_| Failure::Encode)?;
    Ok(bytes)
}

fn encode_gif(input: &[u8]) -> Result<Vec<u8>, Failure> {
    let mut options = DecodeOptions::new();
    options.check_frame_consistency(true);
    let mut decoder = options.read_info(input).map_err(|_| Failure::Decode)?;
    let (width, height) = (u32::from(decoder.width()), u32::from(decoder.height()));
    let pixels = canvas_pixels(width, height)?;
    let mut screen = gif_dispose::Screen::new_decoder(&decoder);
    let mut rgba = Vec::with_capacity(pixels as usize * 4);
    let mut previous = Vec::new();
    let mut cropped = Vec::new();
    let mut first = None;
    let mut frames = Vec::new();
    let mut count = 0;
    let mut transparent = false;

    while let Some(frame) = decoder.read_next_frame().map_err(|_| Failure::Decode)? {
        count += 1;
        if count > MAX_GIF_FRAMES || pixels * u64::from(count) > MAX_GIF_PIXELS {
            return Err(Failure::Limit);
        }
        screen.blit_frame(frame).map_err(|_| Failure::Decode)?;
        rgba.clear();
        for pixel in screen.pixels_rgba().pixels() {
            rgba.extend_from_slice(&[pixel.r, pixel.g, pixel.b, pixel.a]);
            transparent |= pixel.a != 255;
        }
        let delay = u32::from(frame.delay) * 10;
        let region = changed_region(&previous, &rgba, width, height);
        let frame_pixels = region.pixels(&rgba, width, &mut cropped);
        let encoded = encode_pixels(frame_pixels, region.width, region.height)?;
        std::mem::swap(&mut previous, &mut rgba);
        if count == 1 {
            first = Some((encoded, delay, region));
            continue;
        }
        if let Some((bytes, first_delay, first_region)) = first.take() {
            append_frame(&mut frames, first_region, first_delay, &bytes)?;
        }
        append_frame(&mut frames, region, delay, &encoded)?;
    }

    if let Some((bytes, _, _)) = first {
        return Ok(bytes);
    }
    if frames.is_empty() {
        return Err(Failure::Decode);
    }
    let plays = match decoder.repeat() {
        Repeat::Infinite => 0,
        Repeat::Finite(repetitions) => repetitions.saturating_add(1),
    };
    Ok(wrap_animation(width, height, transparent, plays, &frames))
}

struct Region {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

impl Region {
    fn pixels<'a>(&self, rgba: &'a [u8], canvas_width: u32, out: &'a mut Vec<u8>) -> &'a [u8] {
        let stride = canvas_width as usize * 4;
        let start = (self.y * canvas_width + self.x) as usize * 4;
        let row_bytes = self.width as usize * 4;
        if row_bytes == stride {
            return &rgba[start..start + self.height as usize * stride];
        }
        out.clear();
        for row in 0..self.height as usize {
            let index = start + row * stride;
            out.extend_from_slice(&rgba[index..index + row_bytes]);
        }
        out
    }
}

fn changed_region(previous: &[u8], rgba: &[u8], width: u32, height: u32) -> Region {
    if previous.is_empty() {
        return Region {
            x: 0,
            y: 0,
            width,
            height,
        };
    }
    let (mut left, mut top, mut right, mut bottom) = (width, height, 0, 0);
    for (index, (before, after)) in previous
        .chunks_exact(4)
        .zip(rgba.chunks_exact(4))
        .enumerate()
    {
        if before != after {
            let (x, y) = (index as u32 % width, index as u32 / width);
            left = left.min(x);
            top = top.min(y);
            right = right.max(x + 1);
            bottom = bottom.max(y + 1);
        }
    }
    if right == 0 {
        return Region {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        };
    }
    // WebP encodes frame offsets in units of two pixels.
    let (x, y) = (left & !1, top & !1);
    Region {
        x,
        y,
        width: right - x,
        height: bottom - y,
    }
}

// The no-blend bit replaces the changed region, including transparent pixels.
fn append_frame(
    output: &mut Vec<u8>,
    region: Region,
    delay: u32,
    webp: &[u8],
) -> Result<(), Failure> {
    if webp.get(12..16) != Some(b"VP8L") {
        return Err(Failure::Encode);
    }
    let payload = &webp[12..];
    if output.len() + payload.len() + 24 > MAX_OUTPUT_BYTES {
        return Err(Failure::Limit);
    }
    output.extend_from_slice(b"ANMF");
    output.extend_from_slice(&((16 + payload.len()) as u32).to_le_bytes());
    for value in [
        region.x / 2,
        region.y / 2,
        region.width - 1,
        region.height - 1,
        delay,
    ] {
        output.extend_from_slice(&value.to_le_bytes()[..3]);
    }
    output.push(2);
    output.extend_from_slice(payload);
    Ok(())
}

fn wrap_animation(
    width: u32,
    height: u32,
    transparent: bool,
    plays: u16,
    frames: &[u8],
) -> Vec<u8> {
    let mut output = Vec::with_capacity(44 + frames.len());
    output.extend_from_slice(b"RIFF");
    output.extend_from_slice(&((36 + frames.len()) as u32).to_le_bytes());
    output.extend_from_slice(b"WEBPVP8X");
    output.extend_from_slice(&10_u32.to_le_bytes());
    output.extend_from_slice(&[if transparent { 0x12 } else { 0x02 }, 0, 0, 0]);
    output.extend_from_slice(&(width - 1).to_le_bytes()[..3]);
    output.extend_from_slice(&(height - 1).to_le_bytes()[..3]);
    output.extend_from_slice(b"ANIM");
    output.extend_from_slice(&6_u32.to_le_bytes());
    output.extend_from_slice(&0_u32.to_le_bytes());
    output.extend_from_slice(&plays.to_le_bytes());
    output.extend_from_slice(frames);
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageEncoder;
    use image_webp::{LoopCount, WebPDecoder};
    use std::borrow::Cow;

    #[test]
    fn preserves_png_transparency_and_rejects_unsupported_files() {
        let rgba = [32, 64, 128, 96, 2, 4, 6, 255];
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(&rgba, 2, 1, image::ExtendedColorType::Rgba8)
            .unwrap();
        let webp = convert_file(&png).unwrap();
        let mut decoder = WebPDecoder::new(Cursor::new(webp)).unwrap();
        let mut actual = [0; 8];
        decoder.read_image(&mut actual).unwrap();
        assert_eq!(actual, rgba);
        assert_eq!(convert_file(b"example"), Err(Failure::Format));
        assert_eq!(convert_file(b"GIF89a"), Err(Failure::Decode));
    }

    #[test]
    fn preserves_gif_delays_repeat_count_and_frame_disposal() {
        use gif::{DisposalMethod, Encoder, Frame};
        let mut gif = Vec::new();
        {
            let mut encoder =
                Encoder::new(&mut gif, 2, 1, &[0, 0, 0, 255, 0, 0, 0, 0, 255]).unwrap();
            encoder.set_repeat(Repeat::Finite(2)).unwrap();
            encoder
                .write_frame(&Frame {
                    width: 2,
                    height: 1,
                    delay: 7,
                    transparent: Some(0),
                    dispose: DisposalMethod::Background,
                    buffer: Cow::Borrowed(&[1, 0]),
                    ..Frame::default()
                })
                .unwrap();
            encoder
                .write_frame(&Frame {
                    width: 2,
                    height: 1,
                    delay: 14,
                    transparent: Some(0),
                    dispose: DisposalMethod::Keep,
                    buffer: Cow::Borrowed(&[0, 2]),
                    ..Frame::default()
                })
                .unwrap();
        }
        let webp = convert_file(&gif).unwrap();
        let mut decoder = WebPDecoder::new(Cursor::new(webp)).unwrap();
        assert_eq!(decoder.dimensions(), (2, 1));
        assert_eq!(decoder.num_frames(), 2);
        assert!(matches!(decoder.loop_count(), LoopCount::Times(count) if count.get() == 3));
        let mut actual = [0; 8];
        assert_eq!(decoder.read_frame(&mut actual).unwrap(), 70);
        assert_eq!(actual, [255, 0, 0, 255, 0, 0, 0, 0]);
        assert_eq!(decoder.read_frame(&mut actual).unwrap(), 140);
        assert_eq!(actual, [0, 0, 0, 0, 0, 0, 255, 255]);
    }
}
