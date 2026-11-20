#include "adjustment.h"
#include <stddef.h>

static void adjacent(size_t offsets[4], size_t offset, unsigned x, unsigned y,
                     unsigned width, unsigned height) {
    size_t stride = (size_t)width * 4;
    offsets[0] = x ? offset - 4 : offset;
    offsets[1] = x + 1 < width ? offset + 4 : offset;
    offsets[2] = y ? offset - stride : offset;
    offsets[3] = y + 1 < height ? offset + stride : offset;
}

static int luma(const uint8_t *pixel) {
    return (54 * pixel[0] + 183 * pixel[1] + 19 * pixel[2] + 128) >> 8;
}

static unsigned difference(int a, int b) {
    int delta = a - b;
    return (unsigned)(delta < 0 ? -delta : delta);
}

static void copy_pixels(uint8_t *restrict to, const uint8_t *restrict from, size_t size) {
    for (size_t offset = 0; offset < size; offset++) to[offset] = from[offset];
}

void adjust_rgba(uint8_t *pixels, uint8_t *scratch, unsigned width, unsigned height,
                 unsigned shadows, unsigned denoise, unsigned sharpen) {
    size_t bytes = (size_t)width * height * 4;
    if (denoise) {
        copy_pixels(scratch, pixels, bytes);
        for (unsigned y = 0; y < height; y++) {
            for (unsigned x = 0; x < width; x++) {
                size_t offset = ((size_t)y * width + x) * 4;
                const uint8_t *center = scratch + offset;
                if (!center[3]) continue;
                size_t neighbors[4];
                adjacent(neighbors, offset, x, y, width, height);
                unsigned sum[3] = {0}, count = 0;
                for (unsigned i = 0; i < 4; i++) {
                    const uint8_t *sample = scratch + neighbors[i];
                    if (sample[3] != center[3] || difference(sample[0], center[0]) > 22 ||
                        difference(sample[1], center[1]) > 22 || difference(sample[2], center[2]) > 22) continue;
                    for (unsigned channel = 0; channel < 3; channel++) sum[channel] += sample[channel];
                    count++;
                }
                // Blend the edge-aware local mean into the original, up to a 50% mix.
                unsigned mix = denoise;
                unsigned divisor = 200 * count;
                if (!divisor) continue;
                for (unsigned channel = 0; channel < 3; channel++) {
                    unsigned value = center[channel] * (divisor - mix * count) + mix * sum[channel];
                    pixels[offset + channel] = (uint8_t)((value + divisor / 2) / divisor);
                }
            }
        }
    }
    if (shadows) {
        uint8_t tone[256];
        // MP4Flow's smooth shadow curve, with gain scaled by the selected strength.
        for (unsigned i = 0; i < 256; i++) {
            double x = i / 255.0;
            double lift = .0132 * shadows * x * x * (1 - x) * (1 - x) / (x + .08);
            tone[i] = (uint8_t)((x + lift) * 255.0 + .5);
        }
        for (size_t offset = 0; offset < bytes; offset += 4) {
            if (!pixels[offset + 3]) continue;
            for (unsigned channel = 0; channel < 3; channel++) {
                pixels[offset + channel] = tone[pixels[offset + channel]];
            }
        }
    }
    if (sharpen) {
        // Sharpen changes RGB only. Keep the original luminance once per pixel
        // while reading alpha and each untouched center pixel from the image.
        for (size_t offset = 0; offset < bytes; offset += 4) {
            if (pixels[offset + 3]) scratch[offset / 4] = (uint8_t)luma(pixels + offset);
        }
        for (unsigned y = 0; y < height; y++) {
            for (unsigned x = 0; x < width; x++) {
                size_t offset = ((size_t)y * width + x) * 4;
                const uint8_t *center = pixels + offset;
                if (!center[3]) continue;
                size_t neighbors[4];
                adjacent(neighbors, offset, x, y, width, height);
                int intensity = scratch[offset / 4], sum = 0;
                for (unsigned i = 0; i < 4; i++) {
                    sum += pixels[neighbors[i] + 3] == center[3] ? scratch[neighbors[i] / 4] : intensity;
                }
                int detail = intensity - (sum + 2) / 4;
                unsigned magnitude = difference(detail, 0);
                if (magnitude <= 2) continue;
                magnitude = (magnitude - 2) * sharpen;
                if (magnitude > 2100) magnitude = 2100;
                int delta = (int)((magnitude + 75) / 150);
                if (detail < 0) delta = -delta;
                for (unsigned channel = 0; channel < 3; channel++) {
                    int value = center[channel] + delta;
                    pixels[offset + channel] = (uint8_t)(value < 0 ? 0 : value > 255 ? 255 : value);
                }
            }
        }
    }
}
