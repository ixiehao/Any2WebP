use crate::adjustment::ImageAdjustment;
use crate::video_tools::{find_tools, Tools};
use crate::{check_revision, file_revision, run_process, AppResult};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
};
use tempfile::NamedTempFile;

const MAX_FRAME_BYTES: u64 = 512 * 1024 * 1024;
const MAX_FRAMES: u32 = 600;
const MAX_VIDEO_FPS: u32 = 30;
const DEFAULT_VIDEO_FPS: u32 = 12;

const fn minimum_clip_ms(fps: u32) -> u64 {
    ((1000 + fps / 2) / fps + 1) as u64
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    start_ms: u64,
    end_ms: u64,
    fps: u32,
    edge: u32,
}

pub fn playback_settings(start_ms: u64, end_ms: u64) -> AppResult<Settings> {
    let length = end_ms.checked_sub(start_ms)
        .filter(|length| (minimum_clip_ms(MAX_VIDEO_FPS)..=2000).contains(length))
        .ok_or("ui:invalidTrim")?;
    let fps = if length < minimum_clip_ms(DEFAULT_VIDEO_FPS) { MAX_VIDEO_FPS } else { DEFAULT_VIDEO_FPS };
    Ok(Settings { start_ms, end_ms, fps, edge: 320 })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    format: &'static str,
    duration_ms: u64,
    bytes: u64,
    width: u32,
    height: u32,
    source_fps: f64,
    frame_budget_bytes: u64,
    defaults: Settings,
}

#[derive(Deserialize)]
struct ProbeOutput {
    streams: Vec<Stream>,
    format: Container,
}

#[derive(Deserialize)]
struct Stream {
    index: u32,
    width: u32,
    height: u32,
    codec_name: Option<String>,
    sample_aspect_ratio: Option<String>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    start_time: Option<String>,
    duration: Option<String>,
    #[serde(default)]
    side_data_list: Vec<SideData>,
    #[serde(default)]
    tags: StreamTags,
}

#[derive(Deserialize)]
struct SideData {
    rotation: Option<f64>,
}

#[derive(Default, Deserialize)]
struct StreamTags {
    #[serde(alias = "DURATION", alias = "DURATION-eng")]
    duration: Option<String>,
    #[serde(alias = "ALPHA_MODE")]
    alpha_mode: Option<String>,
}

#[derive(Deserialize)]
struct Container {
    start_time: Option<String>,
    duration: Option<String>,
}

fn video_type(path: &Path) -> Option<(&'static str, &'static str)> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "mp4" => Some(("MP4", "mov")),
        "mov" => Some(("MOV", "mov")),
        "webm" => Some(("WebM", "matroska")),
        _ => None,
    }
}

pub fn is_video(path: &Path) -> bool {
    video_type(path).is_some()
}

fn seconds(raw: Option<&str>) -> Option<f64> {
    raw?.parse().ok().filter(|seconds: &f64| seconds.is_finite())
}

fn timecode(raw: &str) -> Option<f64> {
    let mut parts = raw.split(':');
    let hours = seconds(parts.next())?;
    let minutes = seconds(parts.next())?;
    let secs = seconds(parts.next())?;
    (parts.next().is_none()).then_some(hours * 3600.0 + minutes * 60.0 + secs)
}

fn rate(value: &str) -> Option<f64> {
    let (num, den) = value.split_once('/')?;
    let value = seconds(Some(num))? / seconds(Some(den))?;
    (value.is_finite() && (0.001..=1000.0).contains(&value)).then_some(value)
}

fn display_size(stream: &Stream) -> AppResult<(u32, u32)> {
    if stream.width == 0 || stream.height == 0 {
        return Err("ui:invalidCanvas".into());
    }
    let sar = stream.sample_aspect_ratio.as_deref().and_then(|raw| {
        let (num, den) = raw.split_once(':')?;
        let ratio = seconds(Some(num))? / seconds(Some(den))?;
        (ratio > 0.0 && ratio.is_finite()).then_some(ratio)
    }).unwrap_or(1.0);
    let width = (f64::from(stream.width) * sar).round().clamp(1.0, 1_000_000.0) as u32;
    let rotation = stream.side_data_list.iter().find_map(|side| side.rotation).unwrap_or(0.0);
    let quarter_turn = (rotation.abs().rem_euclid(180.0) - 90.0).abs() < 1.0;
    if quarter_turn {
        Ok((stream.height, width))
    } else {
        Ok((width, stream.height))
    }
}

impl Info {
    fn plan(&self, settings: Settings) -> AppResult<Plan> {
        if settings.end_ms > self.duration_ms || settings.end_ms <= settings.start_ms {
            return Err("ui:invalidTrim".into());
        }
        if !(1..=MAX_VIDEO_FPS).contains(&settings.fps) || !(2..=1920).contains(&settings.edge) {
            return Err("ui:invalidDimensions".into());
        }
        let length = settings.end_ms - settings.start_ms;
        if length > u64::from(MAX_FRAMES) * 1000 {
            return Err("ui:maxFrames".into());
        }
        let fps = u64::from(settings.fps);
        let mut frames = (length * fps).div_ceil(1000);
        // The container stores whole milliseconds. A rounded start at the end
        // of the clip does not represent an additional displayable frame.
        if ((frames - 1) * 1000 + fps / 2) / fps >= length {
            frames -= 1;
        }
        if frames < 2 {
            return Err("ui:minFrames".into());
        }
        let (width, height) = self.scale_to(settings.edge);
        let bytes = u64::from(width) * u64::from(height) * 4 * frames;
        if frames > u64::from(MAX_FRAMES) || bytes > MAX_FRAME_BYTES {
            return Err("ui:maxFrames".into());
        }
        Ok(Plan { width, height, frames: frames as u32, length, bytes })
    }

    fn scale_to(&self, edge: u32) -> (u32, u32) {
        let divisor = u64::from(self.width.max(self.height));
        let scale = |dimension| {
            ((u64::from(dimension) * u64::from(edge) + divisor / 2) / divisor).max(1) as u32
        };
        (scale(self.width), scale(self.height))
    }
}

struct Probed {
    info: Info,
    stream: Stream,
    seek_offset: f64,
    demuxer: &'static str,
}

struct CachedProbe {
    path: PathBuf,
    revision: String,
    tools: Tools,
    source: Arc<Probed>,
}

static PROBE_CACHE: Mutex<Option<CachedProbe>> = Mutex::new(None);

fn inspect(
    cache: &Mutex<Option<CachedProbe>>, path: &Path, tools: &Tools, cancel: Option<&AtomicBool>,
) -> AppResult<Arc<Probed>> {
    if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return Err("ui:cancelled".into());
    }
    let revision = file_revision(path)?;
    if let Some(hit) = cache.lock().unwrap_or_else(|error| error.into_inner()).as_ref()
        .filter(|entry| entry.path == path && entry.revision == revision && entry.tools == *tools)
    {
        return Ok(Arc::clone(&hit.source));
    }
    let source = Arc::new(inspect_uncached(path, tools, cancel)?);
    check_revision(path, &revision)?;
    *cache.lock().unwrap_or_else(|error| error.into_inner()) = Some(CachedProbe {
        path: path.to_owned(), revision, tools: tools.clone(), source: Arc::clone(&source),
    });
    Ok(source)
}

fn inspect_uncached(path: &Path, tools: &Tools, cancel: Option<&AtomicBool>) -> AppResult<Probed> {
    let (format, demuxer) = video_type(path).ok_or("ui:unsupportedVideo")?;
    let mut command = Command::new(tools.ffprobe());
    command
        .args(["-v", "error", "-protocol_whitelist", "file", "-f", demuxer])
        .args([
            "-select_streams", "V:0",
            "-show_entries",
            "stream=index,codec_name,width,height,sample_aspect_ratio,start_time,duration,avg_frame_rate,r_frame_rate:stream_side_data=rotation:stream_tags=DURATION,DURATION-eng,alpha_mode:format=start_time,duration",
            "-of", "json", "-i",
        ])
        .arg(path);
    let output = run_process(command, "ffprobe", 30, cancel)?;
    let mut output: ProbeOutput = serde_json::from_slice(&output).map_err(|_| "ui:invalidVideo")?;
    let stream = output.streams.pop().ok_or("ui:noVideoTrack")?;
    let container_start = seconds(output.format.start_time.as_deref()).unwrap_or(0.0);
    let stream_start = seconds(stream.start_time.as_deref()).unwrap_or(container_start);
    let seek_offset = (stream_start - container_start).max(0.0);
    let duration = seconds(stream.duration.as_deref())
        .or_else(|| stream.tags.duration.as_deref().and_then(timecode).map(|end| end - stream_start))
        .or_else(|| seconds(output.format.duration.as_deref()).map(|length| length - seek_offset))
        .filter(|len| *len >= 0.001 && *len < u64::MAX as f64 / 1000.0)
        .ok_or("ui:noDuration")?;
    let duration_ms = (duration * 1000.0).round() as u64;
    let (width, height) = display_size(&stream)?;
    let source_fps = stream.avg_frame_rate.as_deref().and_then(rate)
        .or_else(|| stream.r_frame_rate.as_deref().and_then(rate)).unwrap_or(30.0);
    let bytes = fs::metadata(path).map_err(|_| "ui:sourceMissing")?.len();
    let defaults = Settings {
        start_ms: 0,
        end_ms: duration_ms.min(3000),
        fps: if duration_ms < minimum_clip_ms(DEFAULT_VIDEO_FPS) { MAX_VIDEO_FPS } else { DEFAULT_VIDEO_FPS },
        edge: width.max(height).clamp(2, 640),
    };
    Ok(Probed {
        info: Info {
            format, duration_ms, bytes, width, height, source_fps,
            frame_budget_bytes: MAX_FRAME_BYTES, defaults,
        },
        stream,
        seek_offset,
        demuxer,
    })
}

impl Probed {
    fn decoder(&self, tools: &Tools, path: &Path, seek: &str) -> Command {
        let mut command = Command::new(tools.ffmpeg());
        // A sparse video can still be displaying a frame from before the
        // preroll. Decode from the keyframe and let the filters sample by PTS.
        command.args([
            "-v", "error", "-nostdin", "-y", "-protocol_whitelist", "file",
            "-filter_threads", "2", "-threads", "2", "-f", self.demuxer,
            "-noaccurate_seek", "-ss", seek,
        ]);
        if self.stream.tags.alpha_mode.as_deref() == Some("1") {
            match self.stream.codec_name.as_deref() {
                Some("vp8") => { command.args(["-c:v", "libvpx"]); }
                Some("vp9") => { command.args(["-c:v", "libvpx-vp9"]); }
                _ => {}
            }
        }
        command.arg("-i").arg(path).args([
            "-map", &format!("0:{}", self.stream.index), "-an", "-sn", "-dn",
        ]);
        command
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationRange {
    start_ms: u64,
    end_ms: u64,
}

pub struct NavigationSource {
    tools: Tools,
    source: Arc<Probed>,
}

impl NavigationSource {
    pub(crate) fn open(path: &Path, tools: Tools, cancel: &AtomicBool) -> AppResult<Self> {
        let source = inspect(&PROBE_CACHE, path, &tools, Some(cancel))?;
        Ok(Self { tools, source })
    }

    fn frame(
        &self, path: &Path, position: u64, width: u32, height: u32, cancel: &AtomicBool,
    ) -> AppResult<Vec<u8>> {
        let time = position.min(self.source.info.duration_ms - 1);
        let preroll = time.min(2000);
        let seek = format!("{:.6}", (time - preroll) as f64 / 1000.0 + self.source.seek_offset);
        let from = format!("{:.3}", preroll as f64 / 1000.0);
        // Use the same previous-visible-frame policy as clip extraction. A single
        // output sample at 0 on a millisecond grid avoids decoding the entire clip.
        let filter = format!(
            "settb=AVTB,setpts=PTS-{from}/TB,tpad=stop_mode=clone:stop=2,fps=fps=1000:start_time=0:round=up:eof_action=pass,scale={width}:{height}:flags=bilinear,setsar=1"
        );
        let mut command = self.source.decoder(&self.tools, path, &seek);
        command.args([
            "-vf", &filter, "-frames:v", "1", "-c:v", "rawvideo", "-threads:v", "1",
            "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1",
        ]);
        let pixels = run_process(command, "FFmpeg", 12, Some(cancel))?;
        if pixels.len() != (width * height * 4) as usize {
            return Err("ui:frameUnavailable".into());
        }
        Ok(pixels)
    }

    pub fn read(
        &self, path: &Path, time: Option<u64>, range: Option<NavigationRange>, cancel: &AtomicBool,
    ) -> AppResult<Vec<u8>> {
        const THUMBNAIL_COUNT: u64 = 8;
        let duration = self.source.info.duration_ms;
        let (edge, times) = match time {
            Some(time) => (480, vec![time]),
            None => {
                let range = range.unwrap_or(NavigationRange { start_ms: 0, end_ms: duration });
                if range.start_ms >= range.end_ms || range.end_ms > duration {
                    return Err("ui:invalidTrim".into());
                }
                let span = range.end_ms - range.start_ms;
                let count = span.min(THUMBNAIL_COUNT);
                let times = (0..count).map(|index| range.start_ms +
                    ((u128::from(span) * (2 * u128::from(index) + 1)) / (2 * u128::from(count))) as u64
                ).collect();
                (112, times)
            }
        };
        let (width, height) = self.source.info.scale_to(edge);
        let count = times.len() as u32;
        let mut buffer = Vec::with_capacity(12 + (width * height * 4 * count) as usize);
        for value in [width, height, count] {
            buffer.extend_from_slice(&value.to_le_bytes());
        }
        for position in times {
            buffer.extend(self.frame(path, position, width, height, cancel)?);
        }
        Ok(buffer)
    }
}

pub fn probe(path: &Path, cancel: Option<&AtomicBool>) -> AppResult<Info> {
    Ok(inspect(&PROBE_CACHE, path, &find_tools(cancel)?, cancel)?.info.clone())
}

struct Plan {
    width: u32,
    height: u32,
    frames: u32,
    length: u64,
    bytes: u64,
}

pub struct Frames {
    raw: NamedTempFile,
    args: [String; 6],
}

impl Frames {
    fn command(&self, operation: &'static str) -> Vec<&Path> {
        let mut args = vec![Path::new(operation), self.raw.path()];
        args.extend(self.args.iter().map(Path::new));
        args
    }

    pub fn preview_adjusted(&self, adjustment: ImageAdjustment, cancel: Option<&AtomicBool>) -> AppResult<Vec<u8>> {
        adjustment.run_codec(&self.command("preview-video"), cancel)
    }

    pub fn encode(
        &self, operation: &'static str, path: &Path, target: &str, adjustment: ImageAdjustment, cancel: &AtomicBool,
    ) -> AppResult<Vec<u8>> {
        let mut args = self.command(operation);
        args.extend([path, Path::new(target)]);
        adjustment.run_codec(&args, Some(cancel))
    }
}

pub fn extract(
    path: &Path,
    settings: Option<Settings>,
    cancel: Option<&AtomicBool>,
) -> AppResult<(Frames, Settings)> {
    let tools = find_tools(cancel)?;
    let source = inspect(&PROBE_CACHE, path, &tools, cancel)?;
    let settings = settings.unwrap_or(source.info.defaults);
    let plan = source.info.plan(settings)?;
    let raw = NamedTempFile::new().map_err(|error| format!("ui:videoTemp:{error}"))?;
    // Preserve the frame already on screen when the cut falls between two
    // source timestamps. Resample after moving the clip origin to time zero.
    let preroll = settings.start_ms.min(2000);
    let seek = format!("{:.6}", (settings.start_ms - preroll) as f64 / 1000.0 + source.seek_offset);
    let from = format!("{:.3}", preroll as f64 / 1000.0);
    let end = format!("{:.3}", (preroll + plan.length) as f64 / 1000.0);
    let filter = format!(
        "trim=end={end},settb=AVTB,setpts=PTS-{from}/TB,fps=fps={}:start_time=0:round=up:eof_action=pass,tpad=stop_mode=clone:stop={},scale={}:{}:flags=lanczos,setsar=1",
        settings.fps, plan.frames, plan.width, plan.height
    );
    let mut command = source.decoder(&tools, path, &seek);
    command.args([
        "-vf", &filter, "-frames:v", &plan.frames.to_string(), "-fps_mode", "passthrough",
        "-c:v", "rawvideo", "-threads:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo",
    ]).arg(raw.path());
    run_process(command, "FFmpeg", 120, cancel)?;
    if raw.as_file().metadata().map_err(|_| "ui:invalidVideo")?.len() != plan.bytes {
        return Err("ui:incompleteVideo".into());
    }
    let args = [
        source.info.format.into(),
        plan.width.to_string(),
        plan.height.to_string(),
        settings.fps.to_string(),
        plan.length.to_string(),
        source.info.bytes.to_string(),
    ];
    Ok((Frames { raw, args }, settings))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{export, run_codec, ImageInfo, OutputFormat};
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    fn source_movie(folder: &Path, extension: &str, codec: &str) -> PathBuf {
        let path = folder.join(format!("双色片.{extension}"));
        let mut command = Command::new(find_tools(None).unwrap().ffmpeg());
        command.args([
            "-v", "error", "-y",
            "-f", "lavfi", "-i", "color=red:s=160x80:r=20:d=1",
            "-f", "lavfi", "-i", "color=blue:s=160x80:r=20:d=1",
            "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0",
            "-c:v", codec, "-threads", "2",
        ]).arg(&path);
        run_process(command, "FFmpeg test fixture", 30, None).unwrap();
        path
    }

    #[test]
    fn repeated_probe_reuses_the_result_until_the_source_changes() {
        let folder = tempfile::tempdir().unwrap();
        let path = source_movie(folder.path(), "mp4", "libx264");
        let tools = find_tools(None).unwrap();
        let cache = Mutex::new(None);
        let first = inspect(&cache, &path, &tools, None).unwrap();
        let second = inspect(&cache, &path, &tools, None).unwrap();
        assert!(Arc::ptr_eq(&first, &second));
        fs::write(&path, "replaced source").unwrap();
        assert!(inspect(&cache, &path, &tools, None).is_err());
    }

    #[test]
    fn shortest_playback_chunk_uses_the_export_rate_limit() {
        assert!(playback_settings(0, 33).is_err());
        assert_eq!(playback_settings(0, 34).unwrap().fps, MAX_VIDEO_FPS);
        assert_eq!(playback_settings(0, 84).unwrap().fps, DEFAULT_VIDEO_FPS);
    }

    fn parse_preview(bytes: &[u8]) -> (u32, u32, u32, Vec<u32>, &[u8]) {
        let val = |index: usize| u32::from_le_bytes(bytes[index*4..index*4+4].try_into().unwrap());
        let frames = val(2);
        let delays = (0..frames as usize).map(|frame| val(10 + frame)).collect();
        (val(0), val(1), frames, delays, &bytes[(10 + frames as usize)*4..])
    }

    #[test]
    fn real_video_formats_preserve_trim_resize_alpha_and_timebase() {
        for (extension, codec) in [("MP4", "libx264"), ("MOV", "prores"), ("WebM", "libvpx-vp9")] {
            let folder = tempfile::tempdir().unwrap();
            let source = source_movie(folder.path(), extension, codec);
            let info = probe(&source, None).unwrap();
            assert_eq!((info.width, info.height, info.duration_ms), (160, 80, 2000));
            let settings = Settings { start_ms: 1200, end_ms: 1930, fps: 13, edge: 101 };
            let (frames, _) = extract(&source, Some(settings), None).unwrap();
            let preview = frames.preview_adjusted(ImageAdjustment::default(), None).unwrap();
            let (width, height, count, delays, pixels) = parse_preview(&preview);
            assert_eq!((width, height, count), (101, 51, 10));
            assert_eq!(delays.iter().sum::<u32>(), 730);
            assert_eq!(delays[0], 77);
            assert!(pixels.chunks_exact(4).all(|pixel| pixel[2] > 220 && pixel[0] < 30 && pixel[3] == 255));
            let result = export(
                source.to_str().unwrap().to_owned(), None, 1024, OutputFormat::Webp, Some(settings), None, ImageAdjustment::default(), Arc::new(AtomicBool::new(false))
            ).unwrap();
            assert_eq!(result.target_met, Some(true));
            assert_eq!(result.video_settings, Some(settings));
            assert_eq!(result.output.delays, delays);
            assert_eq!(result.output.plays, 0);
            assert_eq!(Path::new(&result.path), source.with_extension("webp"));
            let inspected = run_codec(&[Path::new("inspect"), Path::new(&result.path)], None).unwrap();
            let output: ImageInfo = serde_json::from_slice(&inspected).unwrap();
            assert_eq!(output.bytes, fs::metadata(&result.path).unwrap().len());
            let decoded = run_codec(&[Path::new("preview"), Path::new(&result.path)], None).unwrap();
            let (_, _, _, _, encoded_pixels) = parse_preview(&decoded);
            if result.mode == "lossless" {
                assert_eq!(encoded_pixels, pixels);
            }
            let gif = export(
                source.to_str().unwrap().to_owned(), None, 1, OutputFormat::Gif, Some(settings), None,
                ImageAdjustment::default(), Arc::new(AtomicBool::new(false)),
            ).unwrap();
            assert_eq!(Path::new(&gif.path), source.with_extension("gif"));
            assert_eq!(gif.mode, "palette");
            assert_eq!(gif.target_met, Some(false));
            assert_eq!(gif.output.plays, 0);
            let decoded = run_codec(&[Path::new("preview"), Path::new(&gif.path)], None).unwrap();
            let (width, height, count, delays, encoded_pixels) = parse_preview(&decoded);
            assert_eq!((width, height, count), (101, 51, 10));
            assert_eq!(delays.iter().sum::<u32>(), 730);
            assert!(delays.iter().all(|delay| delay % 10 == 0));
            assert_eq!(encoded_pixels, pixels);
        }
    }

    #[test]
    fn filmstrip_and_drag_frame_follow_the_source_timeline() {
        for (extension, codec) in [("mp4", "libx264"), ("mov", "prores"), ("webm", "libvpx-vp9")] {
            let folder = tempfile::tempdir().unwrap();
            let path = source_movie(folder.path(), extension, codec);
            let cancel = AtomicBool::new(false);
            let source = NavigationSource::open(&path, find_tools(None).unwrap(), &cancel).unwrap();

            let strip = source.read(&path, None, None, &cancel).unwrap();
            let thumb = 112 * 56 * 4;
            assert_eq!(strip.len(), 12 + 8 * thumb);
            for (index, pixels) in strip[12..].chunks_exact(thumb).enumerate() {
                assert_eq!(pixels[0] > pixels[2], index < 4, "{extension} thumbnail {index}");
            }
            for (start_ms, end_ms, red) in [(125, 740, true), (1200, 1950, false)] {
                let range = NavigationRange { start_ms, end_ms };
                let window = source.read(&path, None, Some(range), &cancel).unwrap();
                assert_eq!(window.len(), 12 + 8 * thumb);
                for pixels in window[12..].chunks_exact(thumb) {
                    assert_eq!(pixels[0] > pixels[2], red, "{extension} samples visible range");
                }
            }
            let invalid = NavigationRange { start_ms: 100, end_ms: 2100 };
            assert!(source.read(&path, None, Some(invalid), &cancel).is_err());
            for (time, red) in [(0, true), (999, true), (1000, false), (2000, false)] {
                let frame = source.read(&path, Some(time), None, &cancel).unwrap();
                assert_eq!(frame.len(), 12 + 480 * 240 * 4);
                assert_eq!(frame[12] > frame[14], red, "{extension} at {time}ms");
            }
        }
    }

    #[test]
    fn trim_between_source_frames_keeps_the_frame_on_screen() {
        let folder = tempfile::tempdir().unwrap();
        let source = source_movie(folder.path(), "mp4", "libx264");
        let settings = Settings { start_ms: 990, end_ms: 1110, fps: 20, edge: 80 };
        let (frames, _) = extract(&source, Some(settings), None).unwrap();
        let preview = frames.preview_adjusted(ImageAdjustment::default(), None).unwrap();
        let (width, height, count, delays, pixels) = parse_preview(&preview);
        assert_eq!((count, delays), (3, vec![50, 50, 20]));
        let frame_bytes = (width * height * 4) as usize;
        assert!(pixels[0] > 220 && pixels[2] < 30);
        assert!(pixels[frame_bytes] < 30 && pixels[frame_bytes + 2] > 220);
    }

    #[test]
    fn sparse_frame_survives_seek_inside_its_display_interval() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("sparse.mp4");
        let mut command = Command::new(find_tools(None).unwrap().ffmpeg());
        command.args([
            "-v", "error", "-y",
            "-f", "lavfi", "-i", "color=red:s=32x24:r=1/4:d=4",
            "-f", "lavfi", "-i", "color=blue:s=32x24:r=1/4:d=4",
            "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0",
            "-r", "1/4", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        ]).arg(&path);
        run_process(command, "FFmpeg sparse frame fixture", 30, None).unwrap();
        assert_eq!(probe(&path, None).unwrap().duration_ms, 8000);

        let cancel = AtomicBool::new(false);
        let source = NavigationSource::open(&path, find_tools(None).unwrap(), &cancel).unwrap();
        for (time, red) in [(3000, true), (3999, true), (4000, false), (7500, false)] {
            let frame = source.read(&path, Some(time), None, &cancel).unwrap();
            assert_eq!(frame[12] > frame[14], red, "preview at {time}ms");
        }

        let settings = Settings { start_ms: 3000, end_ms: 3500, fps: 12, edge: 32 };
        let result = export(
            path.to_str().unwrap().to_owned(), None, 0, OutputFormat::Webp, Some(settings), None,
            ImageAdjustment::default(), Arc::new(AtomicBool::new(false)),
        ).unwrap();
        let preview = run_codec(&[Path::new("preview"), Path::new(&result.path)], None).unwrap();
        let (width, height, count, delays, pixels) = parse_preview(&preview);
        assert_eq!((width, height, count), (32, 24, 6));
        assert_eq!(delays.iter().sum::<u32>(), 500);
        assert!(pixels.chunks_exact(4).all(|pixel| pixel[0] > 220 && pixel[2] < 30));
    }

    #[test]
    fn rotated_mov_respects_display_width_and_height() {
        let folder = tempfile::tempdir().unwrap();
        let source = source_movie(folder.path(), "mp4", "libx264");
        let destination = folder.path().join("rotated.mov");
        let mut command = Command::new(find_tools(None).unwrap().ffmpeg());
        command.args(["-v", "error", "-y", "-display_rotation:v:0", "90", "-i"])
            .arg(source).args(["-c", "copy"]).arg(&destination);
        run_process(command, "FFmpeg rotation fixture", 30, None).unwrap();
        let info = probe(&destination, None).unwrap();
        assert_eq!((info.width, info.height), (80, 160));
        let settings = Settings { start_ms: 0, end_ms: 555, fps: 8, edge: 80 };
        let (frames, _) = extract(&destination, Some(settings), None).unwrap();
        let preview = frames.preview_adjusted(ImageAdjustment::default(), None).unwrap();
        let (width, height, _, delays, _) = parse_preview(&preview);
        assert_eq!((width, height, delays.iter().sum::<u32>()), (40, 80, 555));
    }

    #[test]
    fn adjusted_preview_matches_lossless_video_export() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("detail.mp4");
        let mut command = Command::new(find_tools(None).unwrap().ffmpeg());
        command.args([
            "-v", "error", "-y", "-f", "lavfi",
            "-i", "color=c=0x282828:s=96x64:r=10:d=1,drawbox=x=44:y=8:w=2:h=48:c=0xAAAAAA:t=fill",
            "-c:v", "libx264rgb", "-crf", "0",
        ]).arg(&source);
        run_process(command, "FFmpeg detail fixture", 30, None).unwrap();
        let settings = Settings {
            start_ms: 0, end_ms: 1000, fps: 10, edge: 96,
        };
        let strengths = ImageAdjustment { shadows: 77, denoise: 65, sharpen: 38 };
        let (frames, _) = extract(&source, Some(settings), None).unwrap();
        let original = frames.preview_adjusted(ImageAdjustment::default(), None).unwrap();
        let adjusted = frames.preview_adjusted(strengths, None).unwrap();
        let (_, _, _, _, original_pixels) = parse_preview(&original);
        let (width, height, count, delays, adjusted_pixels) = parse_preview(&adjusted);
        assert!(adjusted_pixels[0] > original_pixels[0]);
        assert!(original_pixels.iter().skip(3).step_by(4).eq(adjusted_pixels.iter().skip(3).step_by(4)));
        let result = export(
            source.to_str().unwrap().to_owned(), None, 0, OutputFormat::Webp, Some(settings), None, strengths, Arc::new(AtomicBool::new(false))
        ).unwrap();
        let output = run_codec(&[Path::new("preview"), Path::new(&result.path)], None).unwrap();
        assert_eq!(parse_preview(&output), (width, height, count, delays, adjusted_pixels));
    }

    #[test]
    fn webm_vp9_alpha_survives_extraction() {
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("alpha.webm");
        let mut command = Command::new(find_tools(None).unwrap().ffmpeg());
        command.args([
            "-v", "error", "-y", "-f", "lavfi",
            "-i", "color=c=red@0.5:s=80x80:d=0.5:r=12,format=yuva420p",
            "-c:v", "libvpx-vp9", "-lossless", "1", "-pix_fmt", "yuva420p",
        ]).arg(&source);
        run_process(command, "FFmpeg alpha fixture", 30, None).unwrap();
        let (frames, _) = extract(&source, None, None).unwrap();
        let preview = frames.preview_adjusted(ImageAdjustment::default(), None).unwrap();
        let (_, _, _, _, pixels) = parse_preview(&preview);
        assert!(pixels.chunks_exact(4).all(|pixel| (126..=129).contains(&pixel[3])));
    }
}
