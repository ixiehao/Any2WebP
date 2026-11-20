#ifndef ANY2WEBP_ADJUSTMENT_H
#define ANY2WEBP_ADJUSTMENT_H

#include <stdint.h>

// RGBA is straight alpha. Scratch must hold width * height * 4 bytes.
void adjust_rgba(uint8_t *pixels, uint8_t *scratch, unsigned width, unsigned height,
                 unsigned shadows, unsigned denoise, unsigned sharpen);

#endif
