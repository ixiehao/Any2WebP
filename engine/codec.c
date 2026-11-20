#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <ImageIO/ImageIO.h>
#include <errno.h>
#include <fcntl.h>
#include <gif_lib.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <webp/decode.h>
#include <webp/demux.h>
#include <webp/encode.h>
#include <webp/mux.h>
#include <zlib.h>
#include "adjustment.h"

#define MAX_FILE_BYTES (64u * 1024 * 1024)
#define MAX_PIXELS (16u * 1024 * 1024)
#define MAX_DECODED (192u * 1024 * 1024)
#define MAX_ANIMATION_DECODED (512u * 1024 * 1024)
#define MAX_VIDEO_FPS 30u
#define MAX_FRAMES 600
#define PREVIEW_BUDGET (12u * 1024 * 1024)
#define PREVIEW_EDGE 480u

// GIFLIB exports this function from libgif, but declares it in getarg.h,
// which Homebrew does not install. The pixel count is bounded by MAX_PIXELS.
extern int GifQuantizeBuffer(unsigned int width, unsigned int height, int *colors,
                             const GifByteType *red, const GifByteType *green,
                             const GifByteType *blue, GifByteType *indices,
                             GifColorType *palette);

typedef struct {
    uint8_t *pixels;
    uint32_t delay;
} Frame;

typedef struct {
    unsigned width, height, count, plays;
    uint32_t background;
    const char *format;
    bool webp, animated, alpha, recovered;
    size_t decoded_limit;
    Frame frames[MAX_FRAMES];
} Animation;

typedef struct {
    const Animation *source;
    const unsigned *gif_delays;
    bool lossless;
} OutputCheck;

typedef struct {
    const uint8_t *bytes;
    size_t size, offset;
    bool short_read;
} Buffer;

static _Noreturn void fail(const char *message) {
    fprintf(stderr, "%s\n", message);
    exit(EXIT_FAILURE);
}

static void *allocate(size_t bytes) {
    void *result = malloc(bytes);
    if (!result) fail("ui:memoryLimit");
    return result;
}

static size_t frame_bytes(const Animation *a) {
    return (size_t)a->width * a->height * 4;
}

static void adjust(Animation *a, unsigned shadows, unsigned denoise, unsigned sharpen) {
    uint8_t *scratch = denoise || sharpen ? allocate(frame_bytes(a)) : NULL;
    for (unsigned i = 0; i < a->count; i++) {
        adjust_rgba(a->frames[i].pixels, scratch, a->width, a->height, shadows, denoise, sharpen);
    }
    free(scratch);
}

static void dimensions(Animation *a, unsigned width, unsigned height) {
    if (!width || !height || width > 16383 || height > 16383 ||
        (uint64_t)width * height > MAX_PIXELS) {
        fail("ui:invalidCanvas");
    }
    a->width = width;
    a->height = height;
}

static void store_frame(Animation *a, unsigned index, uint8_t *pixels, uint32_t delay) {
    size_t bytes = frame_bytes(a);
    if (!a->alpha) {
        for (size_t i = 3; i < bytes; i += 4) {
            if (pixels[i] != 255) {
                a->alpha = true;
                break;
            }
        }
    }
    a->frames[index] = (Frame){pixels, delay};
}

static unsigned next_frame(Animation *a) {
    size_t limit = a->decoded_limit ? a->decoded_limit : MAX_DECODED;
    if (a->count >= MAX_FRAMES || (a->count + 1) * frame_bytes(a) > limit) {
        fail("ui:animationLimit");
    }
    return a->count++;
}

static void append(Animation *a, const uint8_t *pixels, uint32_t delay) {
    unsigned index = next_frame(a);
    size_t bytes = frame_bytes(a);
    uint8_t *copy = allocate(bytes);
    memcpy(copy, pixels, bytes);
    store_frame(a, index, copy, delay);
}

static bool gif_transparent(const uint8_t *pixel) {
    return pixel[3] < 128;
}

static void decoded_frame(Animation *a, const uint8_t *pixels, uint32_t delay, const OutputCheck *check) {
    if (!check) {
        append(a, pixels, delay);
        return;
    }
    const Animation *source = check->source;
    unsigned index = a->count;
    if (index >= source->count || a->width != source->width || a->height != source->height) {
        fail("ui:outputIntegrity");
    }
    const Frame *expected = &source->frames[index];
    uint32_t expected_delay = check->gif_delays ? check->gif_delays[index] * 10 : expected->delay;
    if (delay != expected_delay) fail("ui:outputIntegrity");
    size_t bytes = frame_bytes(a);
    if (check->gif_delays) {
        for (size_t p = 0; p < bytes; p += 4) {
            uint8_t alpha = gif_transparent(expected->pixels + p) ? 0 : 255;
            if (pixels[p + 3] != alpha) fail("ui:outputIntegrity");
            a->alpha |= !alpha;
        }
    } else {
        if (!check->lossless || memcmp(expected->pixels, pixels, bytes)) {
            for (size_t p = 0; p < bytes; p += 4) {
                uint8_t alpha = expected->pixels[p + 3];
                if (pixels[p + 3] != alpha ||
                    (check->lossless && alpha && memcmp(expected->pixels + p, pixels + p, 3))) {
                    fail("ui:outputIntegrity");
                }
            }
        }
        a->alpha = source->alpha;
    }
    // The decoder lends the canvas only until the next frame. Verification
    // compares it here, retaining metadata without another RGBA copy.
    a->frames[next_frame(a)].delay = delay;
}

static void release(Animation *a) {
    for (unsigned i = 0; i < a->count; i++) free(a->frames[i].pixels);
}

static WebPData read_input(const char *path) {
    int fd = open(path, O_RDONLY | O_NONBLOCK);
    if (fd < 0) fail("ui:sourceMissing");
    struct stat info;
    if (fstat(fd, &info) || !S_ISREG(info.st_mode) ||
        info.st_size <= 0 || info.st_size > MAX_FILE_BYTES) {
        fail("ui:inputFileLimit");
    }
    FILE *file = fdopen(fd, "rb");
    if (!file) fail("ui:sourceMissing");
    size_t size = (size_t)info.st_size;
    uint8_t *bytes = allocate(size);
    if (fread(bytes, 1, size, file) != size || fgetc(file) != EOF) {
        fail("ui:sourceChanged");
    }
    fclose(file);
    return (WebPData){bytes, size};
}

static int gif_read(GifFileType *gif, GifByteType *out, int count) {
    Buffer *input = gif->UserData;
    size_t left = input->size - input->offset;
    size_t take = (size_t)count < left ? (size_t)count : left;
    if (take < (size_t)count) input->short_read = true;
    memcpy(out, input->bytes + input->offset, take);
    input->offset += take;
    return (int)take;
}

static void fill_rect(uint8_t *canvas, unsigned width, const GifImageDesc *rect,
                      const uint8_t color[4]) {
    for (int y = 0; y < rect->Height; y++) {
        uint8_t *row = canvas + ((size_t)(rect->Top + y) * width + rect->Left) * 4;
        for (int x = 0; x < rect->Width; x++) memcpy(row + x * 4, color, 4);
    }
}

static bool gif_row(GifFileType *gif, int y, int transparent, GifPixelType *indices,
                    uint8_t *canvas) {
    GifImageDesc *rect = &gif->Image;
    const ColorMapObject *map = rect->ColorMap ? rect->ColorMap : gif->SColorMap;
    if (!map) fail("ui:decodeGif");
    if (DGifGetLine(gif, indices, rect->Width) == GIF_ERROR) return false;
    uint8_t *row = canvas + ((size_t)(rect->Top + y) * gif->SWidth + rect->Left) * 4;
    for (int x = 0; x < rect->Width; x++) {
        unsigned index = indices[x];
        if ((int)index == transparent) continue;
        if (index >= (unsigned)map->ColorCount) fail("ui:decodeGif");
        GifColorType c = map->Colors[index];
        uint8_t color[4] = {c.Red, c.Green, c.Blue, 255};
        memcpy(row + x * 4, color, 4);
    }
    return true;
}

static bool gif_pixels(GifFileType *gif, int transparent, GifPixelType *indices, uint8_t *canvas) {
    if (gif->Image.Interlace) {
        const int starts[] = {0, 4, 2, 1};
        const int steps[] = {8, 8, 4, 2};
        for (int pass = 0; pass < 4; pass++) {
            for (int y = starts[pass]; y < gif->Image.Height; y += steps[pass]) {
                if (!gif_row(gif, y, transparent, indices, canvas)) return false;
            }
        }
    } else {
        for (int y = 0; y < gif->Image.Height; y++) {
            if (!gif_row(gif, y, transparent, indices, canvas)) return false;
        }
    }
    return true;
}

// Start at the first length byte after the LZW minimum code size. Skipping
// by sub-block lengths distinguishes an incomplete tail from a bad frame
// whose data ends cleanly and may be followed by other frames.
static bool gif_data_incomplete(const Buffer *input, size_t offset) {
    while (offset < input->size) {
        size_t length = input->bytes[offset++];
        if (!length) return false;
        if (length > input->size - offset) break;
        offset += length;
    }
    return true;
}

static void decode_gif(WebPData data, Animation *a, const OutputCheck *check) {
    Buffer input = {.bytes = data.bytes, .size = data.size};
    GifFileType *gif = DGifOpen(&input, gif_read, NULL);
    if (!gif) fail("ui:decodeGif");
    dimensions(a, gif->SWidth, gif->SHeight);
    a->format = "GIF";
    a->decoded_limit = MAX_ANIMATION_DECODED;
    a->plays = 1;
    size_t bytes = frame_bytes(a);
    uint8_t *canvas = calloc(1, bytes);
    uint8_t *previous = NULL;
    GifPixelType *indices = allocate(a->width);
    if (!canvas) fail("ui:memoryLimit");

    const uint8_t clear[4] = {0, 0, 0, 0};
    uint8_t background[4] = {0, 0, 0, 0};
    if (gif->SColorMap && gif->SBackGroundColor < gif->SColorMap->ColorCount) {
        GifColorType c = gif->SColorMap->Colors[gif->SBackGroundColor];
        background[0] = c.Red;
        background[1] = c.Green;
        background[2] = c.Blue;
        background[3] = 255;
    }

    GraphicsControlBlock defaults = {DISPOSAL_UNSPECIFIED, false, 0, NO_TRANSPARENT_COLOR};
    GraphicsControlBlock control = defaults;
    GifRecordType type;
    bool loop_found = false;
    while (true) {
        if (DGifGetRecordType(gif, &type) == GIF_ERROR) {
            if (!a->count || !input.short_read) fail("ui:decodeGif");
            a->recovered = true;
            break;
        }
        if (type == TERMINATE_RECORD_TYPE) break;
        if (type == EXTENSION_RECORD_TYPE) {
            int code;
            GifByteType *block;
            if (DGifGetExtension(gif, &code, &block) == GIF_ERROR) fail("ui:decodeGif");
            bool loop = block && code == APPLICATION_EXT_FUNC_CODE && block[0] == 11 &&
                        (!memcmp(block + 1, "NETSCAPE2.0", 11) ||
                         !memcmp(block + 1, "ANIMEXTS1.0", 11));
            if (block && code == GRAPHICS_EXT_FUNC_CODE &&
                DGifExtensionToGCB(block[0], block + 1, &control) == GIF_ERROR) {
                fail("ui:decodeGif");
            }
            while (block) {
                if (DGifGetExtensionNext(gif, &block) == GIF_ERROR) fail("ui:decodeGif");
                if (loop && !loop_found && block && block[0] == 3 && block[1] == 1) {
                    unsigned repeats = (unsigned)block[2] | ((unsigned)block[3] << 8);
                    a->plays = repeats ? repeats + 1 : 0;
                    loop_found = true;
                }
            }
            if (code == PLAINTEXT_EXT_FUNC_CODE) control = defaults;
            continue;
        }
        if (type != IMAGE_DESC_RECORD_TYPE || DGifGetImageDesc(gif) == GIF_ERROR) {
            if (!a->count || !input.short_read) fail("ui:decodeGif");
            a->recovered = true;
            break;
        }
        size_t image_data = input.offset;
        GifImageDesc rect = gif->Image;
        if (rect.Left < 0 || rect.Top < 0 || rect.Width <= 0 || rect.Height <= 0 ||
            (unsigned)(rect.Left + rect.Width) > a->width ||
            (unsigned)(rect.Top + rect.Height) > a->height) {
            fail("ui:decodeGif");
        }
        bool transparent = control.TransparentColor != NO_TRANSPARENT_COLOR;
        if (!a->count) {
            if (transparent) memset(background, 0, sizeof(background));
            GifImageDesc full = {.Width = (int)a->width, .Height = (int)a->height};
            fill_rect(canvas, a->width, &full, background);
        }
        if (control.DisposalMode == DISPOSE_PREVIOUS) {
            if (!previous) previous = allocate(bytes);
            memcpy(previous, canvas, bytes);
        }
        if (!gif_pixels(gif, control.TransparentColor, indices, canvas)) {
            if (!a->count || !gif_data_incomplete(&input, image_data)) fail("ui:decodeGif");
            a->recovered = true;
            break;
        }
        decoded_frame(a, canvas, (uint32_t)control.DelayTime * 10, check);
        if (control.DisposalMode == DISPOSE_PREVIOUS) memcpy(canvas, previous, bytes);
        if (control.DisposalMode == DISPOSE_BACKGROUND) {
            fill_rect(canvas, a->width, &rect, transparent ? clear : background);
        }
        control = defaults;
    }
    DGifCloseFile(gif, NULL);
    free(indices);
    free(previous);
    free(canvas);
    a->animated = a->count > 1;
    if (!a->animated && a->count) {
        a->frames[0].delay = 0;
        a->plays = 1;
    }
}

static void decode_webp(WebPData data, Animation *a, const OutputCheck *check) {
    WebPBitstreamFeatures features;
    if (WebPGetFeatures(data.bytes, data.size, &features) != VP8_STATUS_OK) {
        fail("ui:decodeWebp");
    }
    dimensions(a, features.width, features.height);
    a->format = "WebP";
    a->webp = true;
    // Video exports must also fit when validated, previewed, or opened as WebP.
    a->decoded_limit = MAX_ANIMATION_DECODED;
    a->plays = 1;
    a->animated = features.has_animation;
    if (!a->animated) {
        uint8_t *pixels = WebPDecodeRGBA(data.bytes, data.size, NULL, NULL);
        if (!pixels) fail("ui:decodeWebp");
        decoded_frame(a, pixels, 0, check);
        WebPFree(pixels);
        return;
    }

    WebPAnimDecoderOptions options;
    if (!WebPAnimDecoderOptionsInit(&options)) fail("ui:decodeWebp");
    options.color_mode = MODE_RGBA;
    options.use_threads = 1;
    WebPAnimDecoder *decoder = WebPAnimDecoderNew(&data, &options);
    WebPAnimInfo info;
    if (!decoder || !WebPAnimDecoderGetInfo(decoder, &info)) fail("ui:decodeWebp");
    if (info.frame_count > MAX_FRAMES || info.frame_count * frame_bytes(a) > a->decoded_limit) {
        fail("ui:animationLimit");
    }
    a->plays = info.loop_count;
    a->background = info.bgcolor;
    const WebPDemuxer *demux = WebPAnimDecoderGetDemuxer(decoder);
    int64_t total_ms = 0;
    while (WebPAnimDecoderHasMoreFrames(decoder)) {
        WebPIterator frame;
        uint8_t *pixels;
        int timestamp;
        if (!WebPDemuxGetFrame(demux, a->count + 1, &frame)) fail("ui:decodeWebp");
        total_ms += frame.duration;
        if (total_ms > INT32_MAX) fail("ui:animationLimit");
        if (!WebPAnimDecoderGetNext(decoder, &pixels, &timestamp)) {
            fail("ui:decodeWebp");
        }
        decoded_frame(a, pixels, frame.duration, check);
        WebPDemuxReleaseIterator(&frame);
    }
    WebPAnimDecoderDelete(decoder);
}

static int image_property(CFDictionaryRef props, CFStringRef key, int fallback) {
    if (!props) return fallback;
    CFNumberRef value = CFDictionaryGetValue(props, key);
    int number;
    if (!value || CFGetTypeID(value) != CFNumberGetTypeID() ||
        !CFNumberGetValue(value, kCFNumberIntType, &number)) return fallback;
    return number;
}

static uint8_t *render_cgimage(const Animation *a, CGImageRef image, CGRect rect) {
    size_t bytes = frame_bytes(a);
    uint8_t *pixels = calloc(1, bytes);
    if (!pixels) fail("ui:memoryLimit");
    CGColorSpaceRef color = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef context = CGBitmapContextCreate(
        pixels, a->width, a->height, 8, a->width * 4, color,
        kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    CGColorSpaceRelease(color);
    if (!context) fail("ui:invalidCanvas");
    CGContextSetBlendMode(context, kCGBlendModeCopy);
    CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
    CGContextDrawImage(context, rect, image);
    CGContextRelease(context);

    // Core Graphics renders premultiplied pixels. WebP requires straight alpha.
    for (size_t offset = 0; offset < bytes; offset += 4) {
        unsigned alpha = pixels[offset + 3];
        if (!alpha || alpha == 255) continue;
        for (size_t channel = 0; channel < 3; channel++) {
            unsigned value = (pixels[offset + channel] * 255 + alpha / 2) / alpha;
            pixels[offset + channel] = value > 255 ? 255 : value;
        }
    }
    return pixels;
}

static void draw_cgimage(Animation *a, CGImageRef image, uint32_t delay) {
    if (!image) fail("ui:decodeImage");
    if (CGImageGetWidth(image) != a->width || CGImageGetHeight(image) != a->height) {
        fail("ui:invalidCanvas");
    }
    uint8_t *pixels = render_cgimage(a, image, CGRectMake(0, 0, a->width, a->height));
    store_frame(a, next_frame(a), pixels, delay);
}

static uint32_t read_be32(const uint8_t *bytes) {
    return ((uint32_t)bytes[0] << 24) | ((uint32_t)bytes[1] << 16) |
           ((uint32_t)bytes[2] << 8) | bytes[3];
}

static void put_be32(uint8_t *bytes, uint32_t value) {
    bytes[0] = value >> 24;
    bytes[1] = value >> 16;
    bytes[2] = value >> 8;
    bytes[3] = value;
}

static void png_crc(uint8_t *chunk, uint32_t length) {
    put_be32(chunk + 8 + length, (uint32_t)crc32(0, chunk + 4, length + 4));
}

static unsigned read_be16(const uint8_t *bytes) {
    return ((unsigned)bytes[0] << 8) | bytes[1];
}

typedef struct {
    unsigned count, plays;
    bool has_poster;
    uint32_t delays[MAX_FRAMES];
} PngAnimation;

static PngAnimation png_animation(WebPData data) {
    PngAnimation animation = {0};
    unsigned frames = 0;
    bool saw_idat = false;
    for (size_t offset = 8; offset + 12 <= data.size;) {
        uint32_t length = read_be32(data.bytes + offset);
        const uint8_t *kind = data.bytes + offset + 4;
        if (length > data.size - offset - 12) fail("ui:decodeApng");
        const uint8_t *payload = kind + 4;
        if (!memcmp(kind, "acTL", 4)) {
            if (length != 8 || animation.count) fail("ui:decodeApng");
            animation.count = read_be32(payload);
            animation.plays = read_be32(payload + 4);
            if (!animation.count || animation.count > MAX_FRAMES) fail("ui:animationLimit");
        } else if (!memcmp(kind, "fcTL", 4)) {
            if (length != 26 || frames >= animation.count) fail("ui:decodeApng");
            if (!frames) animation.has_poster = saw_idat;
            unsigned numerator = read_be16(payload + 20);
            unsigned denominator = read_be16(payload + 22);
            if (!denominator) denominator = 100;
            uint32_t delay = (numerator * 1000u + denominator / 2) / denominator;
            if (delay > 0xffffff) fail("ui:frameDelayLimit");
            animation.delays[frames++] = delay;
        } else if (!memcmp(kind, "IDAT", 4)) {
            saw_idat = true;
        } else if (!memcmp(kind, "IEND", 4)) {
            break;
        }
        offset += 12 + length;
    }
    if (animation.count != frames) fail("ui:decodeApng");
    return animation;
}

// ImageIO can return incorrect pixels for APNGs whose default PNG image is
// separate from the animation. Make the default image a synthetic first
// frame that clears the canvas, and skip it after decoding.
static WebPData png_with_poster_frame(WebPData data) {
    const uint32_t control_size = 26;
    const size_t added = control_size + 12;
    if (data.size < 33 || memcmp(data.bytes + 12, "IHDR", 4)) fail("ui:decodeApng");
    uint8_t *out = allocate(data.size + added);
    memcpy(out, data.bytes, 8);
    size_t written = 8;
    bool inserted = false;
    for (size_t offset = 8; offset + 12 <= data.size;) {
        uint32_t length = read_be32(data.bytes + offset);
        if (length > data.size - offset - 12) fail("ui:decodeApng");
        const uint8_t *kind = data.bytes + offset + 4;
        if (!inserted && !memcmp(kind, "IDAT", 4)) {
            uint8_t *frame = out + written;
            memset(frame, 0, added);
            put_be32(frame, control_size);
            memcpy(frame + 4, "fcTL", 4);
            memcpy(frame + 12, data.bytes + 16, 8); // Canvas width and height.
            frame[30] = 3;
            frame[31] = 232; // Delay denominator 1000.
            frame[32] = 1; // Clear the default image before the actual animation.
            png_crc(frame, control_size);
            written += added;
            inserted = true;
        }

        uint8_t *chunk = out + written;
        memcpy(chunk, data.bytes + offset, 12u + length);
        if (!memcmp(kind, "acTL", 4) || !memcmp(kind, "fcTL", 4) ||
            (!memcmp(kind, "fdAT", 4) && length >= 4)) {
            uint32_t sequence = read_be32(chunk + 8);
            put_be32(chunk + 8, sequence + 1);
            png_crc(chunk, length);
        }
        written += 12u + length;
        offset += 12u + length;
        if (!memcmp(kind, "IEND", 4)) break;
    }
    if (!inserted) fail("ui:decodeApng");
    return (WebPData){out, written};
}

static CGImageSourceRef image_source(WebPData data) {
    CFDataRef bytes = CFDataCreateWithBytesNoCopy(
        kCFAllocatorDefault, data.bytes, data.size, kCFAllocatorNull);
    if (!bytes) fail("ui:decodeImage");
    CGImageSourceRef source = CGImageSourceCreateWithData(bytes, NULL);
    CFRelease(bytes);
    if (!source) fail("ui:decodeImage");
    return source;
}

static const char *image_format(CFStringRef type) {
    if (!type) fail("ui:unsupportedImage");
    const struct {
        CFStringRef uti;
        const char *name;
    } accepted[] = {
        {CFSTR("public.png"), "PNG"}, {CFSTR("public.jpeg"), "JPEG"},
        {CFSTR("public.heic"), "HEIC"}, {CFSTR("public.heif"), "HEIF"},
        {CFSTR("public.avif"), "AVIF"}, {CFSTR("public.tiff"), "TIFF"},
        {CFSTR("com.microsoft.bmp"), "BMP"}, {CFSTR("com.microsoft.ico"), "ICO"},
        {CFSTR("com.adobe.photoshop-image"), "PSD"}, {CFSTR("public.jpeg-2000"), "JP2"},
        {CFSTR("public.jpeg-xl"), "JXL"}, {CFSTR("public.heics"), "HEIC"},
    };
    for (size_t i = 0; i < sizeof(accepted) / sizeof(accepted[0]); i++) {
        if (CFEqual(type, accepted[i].uti)) return accepted[i].name;
    }
    fail("ui:unsupportedImage");
}

static void decode_imageio(WebPData data, Animation *a) {
    CGImageSourceRef source = image_source(data);
    WebPData normalized = {0};
    a->format = image_format(CGImageSourceGetType(source));
    size_t count = CGImageSourceGetCount(source);
    if (!count) fail("ui:noFrames");

    PngAnimation animation = {0};
    if (!strcmp(a->format, "PNG")) animation = png_animation(data);
    if (animation.count) {
        size_t first = 0;
        if (animation.has_poster) {
            CFRelease(source);
            normalized = png_with_poster_frame(data);
            source = image_source(normalized);
            count = CGImageSourceGetCount(source);
            first = 1;
        }
        if (count != animation.count + first) fail("ui:decodeApng");
        a->format = "APNG";
        a->animated = true;
        a->plays = animation.plays;
        CFDictionaryRef props = CGImageSourceCopyPropertiesAtIndex(source, first, NULL);
        int width = image_property(props, kCGImagePropertyPixelWidth, 0);
        int height = image_property(props, kCGImagePropertyPixelHeight, 0);
        if (props) CFRelease(props);
        dimensions(a, width, height);
        if ((size_t)animation.count * frame_bytes(a) > MAX_DECODED) {
            fail("ui:animationLimit");
        }
        if (first) {
            CGImageRef poster = CGImageSourceCreateImageAtIndex(source, 0, NULL);
            if (!poster) fail("ui:decodeApng");
            CGImageRelease(poster);
        }
        for (unsigned i = 0; i < animation.count; i++) {
            CGImageRef image = CGImageSourceCreateImageAtIndex(source, i + first, NULL);
            draw_cgimage(a, image, animation.delays[i]);
            CGImageRelease(image);
        }
    } else {
        size_t index = 0;
        if (!strcmp(a->format, "ICO") && count > 1) {
            uint64_t largest = 0;
            for (size_t i = 0; i < count; i++) {
                CFDictionaryRef candidate = CGImageSourceCopyPropertiesAtIndex(source, i, NULL);
                int width = image_property(candidate, kCGImagePropertyPixelWidth, 0);
                int height = image_property(candidate, kCGImagePropertyPixelHeight, 0);
                if (candidate) CFRelease(candidate);
                if (width <= 0 || height <= 0) continue;
                uint64_t pixels = (uint64_t)width * height;
                if (pixels > largest && pixels <= MAX_PIXELS) {
                    largest = pixels;
                    index = i;
                }
            }
        } else if (count > 1) {
            fail("ui:unsupportedMultiFrame");
        }
        CFDictionaryRef props = CGImageSourceCopyPropertiesAtIndex(source, index, NULL);
        int width = image_property(props, kCGImagePropertyPixelWidth, 0);
        int height = image_property(props, kCGImagePropertyPixelHeight, 0);
        int orientation = image_property(props, kCGImagePropertyOrientation, 1);
        if (props) CFRelease(props);
        dimensions(a, width, height);
        CGImageRef image;
        if (orientation >= 2 && orientation <= 8) {
            int edge = width > height ? width : height;
            CFNumberRef limit = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &edge);
            const void *keys[] = {kCGImageSourceCreateThumbnailFromImageAlways,
                                  kCGImageSourceCreateThumbnailWithTransform, kCGImageSourceThumbnailMaxPixelSize};
            const void *values[] = {kCFBooleanTrue, kCFBooleanTrue, limit};
            CFDictionaryRef options = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 3,
                    &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
            image = CGImageSourceCreateThumbnailAtIndex(source, index, options);
            CFRelease(options);
            CFRelease(limit);
            if (orientation >= 5) dimensions(a, height, width);
        } else {
            image = CGImageSourceCreateImageAtIndex(source, index, NULL);
        }
        a->plays = 1;
        draw_cgimage(a, image, 0);
        CGImageRelease(image);
    }
    CFRelease(source);
    free((void *)normalized.bytes);
}

static void decode(WebPData data, Animation *a) {
    if (data.size >= 6 &&
        (!memcmp(data.bytes, "GIF87a", 6) || !memcmp(data.bytes, "GIF89a", 6))) {
        decode_gif(data, a, NULL);
    } else if (data.size >= 12 && !memcmp(data.bytes, "RIFF", 4) &&
               !memcmp(data.bytes + 8, "WEBP", 4)) {
        decode_webp(data, a, NULL);
    } else {
        decode_imageio(data, a);
    }
    if (!a->count) fail("ui:noFrames");
}

static void print_info(const Animation *a, size_t bytes) {
    printf("{\"format\":\"%s\",\"bytes\":%zu,\"width\":%u,\"height\":%u,"
           "\"animated\":%s,\"alpha\":%s,\"recovered\":%s,\"plays\":%u,\"delays\":[",
           a->format, bytes, a->width, a->height,
           a->animated ? "true" : "false", a->alpha ? "true" : "false",
           a->recovered ? "true" : "false", a->plays);
    for (unsigned f = 0; f < a->count; f++) printf("%s%u", f ? "," : "", a->frames[f].delay);
    putchar(']');
    putchar('}');
}

static void write_bytes(FILE *file, const void *bytes, size_t size) {
    if (fwrite(bytes, 1, size, file) != size) fail("ui:outputWrite");
}

static void write_u32(uint32_t value) {
    uint8_t bytes[4] = {value, value >> 8, value >> 16, value >> 24};
    write_bytes(stdout, bytes, sizeof(bytes));
}

static void preview(const Animation *a, size_t source_bytes) {
    unsigned max_width = a->width;
    unsigned max_height = a->height;
    while (max_width > PREVIEW_EDGE || max_height > PREVIEW_EDGE ||
           (size_t)max_width * max_height * 4 * a->count > PREVIEW_BUDGET) {
        max_width = max_width > 1 ? (max_width + 1) / 2 : 1;
        max_height = max_height > 1 ? (max_height + 1) / 2 : 1;
    }

    write_u32(max_width);
    write_u32(max_height);
    write_u32(a->count);
    write_u32(a->plays);
    write_u32((unsigned)a->animated | ((unsigned)a->recovered << 1));
    write_u32(a->width);
    write_u32(a->height);
    write_u32(a->alpha);
    uint8_t format[4] = {0};
    size_t name_length = strlen(a->format);
    memcpy(format, a->format, name_length > sizeof(format) ? sizeof(format) : name_length);
    write_bytes(stdout, format, sizeof(format));
    write_u32((uint32_t)source_bytes);
    for (unsigned f = 0; f < a->count; f++) write_u32(a->frames[f].delay);
    size_t size = (size_t)max_width * max_height * 4;
    if (max_width == a->width && max_height == a->height) {
        for (unsigned f = 0; f < a->count; f++) write_bytes(stdout, a->frames[f].pixels, size);
        return;
    }
    uint8_t *pixels = allocate(size);
    size_t columns[PREVIEW_EDGE];
    for (unsigned x = 0; x < max_width; x++) columns[x] = (size_t)(x * a->width / max_width) * 4;
    for (unsigned f = 0; f < a->count; f++) {
        const uint8_t *source = a->frames[f].pixels;
        for (unsigned y = 0; y < max_height; y++) {
            const uint8_t *row = source + (size_t)(y * a->height / max_height) * a->width * 4;
            uint8_t *output = pixels + (size_t)y * max_width * 4;
            for (unsigned x = 0; x < max_width; x++) {
                memcpy(output + x * 4, row + columns[x], 4);
            }
        }
        write_bytes(stdout, pixels, size);
    }
    free(pixels);
}

typedef struct {
    unsigned x, y, width, height;
} Region;

static Region changed_region(const Animation *a, unsigned index) {
    if (!index) return (Region){0, 0, a->width, a->height};
    const uint8_t *from = a->frames[index - 1].pixels;
    const uint8_t *to = a->frames[index].pixels;
    unsigned left = a->width, top = a->height, right = 0, bottom = 0;
    size_t stride = (size_t)a->width * 4;
    for (unsigned y = 0; y < a->height; y++) {
        size_t offset = y * stride;
        if (!memcmp(from + offset, to + offset, stride)) continue;
        if (y < top) top = y;
        bottom = y + 1;
        // Changes within already known bounds cannot expand the region.
        for (unsigned x = 0; x < left; x++) {
            size_t p = offset + x * 4;
            if (!memcmp(from + p, to + p, 4)) continue;
            left = x;
            break;
        }
        for (unsigned x = a->width; x > right; x--) {
            size_t p = offset + (x - 1) * 4;
            if (!memcmp(from + p, to + p, 4)) continue;
            right = x;
            break;
        }
    }
    if (!right) return (Region){0, 0, 1, 1};

    // The WebP container stores animation offsets in units of two pixels.
    left &= ~1u;
    top &= ~1u;
    return (Region){left, top, right - left, bottom - top};
}

static WebPData encode_region(const Animation *a, unsigned index, Region rect,
                              const WebPConfig *config) {
    WebPPicture picture;
    if (!WebPPictureInit(&picture)) fail("ui:encodeWebp");
    picture.width = (int)rect.width;
    picture.height = (int)rect.height;
    picture.use_argb = 1;
    WebPMemoryWriter writer;
    WebPMemoryWriterInit(&writer);
    picture.writer = WebPMemoryWrite;
    picture.custom_ptr = &writer;
    size_t start = ((size_t)rect.y * a->width + rect.x) * 4;
    if (!WebPPictureImportRGBA(&picture, a->frames[index].pixels + start, (int)a->width * 4) ||
        !WebPEncode(config, &picture)) fail("ui:encodeWebp");
    WebPPictureFree(&picture);
    return (WebPData){writer.mem, writer.size};
}

static void copy_metadata(WebPMux *output, WebPData source) {
    WebPDemuxer *input = WebPDemux(&source);
    if (!input) fail("ui:preserveMetadata");
    const char *names[] = {"ICCP", "EXIF", "XMP "};
    for (unsigned i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
        WebPChunkIterator chunk;
        if (WebPDemuxGetChunk(input, names[i], 1, &chunk)) {
            if (WebPMuxSetChunk(output, names[i], &chunk.chunk, 1) != WEBP_MUX_OK) {
                fail("ui:preserveMetadata");
            }
            WebPDemuxReleaseChunkIterator(&chunk);
        }
    }
    WebPDemuxDelete(input);
}

static uint32_t read_le32(const uint8_t *p) {
    return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}

static void keep_single_animation(WebPData *data) {
    // WebPMux assembles one ANMF as a still. Remove the temporary duplicate after assembly.
    unsigned frames = 0;
    uint8_t *bytes = (uint8_t *)data->bytes;
    for (size_t offset = 12; offset + 8 <= data->size; ) {
        size_t length = read_le32(bytes + offset + 4);
        size_t chunk = 8 + length + (length & 1);
        if (chunk > data->size - offset) break;
        if (!memcmp(bytes + offset, "ANMF", 4) && ++frames == 2) {
            memmove(bytes + offset, bytes + offset + chunk, data->size - offset - chunk);
            data->size -= chunk;
            size_t riff_size = data->size - 8;
            for (unsigned i = 0; i < 4; i++) bytes[4 + i] = (uint8_t)(riff_size >> (8 * i));
            return;
        }
        offset += chunk;
    }
    fail("ui:encodeWebp");
}

static unsigned webp_plays(unsigned source_plays) {
    return source_plays > UINT16_MAX ? UINT16_MAX : source_plays;
}

static WebPData encode(WebPData source, const Animation *a, const Region *regions, int quality) {
    WebPConfig config;
    if (!WebPConfigInit(&config)) fail("ui:encodeWebp");
    config.lossless = quality < 0;
    config.quality = quality < 0 ? 80 : quality;
    config.alpha_quality = 100;
    config.exact = 1;
    config.method = 4;
    config.thread_level = 1;

    WebPMux *mux = WebPMuxNew();
    if (!mux) fail("ui:encodeWebp");
    if (a->animated) {
        WebPMuxAnimParams params = {a->background, (int)webp_plays(a->plays)};
        if (WebPMuxSetCanvasSize(mux, a->width, a->height) != WEBP_MUX_OK ||
            WebPMuxSetAnimationParams(mux, &params) != WEBP_MUX_OK) {
            fail("ui:encodeWebp");
        }
    }
    size_t encoded_bytes = 0;
    // Muxing removes per-frame RIFF and VP8X headers. Allow for that
    // difference here, then enforce the exact cap after assembly.
    const size_t payload_limit = MAX_FILE_BYTES + 64u * a->count;
    for (unsigned i = 0; i < a->count; i++) {
        Region rect = regions[i];
        // For lossy frames, refresh the full image to avoid stale colors at subframe edges.
        if (quality >= 0 && rect.width * rect.height > a->width * a->height / 2) {
            rect = (Region){0, 0, a->width, a->height};
        }
        WebPData frame = encode_region(a, i, rect, &config);
        if (frame.size > payload_limit - encoded_bytes) {
            WebPDataClear(&frame);
            WebPMuxDelete(mux);
            return (WebPData){0};
        }
        encoded_bytes += frame.size;
        WebPMuxError result;
        if (a->animated) {
            WebPMuxFrameInfo info = {
                .bitstream = frame, .x_offset = (int)rect.x, .y_offset = (int)rect.y,
                .duration = (int)a->frames[i].delay, .id = WEBP_CHUNK_ANMF,
                .dispose_method = WEBP_MUX_DISPOSE_NONE, .blend_method = WEBP_MUX_NO_BLEND
            };
            result = WebPMuxPushFrame(mux, &info, 1);
            if (result == WEBP_MUX_OK && a->count == 1) result = WebPMuxPushFrame(mux, &info, 1);
        } else {
            result = WebPMuxSetImage(mux, &frame, 1);
        }
        WebPDataClear(&frame);
        if (result != WEBP_MUX_OK) fail("ui:encodeWebp");
    }
    if (a->webp) copy_metadata(mux, source);
    WebPData output;
    if (WebPMuxAssemble(mux, &output) != WEBP_MUX_OK) fail("ui:encodeWebp");
    WebPMuxDelete(mux);
    if (a->animated && a->count == 1) keep_single_animation(&output);
    if (output.size > MAX_FILE_BYTES) WebPDataClear(&output);
    return output;
}

static void save_result(const char *path, WebPData result, const char *error) {
    FILE *file = fopen(path, "wb");
    if (!file) fail(error);
    bool complete = fwrite(result.bytes, 1, result.size, file) == result.size;
    if (fclose(file) || !complete) fail(error);
}

static void convert_webp(WebPData source, const Animation *a, const char *path, uint64_t target, bool adjusted) {
    Region regions[MAX_FRAMES];
    for (unsigned i = 0; i < a->count; i++) regions[i] = changed_region(a, i);
    WebPData result = encode(source, a, regions, -1);
    int quality = -1;
    bool single_animation = a->animated && a->count == 1;
    if (target && (!result.bytes || result.size > target) && (!a->webp || adjusted || source.size > target)) {
        const int levels[] = {85, 70, 55, 40, 25, 10, 0};
        for (unsigned i = 0; i < sizeof(levels) / sizeof(levels[0]); i++) {
            WebPData candidate = encode(source, a, regions, levels[i]);
            if (candidate.bytes && (!result.bytes || candidate.size < result.size)) {
                WebPDataClear(&result);
                result = candidate;
                quality = levels[i];
            } else {
                WebPDataClear(&candidate);
            }
            if (result.bytes && result.size <= target) break;
        }
    }
    bool unchanged = a->webp && !adjusted && (single_animation || !result.bytes || result.size >= source.size);
    if (!unchanged && !result.bytes) fail("ui:outputLimit");
    printf("{\"quality\":%d,\"unchanged\":%s,\"source\":",
           unchanged ? -1 : quality, unchanged ? "true" : "false");
    print_info(a, source.size);
    printf(",\"output\":");
    if (unchanged) {
        print_info(a, source.size);
    } else {
        Animation output = {0};
        const OutputCheck check = {.source = a, .lossless = quality < 0};
        decode_webp(result, &output, &check);
        if (output.animated != a->animated || output.count != a->count ||
            output.plays != webp_plays(a->plays)) fail("ui:outputIntegrity");
        save_result(path, result, "ui:saveWebp");
        print_info(&output, result.size);
    }
    puts("}");
    WebPDataClear(&result);
}

typedef struct {
    uint8_t *bytes;
    size_t size, capacity;
    int exact_colors;
    bool exceeded;
} GifOutput;

static int gif_write(GifFileType *gif, const GifByteType *bytes, int length) {
    GifOutput *output = gif->UserData;
    if (output->exceeded || (size_t)length > MAX_FILE_BYTES - output->size) {
        output->exceeded = true;
        return 0;
    }
    size_t size = output->size + (size_t)length;
    if (size > output->capacity) {
        size_t capacity = output->capacity ? output->capacity * 2 : 4096;
        while (capacity < size) capacity *= 2;
        uint8_t *buffer = realloc(output->bytes, capacity);
        if (!buffer) fail("ui:memoryLimit");
        output->bytes = buffer;
        output->capacity = capacity;
    }
    memcpy(output->bytes + output->size, bytes, (size_t)length);
    output->size = size;
    return length;
}

// Keep the input colors exactly when they fit, including close colors that
// GIFLIB's median-cut quantizer would otherwise place in the same bucket.
static int exact_gif_palette(const uint8_t *pixels, size_t count, int first, int limit,
                             GifByteType *indices, GifColorType palette[256]) {
    uint16_t lookup[512] = {0};
    int colors = first;
    for (size_t i = 0; i < count; i++, pixels += 4) {
        if (gif_transparent(pixels)) {
            indices[i] = 0;
            continue;
        }
        uint32_t rgb = ((uint32_t)pixels[0] << 16) | ((uint32_t)pixels[1] << 8) | pixels[2];
        unsigned slot = (rgb * 2654435761u) >> 23;
        while (lookup[slot]) {
            GifColorType color = palette[lookup[slot] - 1];
            if (color.Red == pixels[0] && color.Green == pixels[1] && color.Blue == pixels[2]) break;
            slot = (slot + 1) % 512;
        }
        if (!lookup[slot]) {
            if (colors == limit) return 0;
            palette[colors++] = (GifColorType){pixels[0], pixels[1], pixels[2]};
            lookup[slot] = (uint16_t)colors;
        }
        indices[i] = (GifByteType)(lookup[slot] - 1);
    }
    return colors;
}

static int quantize_gif_palette(const uint8_t *pixels, size_t count, int first, int limit,
                                GifByteType *indices, GifColorType palette[256], uint8_t **planes) {
    if (!*planes) *planes = allocate(3 * count);
    uint8_t *red = *planes, *green = red + count, *blue = green + count;
    unsigned opaque = 0;
    for (size_t i = 0; i < count; i++) {
        const uint8_t *pixel = pixels + i * 4;
        if (gif_transparent(pixel)) continue;
        red[opaque] = pixel[0];
        green[opaque] = pixel[1];
        blue[opaque++] = pixel[2];
    }
    int colors = limit - first;
    if (GifQuantizeBuffer(opaque, 1, &colors, red, green, blue, indices, palette + first) == GIF_ERROR ||
        colors <= 0 || colors > limit - first) {
        fail("ui:encodeGif");
    }
    if (first) {
        // Expand the opaque indices in place from the end, reserving index 0.
        for (size_t i = count; i > 0; i--) {
            indices[i - 1] = gif_transparent(pixels + (i - 1) * 4) ? 0 : indices[--opaque] + 1;
        }
    }
    return colors + first;
}

static bool put_gif_frame(GifFileType *gif, const Animation *a, GifByteType *indices,
                          const GifColorType palette[256], int colors, unsigned delay, bool transparent) {
    int table_size = 2;
    while (table_size < colors) table_size *= 2;
    ColorMapObject *map = GifMakeMapObject(table_size, palette);
    if (!map) fail("ui:memoryLimit");
    GraphicsControlBlock control = {
        transparent ? DISPOSE_BACKGROUND : DISPOSE_DO_NOT,
        false, (int)delay, transparent ? 0 : NO_TRANSPARENT_COLOR,
    };
    GifByteType extension[4];
    EGifGCBToExtension(&control, extension);
    bool ok = EGifPutExtension(gif, GRAPHICS_EXT_FUNC_CODE, sizeof(extension), extension) != GIF_ERROR &&
              EGifPutImageDesc(gif, 0, 0, a->width, a->height, false, map) != GIF_ERROR;
    GifFreeMapObject(map);
    for (unsigned y = 0; ok && y < a->height; y++) {
        ok = EGifPutLine(gif, indices + (size_t)y * a->width, a->width) != GIF_ERROR;
    }
    return ok;
}

static unsigned gif_plays(const Animation *a) {
    if (a->count == 1) return 1;
    return a->plays > UINT16_MAX + 1u ? UINT16_MAX + 1u : a->plays;
}

static GifOutput encode_gif(const Animation *a, const unsigned *delays, int limit, bool transparent) {
    GifOutput output = {0};
    GifFileType *gif = EGifOpen(&output, gif_write, NULL);
    if (!gif) fail("ui:encodeGif");
    EGifSetGifVersion(gif, true);
    ColorMapObject *background = GifMakeMapObject(2, NULL);
    if (!background) fail("ui:memoryLimit");
    bool ok = EGifPutScreenDesc(gif, a->width, a->height, 8, 0, background) != GIF_ERROR;
    GifFreeMapObject(background);
    unsigned plays = gif_plays(a);
    if (ok && plays != 1) {
        unsigned repeats = plays ? plays - 1 : 0;
        const GifByteType loop[] = {1, (GifByteType)repeats, (GifByteType)(repeats >> 8)};
        ok = EGifPutExtensionLeader(gif, APPLICATION_EXT_FUNC_CODE) != GIF_ERROR &&
             EGifPutExtensionBlock(gif, 11, "NETSCAPE2.0") != GIF_ERROR &&
             EGifPutExtensionBlock(gif, sizeof(loop), loop) != GIF_ERROR &&
             EGifPutExtensionTrailer(gif) != GIF_ERROR;
    }
    size_t count = (size_t)a->width * a->height;
    GifByteType *indices = allocate(count);
    uint8_t *planes = NULL;
    for (unsigned i = 0; ok && !output.exceeded && i < a->count; i++) {
        const uint8_t *pixels = a->frames[i].pixels;
        GifColorType palette[256] = {0};
        int first = transparent ? 1 : 0;
        int colors = exact_gif_palette(pixels, count, first, limit, indices, palette);
        if (!colors) colors = quantize_gif_palette(pixels, count, first, limit, indices, palette, &planes);
        if (colors > output.exact_colors) output.exact_colors = colors;
        ok = put_gif_frame(gif, a, indices, palette, colors, delays[i], transparent);
    }
    if (planes) output.exact_colors = 0;
    free(planes);
    free(indices);
    int closed = EGifCloseFile(gif, NULL);
    if (output.exceeded) {
        free(output.bytes);
        return (GifOutput){.exceeded = true};
    }
    if (!ok || closed == GIF_ERROR) fail("ui:encodeGif");
    return output;
}

static void gif_delays(const Animation *a, unsigned *delays) {
    uint64_t source_ms = 0, output_cs = 0;
    for (unsigned i = 0; i < a->count; i++) {
        source_ms += a->frames[i].delay;
        uint64_t end_cs = (source_ms + 5) / 10;
        uint64_t delay = end_cs > output_cs ? end_cs - output_cs : 1;
        if (a->count == 1 || !a->frames[i].delay) delay = 0;
        if (delay > UINT16_MAX) fail("ui:gifDelayLimit");
        delays[i] = (unsigned)delay;
        output_cs += delay;
    }
}

static bool gif_needs_transparency(const Animation *a) {
    if (!a->alpha) return false;
    size_t bytes = frame_bytes(a);
    for (unsigned i = 0; i < a->count; i++) {
        const uint8_t *pixels = a->frames[i].pixels;
        for (size_t offset = 0; offset < bytes; offset += 4) {
            if (gif_transparent(pixels + offset)) return true;
        }
    }
    return false;
}

static void convert_gif(size_t source_size, const Animation *a, const char *path, uint64_t target) {
    unsigned delays[MAX_FRAMES];
    gif_delays(a, delays);
    // Partial alpha that rounds to opaque does not need a palette entry.
    bool transparent = gif_needs_transparency(a);
    const int levels[] = {256, 128, 64, 32, 16};
    GifOutput best = {0};
    int colors = 0;
    int exact_colors = 0;
    for (unsigned i = 0; i < sizeof(levels) / sizeof(levels[0]); i++) {
        // A cap that still fits every exact palette would reproduce the same bytes.
        if (exact_colors && levels[i] >= exact_colors) continue;
        GifOutput candidate = encode_gif(a, delays, levels[i], transparent);
        exact_colors = candidate.exact_colors;
        if (!candidate.exceeded && (!best.bytes || candidate.size < best.size)) {
            free(best.bytes);
            best = candidate;
            colors = levels[i];
        } else {
            free(candidate.bytes);
        }
        if (!target || (best.bytes && best.size <= target)) break;
    }
    if (!best.bytes) fail("ui:outputLimit");
    WebPData result = {best.bytes, best.size};
    Animation output = {0};
    const OutputCheck check = {.source = a, .gif_delays = delays};
    decode_gif(result, &output, &check);
    if (output.count != a->count || output.recovered || output.plays != gif_plays(a)) {
        fail("ui:outputIntegrity");
    }
    save_result(path, result, "ui:saveGif");
    printf("{\"quality\":%d,\"unchanged\":false,\"source\":", colors);
    print_info(a, source_size);
    printf(",\"output\":");
    print_info(&output, best.size);
    puts("}");
    free(best.bytes);
}

static uint64_t unsigned_arg(const char *text, uint64_t max, const char *error) {
    char *end;
    errno = 0;
    unsigned long long result = strtoull(text, &end, 10);
    if (errno || !*text || *end || *text == '-' || result > max) fail(error);
    return result;
}

static void decode_video(char **args, Animation *a) {
    a->format = args[3];
    if (strcmp(a->format, "MP4") && strcmp(a->format, "MOV") && strcmp(a->format, "WebM")) {
        fail("ui:unsupportedVideo");
    }
    unsigned width = (unsigned)unsigned_arg(args[4], 1920, "ui:invalidCanvas");
    unsigned height = (unsigned)unsigned_arg(args[5], 1920, "ui:invalidCanvas");
    unsigned fps = (unsigned)unsigned_arg(args[6], MAX_VIDEO_FPS, "ui:invalidDimensions");
    unsigned length = (unsigned)unsigned_arg(args[7], 600000, "ui:invalidTrim");
    if (!fps || !length) fail("ui:invalidTrim");
    dimensions(a, width, height);
    a->animated = true;
    a->decoded_limit = MAX_ANIMATION_DECODED;
    size_t bytes = frame_bytes(a);
    FILE *file = fopen(args[2], "rb");
    if (!file) fail("ui:incompleteVideo");
    uint8_t *rgba = allocate(bytes);
    for (unsigned frame = 0; ; frame++) {
        unsigned start = (frame * 1000u + fps / 2u) / fps;
        if (start >= length) break;
        unsigned end = ((frame + 1u) * 1000u + fps / 2u) / fps;
        if (end > length) end = length;
        if (fread(rgba, 1, bytes, file) != bytes) fail("ui:incompleteVideo");
        append(a, rgba, end - start);
    }
    if (a->count < 2 || fgetc(file) != EOF || ferror(file)) fail("ui:incompleteVideo");
    free(rgba);
    fclose(file);
}

static uint8_t *fit_frame(const Animation *canvas, Animation *source, unsigned index, bool last_use) {
    Frame *frame = &source->frames[index];
    uint8_t *input = frame->pixels;
    if (canvas->width == source->width && canvas->height == source->height) {
        if (last_use) {
            frame->pixels = NULL;
            return input;
        }
        uint8_t *copy = allocate(frame_bytes(canvas));
        memcpy(copy, input, frame_bytes(canvas));
        return copy;
    }
    CGDataProviderRef provider = CGDataProviderCreateWithData(NULL, input, frame_bytes(source), NULL);
    CGColorSpaceRef color = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    if (!provider || !color) fail("ui:memoryLimit");
    CGImageRef image = CGImageCreate(source->width, source->height, 8, 32, source->width * 4,
        color, kCGImageAlphaLast | kCGBitmapByteOrder32Big, provider, NULL, true, kCGRenderingIntentDefault);
    CGColorSpaceRelease(color);
    CGDataProviderRelease(provider);
    if (!image) fail("ui:invalidCanvas");
    double xscale = (double)canvas->width / source->width, yscale = (double)canvas->height / source->height;
    double scale = xscale < yscale ? xscale : yscale;
    unsigned width = (unsigned)(source->width * scale + .5), height = (unsigned)(source->height * scale + .5);
    if (!width) width = 1;
    if (!height) height = 1;
    CGRect rect = CGRectMake((canvas->width - width) / 2, (canvas->height - height) / 2, width, height);
    uint8_t *pixels = render_cgimage(canvas, image, rect);
    CGImageRelease(image);
    return pixels;
}

static uint32_t edit_word(FILE *file) {
    uint8_t bytes[4];
    if (fread(bytes, 1, sizeof(bytes), file) != sizeof(bytes)) fail("ui:invalidFrameEdit");
    return read_le32(bytes);
}

static size_t decode_frame_edit(const char *path, Animation *canvas) {
    FILE *file = fopen(path, "rb");
    if (!file) fail("ui:invalidFrameEdit");
    if (edit_word(file) != 0x31463241u) fail("ui:invalidFrameEdit"); // A2F1
    unsigned width = edit_word(file), height = edit_word(file);
    dimensions(canvas, width, height);
    canvas->plays = edit_word(file);
    canvas->count = edit_word(file);
    unsigned groups = edit_word(file);
    if (canvas->count < 2 || canvas->count > MAX_FRAMES || !groups || groups > canvas->count ||
        frame_bytes(canvas) * canvas->count > MAX_ANIMATION_DECODED) fail("ui:frameEditorBudget");
    canvas->animated = true;
    canvas->decoded_limit = MAX_ANIMATION_DECODED;
    canvas->format = "FRMS";
    size_t bytes = 0;
    bool occupied[MAX_FRAMES] = {false};
    for (unsigned i = 0; i < groups; i++) {
        char source_path[4097];
        unsigned length = edit_word(file);
        if (!length || length >= sizeof(source_path) || fread(source_path, 1, length, file) != length ||
            memchr(source_path, 0, length)) fail("ui:invalidFrameEdit");
        source_path[length] = 0;
        unsigned count = edit_word(file);
        if (!count || count > canvas->count) fail("ui:invalidFrameEdit");
        WebPData data = read_input(source_path);
        Animation source = {0};
        decode(data, &source);
        bytes += data.size;
        free((void *)data.bytes);
        canvas->recovered |= source.recovered;
        struct { unsigned slot, index, delay; } edits[MAX_FRAMES];
        unsigned uses[MAX_FRAMES] = {0};
        for (unsigned j = 0; j < count; j++) {
            unsigned slot = edit_word(file), index = edit_word(file), delay = edit_word(file);
            if (slot >= canvas->count || occupied[slot] || index >= source.count ||
                delay > 0xffffffu) fail("ui:invalidFrameEdit");
            occupied[slot] = true;
            edits[j].slot = slot;
            edits[j].index = index;
            edits[j].delay = delay;
            uses[index]++;
        }
        for (unsigned j = 0; j < count; j++) {
            unsigned index = edits[j].index;
            uint8_t *pixels = fit_frame(canvas, &source, index, --uses[index] == 0);
            store_frame(canvas, edits[j].slot, pixels, edits[j].delay);
        }
        release(&source);
    }
    if (fgetc(file) != EOF || ferror(file)) fail("ui:invalidFrameEdit");
    fclose(file);
    for (unsigned i = 0; i < canvas->count; i++) {
        if (!canvas->frames[i].pixels) fail("ui:invalidFrameEdit");
    }
    return bytes;
}

int main(int argc, char **argv) {
    unsigned strengths[3] = {0};
    if (argc >= 5 && !strcmp(argv[argc - 4], "--adjust")) {
        for (int i = 0; i < 3; i++) {
            strengths[i] = (unsigned)unsigned_arg(argv[argc - 3 + i], 100, "ui:invalidStrength");
        }
        argc -= 4;
    }
    bool inspect = argc == 3 && !strcmp(argv[1], "inspect");
    bool edit = (argc == 3 && !strcmp(argv[1], "preview-frames")) ||
                (argc == 5 && (!strcmp(argv[1], "convert-frames") || !strcmp(argv[1], "convert-frames-gif")));
    bool view = argc == 3 && (edit || !strcmp(argv[1], "preview"));
    bool gif_export = (argc == 5 && (!strcmp(argv[1], "convert-gif") || !strcmp(argv[1], "convert-frames-gif"))) ||
                      (argc == 11 && !strcmp(argv[1], "convert-video-gif"));
    bool export = argc == 5 && (edit || gif_export || !strcmp(argv[1], "convert"));
    bool video_view = argc == 9 && !strcmp(argv[1], "preview-video");
    bool video_export = argc == 11 && (gif_export || !strcmp(argv[1], "convert-video"));
    if (!inspect && !view && !export && !video_view && !video_export) fail("ui:invalidCommand");
    WebPData source = {0};
    Animation animation = {0};
    if (video_view || video_export) {
        source.size = unsigned_arg(argv[8], SIZE_MAX, "ui:invalidVideo");
        decode_video(argv, &animation);
    } else if (edit) {
        source.size = decode_frame_edit(argv[2], &animation);
    } else {
        source = read_input(argv[2]);
        decode(source, &animation);
    }
    bool adjusted = strengths[0] || strengths[1] || strengths[2];
    if (adjusted && !inspect) adjust(&animation, strengths[0], strengths[1], strengths[2]);
    if (inspect) {
        print_info(&animation, source.size);
        putchar('\n');
    } else if (view || video_view) {
        preview(&animation, source.size > UINT32_MAX ? UINT32_MAX : source.size);
    } else {
        int output = video_export ? 9 : 3;
        uint64_t target = unsigned_arg(argv[output + 1], UINT64_MAX, "ui:invalidTarget");
        if (gif_export) convert_gif(source.size, &animation, argv[output], target);
        else convert_webp(source, &animation, argv[output], target, adjusted);
    }
    if (fflush(stdout)) fail("ui:externalRead");
    release(&animation);
    free((void *)source.bytes);
    return EXIT_SUCCESS;
}
