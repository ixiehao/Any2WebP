# Privacy / 隐私 / プライバシー

## English

Any2WebP processes selected media locally. It reads the files you add, uses temporary local files as needed, and writes exports to your chosen folder or next to the source. The export queue clears when the app quits. Language, panel state, and update-check state are stored locally.

**Check for Updates** sends an anonymous HTTPS request for repository release metadata with an Any2WebP user-agent. macOS also checks in the background. GitHub receives the network address used for the request. The app does not send media, filenames, or export settings. Opening the release page hands its URL to your browser. On macOS, **Install or Repair** invokes local Homebrew on request, and Homebrew may contact its own download services. On Windows, the installer contacts Microsoft to install the WebView2 Runtime when it is missing. FFmpeg and ffprobe run locally and are installed separately on Windows.

## 简体中文

Any2WebP 在本机处理选中的素材，按需使用临时文件，并将成品保存到指定位置或原文件旁。退出后清空队列。语言、面板状态和更新检查状态保存在本机。

选择「检查更新」时，应用使用 Any2WebP 的 User-Agent，通过 HTTPS 匿名请求 GitHub 的公开发行信息。macOS 也会在后台检查。GitHub 会收到该请求的网络地址。请求不包含素材、文件名或导出设置。发布页由默认浏览器打开。macOS 的「安装或修复」按需调用本机 Homebrew，Homebrew 可能访问自己的下载服务。Windows 安装器在缺少 WebView2 时会连接微软下载安装运行时。Windows 的 FFmpeg 和 ffprobe 另行安装，在本机运行。

## 日本語

選択した素材はこの端末上で処理します。必要に応じて一時ファイルを使い、指定したフォルダか元ファイルの隣に書き出します。アプリを終了するとキューは消去されます。言語、パネルの状態、更新確認の状態はローカルに保存します。

「アップデートを確認」を選ぶと、Any2WebP のユーザーエージェントを使って GitHub に HTTPS で公開リリース情報を匿名で問い合わせます。macOS ではバックグラウンドでも確認します。GitHub には接続元のネットワークアドレスが伝わります。素材、ファイル名、書き出し設定は送信しません。リリースページは既定のブラウザで開きます。macOS で依存ツールのインストールや修復を選ぶと、ローカルの Homebrew が配布元へ接続する場合があります。Windows では WebView2 がない場合にインストーラーが Microsoft に接続してランタイムを導入します。FFmpeg と ffprobe は Windows 上で別途インストールし、ローカルで実行します。
