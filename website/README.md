# Any2WebP 官网

使用 GitHub Pages 发布三种语言的静态页面。英文在根路径，简体中文在 `zh/`，日语在 `ja/`。[Any2WebP 官网](https://ixiehao.github.io/Any2WebP/)

```sh
node website/build.mjs
node website/verify.mjs
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist/website
```

`content.mjs` 保存三语文案，构建脚本复用项目截图、图标、测试动图和许可文件。官网按钮通过 GitHub `releases/latest/download/` 直接获取附件。发布新版本后更新 `build.mjs` 中的附件名并验证下载和 SHA-256 链接。三个语言的 `download/` 路径供 README 使用。

## 搜索入口

首页围绕 Mac 本机批量转换、JPG／PNG／GIF 转 WebP 与视频转动图。两篇三语教程分别介绍 GIF 转无损 WebP 和按目标体积压缩 WebP，操作步骤和适用边界由 `guides.mjs` 维护。首页、教程和语言切换均用静态链接。

搜索页有独立标题、描述和 canonical，语言版本互相声明 `hreflang`，英文为默认。首页以 `SoftwareApplication` 描述免费应用、兼容性、截图和下载入口。Sitemap 收录首页与教程，下载跳转页标记为 `noindex`。域名根目录的 robots.txt 由 [个人主页仓库](https://github.com/ixiehao/ixiehao.github.io) 指向项目 Sitemap。构建后运行 `website/verify.mjs` 核对上述入口。

## 图片和下载素材

| 素材 | 可复用文件 | 规格 |
| --- | --- | --- |
| 应用截图 | [简体中文](../docs/assets/any2webp-zh-CN.png) · [English](../docs/assets/any2webp-en.png) · [日本語](../docs/assets/any2webp-ja.png) | 2480 × 1550 PNG，展示 Any2WebP v0.2.30 的无损转换。以青羽蜂鸟 GIF（1,083,393 字节）为源，导出的 WebP 为 748,866 字节。 |
| 产品图标 | [Any2WebP 图标](../src-tauri/icons/icon.png) | 1024 × 1024 PNG。 |
| 动图体积对照 | [青羽蜂鸟 GIF](../docs/assets/hummingbird-loop.gif) · [无损 WebP](../docs/assets/hummingbird-loop.webp) | 使用截图中的文件。480 × 336，60 帧，3 秒无限循环，保留透明背景。GIF 1,083,393 字节，WebP 748,866 字节，体积减小 30.9%。 |
| 规格说明 | Apple Silicon，macOS 26.0 或更新版本 | 视频需要 FFmpeg 和 ffprobe。图片转换可直接使用。 |
| 开源说明 | [MIT 许可证](../LICENSE) · [第三方许可](../NOTICE.md) | 下载与源代码均指向官方 GitHub 仓库。 |

### 页面信息

- 构建时从两份动图文件读取字节数，以十进制 KB、MB 显示体积并计算百分比。替换素材时同步更新三语 README、首帧海报和播放帧图。
- 首屏使用对应语言的静态应用截图。动图进入可见范围后同步播放，可以在同一帧暂停或继续。开启「减少动态效果」时，显示首帧，点击后播放。网页用 8 列的无损 WebP 帧图同步播放，并提供实际 GIF 和 WebP 文件链接。帧图从真实 WebP 成品提取，生成时逐帧核对 GIF 和 WebP 的可见像素、透明度与帧延时一致。
