# Third-party notices

Any2WebP source is available under the [MIT license](LICENSE). The included libraries and icons retain their own licenses.

| Component | Use | Terms and source |
| --- | --- | --- |
| libwebp and libsharpyuv | Statically linked image codec | BSD-3-Clause and [WebM patent grant](docs/licenses/libwebp-PATENTS.txt). [Upstream](https://github.com/webmproject/libwebp) |
| GIFLIB | Statically linked GIF reader and writer | MIT-style. [Upstream](https://giflib.sourceforge.net/) |
| Tauri and Rust dependencies | Desktop application and build-time code | The build records the resolved crate versions, licenses, and versioned source links. See [development](docs/DEVELOPMENT.md). [Tauri](https://github.com/tauri-apps/tauri) |
| Tabler Icons Outline 3.49.0 | Inline SVG symbols in `app/index.html` | MIT. [Upstream tag](https://github.com/tabler/tabler-icons/tree/v3.49.0) |
| FFmpeg and ffprobe | External video tools detected locally | Installed separately through Homebrew or by the user. [FFmpeg licensing](https://ffmpeg.org/legal.html) |
| dmgbuild, ds-store, and mac-alias | Build-time DMG tools | Used only to build the DMG. See the versions in [dmg-requirements.txt](Scripts/dmg-requirements.txt). |

The [bundled component notices](docs/THIRD-PARTY-NOTICES.txt) contain the native library and icon acknowledgments. The app icon and the synthetic animation at `engine/samples/planet.gif` are Any2WebP project assets. The sample contains no user media.
