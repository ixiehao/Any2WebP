# Any2WebP

English · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

Any2WebP converts images and video clips to WebP or GIF on your Mac. Batch export files, aim for a file size, and compare original and exported frames on a shared timeline.

![Any2WebP comparing an animated GIF with its WebP export](docs/assets/any2webp-en.png)

## Install

Requires an Apple Silicon Mac running macOS 26.0 or later. [GitHub Releases](https://github.com/ixiehao/Any2WebP/releases) is the official download source. If a DMG is not available yet, [build from source](docs/DEVELOPMENT.md). Open the DMG and drag Any2WebP into Applications. Local previews use ad-hoc signing. The [stable release procedure](docs/RELEASING.md) uses Developer ID signing and Apple notarization.

Image conversion works with the bundled codec. Video input uses a local FFmpeg and ffprobe installation. Check them in **Help → Video Dependencies**. You can install or repair them there if Homebrew is available.

## Quick start

1. Choose **Convert Files** or drop files to queue images and videos together. Each still image exports separately as a still WebP or a single-frame GIF. Choose **Animate Video** to open one video directly in the trim editor. You can then set the animation's frame rate and long-edge size.
2. In **Export settings**, choose WebP or GIF. WebP is the default at startup. Choose lossless WebP, standard GIF, or a target file size.
3. Export, then check canvas size, frame delays, play count, and transparency in the synchronized comparison. If the result exceeds the requested size, the app shows its actual size.

Use **Combine Images** to assemble stills in natural filename order. The first usable image sets the canvas, and other images are centered with transparent padding. Use **Edit Frames** on an existing animation to insert, replace, delete, or reorder frames. Set a uniform frame rate or enter a duration for one frame. The editor shows total duration and estimated memory before applying the edits.

## Format and language support

- Static inputs include JPEG, PNG, WebP, HEIC/HEIF, AVIF, TIFF, BMP, ICO, PSD, JPEG 2000, and JPEG XL. Animated inputs include GIF, WebP, and APNG. Video inputs include MP4, MOV, and WebM.
- Video becomes a silent looping animation. GIF uses up to 256 colors per frame, binary transparency, and 10 ms delay increments. The export engine tries lower palette sizes to fit a GIF size target.
- The app follows the system language by default. Use the macOS **Language** menu to select English, Simplified Chinese, or Japanese.

[Development and testing](docs/README.md) · [Changelog](CHANGELOG.md) · [Support](SUPPORT.md) · [Privacy](PRIVACY.md) · [MIT license](LICENSE) · [Third-party notices](NOTICE.md)
