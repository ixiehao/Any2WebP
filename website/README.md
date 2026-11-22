# Any2WebP 官网

使用 GitHub Pages 发布三种语言的静态页面。英文在根路径，简体中文在 `zh/`，日语在 `ja/`。[Any2WebP 官网](https://ixiehao.github.io/Any2WebP/)

```sh
rustup target add wasm32-unknown-unknown
./website/converter/build.sh
node website/build.mjs
node website/verify.mjs
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist/website
```

`content.mjs` 保存三语文案，构建脚本复用项目截图、图标、测试动图和许可文件。Mac 正式版按钮通过 GitHub `releases/latest/download/` 直接获取附件，三个语言的 `download/` 路径指向该 DMG。Windows x64 预览版按钮直连对应的预发布附件，安装说明和 SHA-256 链接放在首页的 `#windows-preview`。更新版本时修改 `build.mjs` 中相应的附件名并验证下载和 SHA-256。

## 搜索入口

首页提供 Mac 正式版与 Windows x64 预览版，介绍本机批量转换、JPG／PNG／GIF 转 WebP 与视频转动图。四篇三语教程按 Mac 版操作编写，涵盖 GIF 转无损 WebP、按目标体积压缩 WebP、视频片段转动图和系列图片合成动图。操作步骤和适用边界由 `guides.mjs` 维护。首页、教程和语言切换均用静态链接。

搜索页有独立标题、描述和 canonical，语言版本互相声明 `hreflang`，英文为默认。首页以 `SoftwareApplication` 描述免费应用、兼容性、截图和下载入口。Sitemap 收录首页与教程，下载跳转页标记为 `noindex`。域名根目录的 robots.txt 由 [个人主页仓库](https://github.com/ixiehao/ixiehao.github.io) 指向项目 Sitemap。构建后运行 `website/verify.mjs` 核对上述入口。

## 在线转换

首屏以 Mac 版下载为主入口，另设 Windows x64 预览版下载。在线体验独占一栏，位于 Mac 版功能介绍之后，可一次将一张 JPG、静态 PNG 或 GIF 转为 WebP。浏览器把文件交给独立 Worker，使用 WebAssembly 转换，站点只提供程序资源。每个文件最多 16 MB、12.5 百万像素和 8192 px 长边。GIF 最多 240 帧且累计画布不超过 2400 万像素，支持透明度、帧延时与循环。转换保留解码后的画面，有限循环次数最多为 WebP 可表示的 65,535 次。

`converter/Cargo.lock` 锁定浏览器转换器依赖。构建时发布 WebAssembly 和依赖许可证，可在 `ONLINE-CONVERTER-NOTICES.txt` 查阅。使用 `cargo test --manifest-path website/converter/Cargo.toml --locked` 验证编解码。

## 图片和下载素材

| 素材 | 可复用文件 | 规格 |
| --- | --- | --- |
| 应用截图 | [简体中文](../docs/assets/any2webp-zh-CN.png) · [English](../docs/assets/any2webp-en.png) · [日本語](../docs/assets/any2webp-ja.png) | 2480 × 1550 PNG，展示 Any2WebP v0.2.30 的无损转换。以青羽蜂鸟 GIF（1,083,393 字节）为源，导出的 WebP 为 748,866 字节。 |
| 产品图标 | [Any2WebP 图标](../src-tauri/icons/icon.png) | 1024 × 1024 PNG。 |
| 动图体积对照 | [青羽蜂鸟 GIF](../docs/assets/hummingbird-loop.gif) · [无损 WebP](../docs/assets/hummingbird-loop.webp) | 使用截图中的文件。480 × 336，60 帧，3 秒无限循环，保留透明背景。GIF 1,083,393 字节，WebP 748,866 字节，体积减小 30.9%。 |
| 规格说明 | Apple Silicon，macOS 26.0 或更新版本 | 视频需要 FFmpeg 和 ffprobe。图片转换可直接使用。 |
| 开源说明 | [MIT 许可证](../LICENSE) · [第三方许可](../NOTICE.md) | 下载与源代码均指向官方 GitHub 仓库。 |

教程截图来自隔离的 WebKit 测试窗口，使用当前软件界面、编解码程序和青羽蜂鸟示例及其衍生素材。截图按语种保存于 `assets/tutorials/`，对应的替代文本和说明由 `guide-screens.mjs` 维护。点击截图可查看原尺寸。

### 页面信息

- 构建时从两份动图文件读取字节数，以十进制 KB、MB 显示体积并计算百分比。替换素材时同步更新三语 README、首帧海报和播放帧图。
- 首屏使用对应语言的静态应用截图。动图进入可见范围后同步播放，可以在同一帧暂停或继续。开启「减少动态效果」时，显示首帧，点击后播放。网页用 8 列的无损 WebP 帧图同步播放，并提供实际 GIF 和 WebP 文件链接。帧图从真实 WebP 成品提取，生成时逐帧核对 GIF 和 WebP 的可见像素、透明度与帧延时一致。
