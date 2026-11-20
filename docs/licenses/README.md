# License sources

`RUST-NOTICES.txt` is generated from the target platform's locked Cargo graph. It includes the crate archive URL and the license files from the archive. The [version-specific overrides](rust-overrides.json) supply license text for crates whose packages omit it.

| Text | Source |
| --- | --- |
| [alloc-stdlib-BSD-3-Clause.txt](alloc-stdlib-BSD-3-Clause.txt) | [Repository license at the crate's recorded commit](https://github.com/dropbox/rust-alloc-no-stdlib/blob/0a81fd6928ea3b33c8cd484aa4575d50ffb98012/LICENSE) |
| [objc2-MIT.txt](objc2-MIT.txt) | [The objc2 project's published MIT text](https://github.com/madsmtm/objc2/blob/main/LICENSE-MIT.txt). The archived crates declare MIT or offer it as an option. |
| [plist-MIT.txt](plist-MIT.txt) | [Repository license at the crate's recorded commit](https://github.com/ebarnard/rust-plist/blob/322f0497b513d8aadc129068724b3059782ecb16/LICENCE) |
| [MPL-2.0.txt](MPL-2.0.txt) | [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/), from the locked `cssparser` package and used for `selectors` |
| [tauri-MIT.txt](tauri-MIT.txt) | The locked `tauri` crate ships this text. Its source commit also produced the locked `tauri-plugin` crate. |
| [libwebp-PATENTS.txt](libwebp-PATENTS.txt) | [libwebp 1.6.0 WebM patent grant](https://github.com/webmproject/libwebp/blob/v1.6.0/PATENTS) |

Review this list when the locked versions change. Use the crate's own license archive when it supplies the text.
