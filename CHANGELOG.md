# Changelog

## 0.2.30

Unreleased.

- English. The native About window includes project information and links. Check for Updates and Check Dependencies are in the Help menu. Follow System is the first option in the Language menu.
- 简体中文。原生「关于」窗口加入项目信息和链接。「帮助」菜单提供「检查更新…」和「检查依赖…」，「语言」菜单首项为「跟随系统」。
- 日本語。「Any2WebP について」にプロジェクト情報とリンクを追加しました。「ヘルプ」からアップデートと依存ツールを確認できます。「言語」の先頭は「システムに従う」です。

## 0.2.28

First public preview.

- English. Show ready video dependencies in green and unavailable dependencies in red. Remove the sample action from the empty workspace.
- 简体中文。视频依赖就绪时显示绿色，未就绪时显示红色。移除空白页的「试用示例」入口。
- 日本語。動画の依存ツールが利用可能な場合は緑、利用できない場合は赤で表示します。空の画面からサンプルボタンを削除しました。

## 0.2.27

Local preview.

- English. Move the queue heading, count, and Clear action directly above the file list.
- 简体中文。将「文件队列」、数量和「清空」移到三个功能入口下方、文件列表上方。
- 日本語。キューの見出し、件数、クリア操作をファイル一覧のすぐ上に移動しました。

## 0.2.26

Local preview.

- English. Add three sidebar actions with Tabler icons for file conversion, combining images, and trimming a video for animation export.
- 简体中文。左侧提供「转换文件」「多图合成动图」「视频转动图」三个入口，采用 Tabler 图标。选入单个视频后可直接剪切。
- 日本語。サイドバーにファイルの変換、画像の合成、動画のアニメ化を追加しました。Tabler アイコンを使い、動画を選ぶと直接トリミング画面が開きます。

## 0.2.25

Local preview.

- English. Clarify still-image export in the queue and preview. Preserve all 256 GIF colors when source alpha rounds to fully opaque.
- 简体中文。明确普通队列中的静态图片导出和成品类型。GIF 像素全部转为不透明时可完整保留 256 色。
- 日本語。キューとプレビューの静止画表示を改善しました。全ピクセルが不透明になる GIF で、256 色すべてを保持できるようになりました。

## 0.2.24

Local preview.

- English. Edit Frames and Finder now share a compact style with Tabler icons and single-line labels.
- 简体中文。「编辑帧」和「访达」统一为紧凑按钮，采用 Tabler 图标和单行标签。
- 日本語。「フレームを編集」と「Finder」のデザインを統一し、Tabler アイコンと一行のラベルを使うようにしました。

## 0.2.23

Local preview.

- English. Verify output frame by frame using less memory. GIF target-size mode skips duplicate palette attempts. Video probing and frame previews reuse recent work. Failed replacement keeps the original frame, and unchanged edits keep the last export.
- 简体中文。减少成品逐帧校验的内存占用，跳过 GIF 目标体积模式的重复编码，复用视频探测和帧预览。修复错误提示丢失、替换失败丢帧及未修改帧却清除成品的问题。
- 日本語。書き出し後のフレーム検証に使うメモリを削減しました。GIF の目標サイズ処理で重複する試行を省き、動画情報とプレビューを再利用します。置き換えに失敗したフレームや、編集内容に変更がない場合の書き出し結果も保持します。

## 0.2.22

Local preview.

- English. Create an animation from still images or edit the frames of a GIF, WebP, or APNG. Reorder frames, change durations, and export to WebP or GIF. The app checks for updates at startup, with a fallback if the Releases page is unavailable.
- 简体中文。支持静态图片合成动图及 GIF、WebP、APNG 逐帧编辑，可调整顺序、统一帧率和单帧停留时间。启动时自动检查更新，发布页无结果时查询 GitHub API。
- 日本語。静止画からアニメーションを作成でき、GIF、WebP、APNG のフレームも編集できます。並び順や表示時間を調整して WebP または GIF に書き出せます。起動時の更新確認と GitHub API へのフォールバックを改善しました。

## 0.2.21

Local preview. Use the [release procedure](docs/RELEASING.md) for the signed public distribution.

- English. Added GIF export for images, animations, and trimmed video clips. WebP remains the startup default. GIF supports target-size attempts and synchronized comparison with the original.
- 简体中文。新增 GIF 导出，支持图片、动图和视频片段。启动默认 WebP。GIF 可按目标体积处理，并和原画面同步预览。
- 日本語。画像、アニメーション、動画の指定区間を GIF に書き出せるようになりました。起動時の既定値は WebP です。GIF でも目標サイズの設定と変換前後の同期プレビューを利用できます。

Apple Silicon only. Requires macOS 26.0 or later. Video input needs local FFmpeg and ffprobe. GIF uses binary transparency and 10 ms frame delay increments.

See [development and verification history](docs/DEVELOPMENT.md) for earlier local versions.
