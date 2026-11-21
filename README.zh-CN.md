# Any2WebP

[English](README.md) · 简体中文 · [日本語](README.ja.md)

**简洁好用的 WebP 图片转换软件。** 把照片、截图、动图和视频片段转成 WebP 或 GIF。拖入文件，选好导出格式，点一下即可在 Mac 上快速完成批量转换。完全免费，采用 MIT 许可证开源。

[下载 macOS 版](https://ixiehao.github.io/Any2WebP/zh/download/) · [官网](https://ixiehao.github.io/Any2WebP/zh/) · [MIT 许可证](LICENSE)

![Any2WebP 同步对比青羽蜂鸟的 GIF 原图与无损 WebP 成品](docs/assets/any2webp-zh-CN.png)

*下方对比使用截图中的 GIF 原图和无损 WebP 成品。*

## 三步完成转换

1. 点「**转换文件**」，或把图片和视频拖入窗口。多张静态图可以批量转换，每张单独保存。
2. 选择 WebP 或 GIF。WebP 默认使用无损压缩，也可以为两种格式指定目标体积。
3. 点「**导出**」。同步预览可逐帧比较转换前后的画面，成品信息会显示实际体积、帧延时、播放次数和透明度。

转换在本机完成，WebP 编码使用随应用打包的 libwebp。大尺寸长动图以及需要反复试压的目标体积任务会花更多时间。

## 制作和编辑动图

| 想做什么 | 怎么做 |
| --- | --- |
| 把一组图片合成动图 | 点「**多图合成动图**」，选入多张 JPG、PNG 等图片。文件名先按自然顺序排列，可拖动缩略图调整顺序。 |
| 截取一段视频做成动图 | 点「**视频转动图**」，选入 MP4、MOV 或 WebM，在时间轴选取片段，再设置帧率和长边尺寸。 |
| 编辑已有动图 | 打开 GIF、动图 WebP 或 APNG，点「**编辑帧**」。可以重排、删除、插入和替换帧，或调整单帧停留时间与统一帧率。 |

## 动图怎么选：WebP 和 GIF

| | WebP 动图 | GIF 动图 |
| --- | --- | --- |
| 颜色与透明度 | 真彩色，支持半透明和柔和边缘 | 每帧最多 256 色，透明度只能全透明或不透明 |
| 体积 | 支持有损和无损，通常更省体积 | 简单图形已经够用，复杂画面可能更大或出现色阶 |
| 适合 | 网页动图、透明贴图、视频片段 | 只收 GIF 的平台、旧软件和兼容性优先的场合 |

Any2WebP 将 **「青羽蜂鸟」** GIF 无损导出为 WebP，保留 60 帧、透明背景和 3 秒无限循环。

| [GIF · 1.08 MB](docs/assets/hummingbird-loop.gif) | [WebP · 748.9 KB](docs/assets/hummingbird-loop.webp) |
| --- | --- |
| <img src="docs/assets/hummingbird-loop.gif" width="230" alt="青羽蜂鸟与珊瑚橙花，GIF 版"> | <img src="docs/assets/hummingbird-loop.webp" width="230" alt="青羽蜂鸟与珊瑚橙花，WebP 版"> |

本例的 WebP 成品比 GIF 小 **334.5 KB（30.9%）**。[在官网播放对比](https://ixiehao.github.io/Any2WebP/zh/#formats) · [Google WebP 动图说明](https://developers.google.com/speed/webp/faq)

## 静图怎么选：WebP、PNG 和 JPG

| 格式 | 特点 | 适合 |
| --- | --- | --- |
| **WebP** | 可以无损或有损压缩，支持半透明 | 网站配图、网店商品图和控制体积的截图 |
| **PNG** | 无损，支持半透明 | 保留清晰文字和边缘的截图、界面图、透明素材 |
| **JPG / JPEG** | 有损，常见 JPG 不支持透明，兼容性广 | 照片、旧设备或只接收 JPG 的网站 |

Google 的测试中，无损 WebP 比 PNG 小约 26%，有损 WebP 在相近 SSIM 下比 JPG 小约 25%–34%。已经压过的 JPG 转成无损 WebP 后也可能更大。可先用目标体积，再比较成品画面与实际体积。[Google WebP 概览](https://developers.google.com/speed/webp)

## 安装与格式支持

- 需要 **Apple Silicon Mac 和 macOS 26.0 或更新版本**。打开 DMG，将 Any2WebP 拖入「应用程序」。安装包的签名状态见发布说明。[GitHub Releases](https://github.com/ixiehao/Any2WebP/releases/latest)
- 图片转换可直接使用。处理视频需要 FFmpeg 和 ffprobe，选择「帮助 → 检查依赖…」打开「视频依赖」。已有 Homebrew 时可按需安装或修复。
- 常见输入包括 JPG、PNG、WebP、GIF、APNG、HEIC/HEIF、AVIF、TIFF、BMP、ICO、PSD、JPEG 2000、JPEG XL、MP4、MOV 和 WebM。导出支持 WebP 和 GIF。
- 界面支持简体中文、英语和日语，默认跟随系统，可在 macOS 菜单栏的「语言」菜单切换。
- 在 macOS 菜单栏选择「帮助 → 检查更新」，可查询 GitHub Releases。

<details>
<summary>格式与处理细节</summary>

- 展开「画质调整」可分别调节暗部、降噪和细节。「应用到全部素材」复制三项强度，「归零」恢复默认。
- WebP 目标体积模式先尝试无损，再尝试有损。GIF 按需减少调色板颜色。无法达到指定体积时，保留尝试中最小的结果。画质未调整的已有 WebP 若重压后更大，应用会保留原文件。
- GIF 以 10 毫秒为帧延时单位，只支持二值透明。WebP 有限播放次数上限为 65,535 次。0 ms 帧延时按原值保存，预览提供 100 ms 以便检查。截断的 GIF 可保留完整解码的帧。
- 视频默认取开头最多 3 秒，以 12 FPS 缩放到长边不超过 640 px。可在剪切窗口按输出参数查看最长时长。默认输出无声、无限循环，帧率可选 5–30 FPS，长边最高 1920 px。片段最多 600 帧，未压缩 RGBA 帧累计最多 约 536.87 MB。
- 静态图统一使用 8 位 sRGB。图像文件和导出文件的体积上限为 约 67.11 MB。重编码 WebP 时保留 ICC、EXIF 和 XMP。
- 同名输出自动编号，重压已有 WebP 默认加 `-compressed`。点「打开文件夹」查看保存位置，或点「访达」定位选中的成品。队列在退出后清空。

</details>

[开发与构建](docs/README.md) · [版本记录](CHANGELOG.md) · [反馈](SUPPORT.md) · [隐私](PRIVACY.md) · [第三方许可](NOTICE.md)
