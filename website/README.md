# Any2WebP 官网

使用 GitHub Pages 发布三种语言的静态页面。英文在根路径，简体中文在 `zh/`，日语在 `ja/`。[Any2WebP 官网](https://ixiehao.github.io/Any2WebP/)

```sh
node website/build.mjs
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist/website
```

`content.mjs` 保存三语文案，构建脚本复用项目截图、图标、测试动图和许可文件。官网按钮通过 GitHub `releases/latest/download/` 直接获取附件。发布新版本后更新 `build.mjs` 中的附件名并验证下载和 SHA-256 链接。三个语言的 `download/` 路径供 README 使用。

## 首屏

| | 简体中文 | English | 日本語 |
| --- | --- | --- | --- |
| 标题 | 简洁好用的 WebP 图片转换软件 | A simple WebP image converter for Mac | Mac で使えるシンプルな WebP 画像変換アプリ |
| 简介 | 拖入图片或视频，快速批量转成 WebP 或 GIF。转换在 Mac 上完成，完全免费，MIT 开源。 | Drag in images or videos and quickly batch-convert them to WebP or GIF. Runs locally on your Mac. Free and open source under MIT. | 画像や動画をドラッグして WebP や GIF に一括変換。Mac 上で処理する、MIT ライセンスの無料アプリです。 |
| 主按钮 | 下载 macOS 版 | Download for macOS | macOS 版をダウンロード |
| 次按钮 | 查看源代码 | View source | ソースコードを見る |

[GitHub Releases](https://github.com/ixiehao/Any2WebP/releases) · [源码仓库](https://github.com/ixiehao/Any2WebP)

## 功能文案

| 区块 | 标题 | 说明 |
| --- | --- | --- |
| 批量转换 | 拖进来，一批转完 | 选 WebP 或 GIF，设定目标体积，导出后逐帧比较前后画面。 |
| 多图合成 | 一组图片变成动图 | 导入 JPG、PNG 等图片后，拖动缩略图改变顺序。 |
| 视频剪切 | 从视频截一段生成动图 | 从 MP4、MOV 或 WebM 选取片段，设置帧率和长边尺寸。 |
| 帧编辑 | 把每一帧排到合适的位置 | 打开已有动图，重新排序、删除、插入和替换帧，还可调整停留时间。 |

格式对比与三语操作说明使用 README 的对应章节。动图重点展示 WebP 半透明和较小的体积，以及 GIF 在旧工具和只收 GIF 的平台上的兼容性。静图重点说明 WebP 适合缩小体积，PNG 适合保留文字和透明边缘，JPG 适合照片和兼容性优先的场景。[简体中文](../README.zh-CN.md) · [English](../README.md) · [日本語](../README.ja.md)

## 图片和下载素材

| 素材 | 可复用文件 | 规格 |
| --- | --- | --- |
| 应用截图 | [简体中文](../docs/assets/any2webp-zh-CN.png) · [English](../docs/assets/any2webp-en.png) · [日本語](../docs/assets/any2webp-ja.png) | 2480 × 1550 PNG，展示三个工作入口和同步预览。 |
| 产品图标 | [Any2WebP 图标](../src-tauri/icons/icon.png) | 1024 × 1024 PNG。 |
| 动图体积对照 | [GIF 原图](../engine/samples/planet.gif) · [无损 WebP 成品](../docs/assets/planet.webp) | 320 × 224，24 帧，保留透明度、帧延时和 3 次播放。GIF 47,269 字节，WebP 19,806 字节。该示例体积减少 58.1%。 |
| 规格说明 | Apple Silicon，macOS 26.0 或更新版本 | 视频需要 FFmpeg 和 ffprobe。图片转换可直接使用。 |
| 开源说明 | [MIT 许可证](../LICENSE) · [第三方许可](../NOTICE.md) | 下载与源代码均指向官方 GitHub 仓库。 |

### 页面信息

- 中文标题写「Any2WebP｜免费开源的 macOS WebP 图片转换软件」。
- 中文描述写「在 Mac 上将 JPG、PNG、GIF 和视频片段批量转成 WebP 或 GIF。支持多图合成、视频剪切、动图帧编辑、目标体积和同步预览。」
- 动图示例两侧共用尺寸并显示实际体积。页面用「此示例减少 58.1%」说明结果，具体压缩率随素材和设置变化。
- 首屏使用对应语言的静态应用截图。动图对照放在后面的格式说明区，提供停播或按需播放入口。
