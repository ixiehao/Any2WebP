# Privacy / 隐私 / プライバシー

## English

Any2WebP processes selected media locally. It reads the files you add, uses temporary local files as needed, and writes exports to your chosen folder or next to the source. The export queue clears when the app quits. Language, panel state, and update-check state are stored locally.

The app checks GitHub Releases in the background and when you choose **Check for Updates**. It sends an anonymous HTTPS request for repository release metadata with an Any2WebP user-agent. GitHub receives the network address used for the request. The app does not send media, filenames, or export settings. There is no separate switch for automatic checks. Opening the release page hands its URL to your browser. **Install or Repair** in the video-dependency panel invokes your local Homebrew on request. Homebrew may contact its own download services.

## 简体中文

Any2WebP 在本机处理选中的素材，按需使用临时文件，并将成品保存到指定位置或原文件旁。退出后清空队列。语言、面板状态和更新检查状态保存在本机。

应用会自动或按菜单指令向 GitHub 请求公开发行信息，请求使用 Any2WebP 的 User-Agent。GitHub 会收到该请求的网络地址，请求不包含素材、文件名或导出设置。当前没有单独关闭自动检查的选项。打开发布页会交给默认浏览器。「安装或修复」仅在主动操作时调用本机 Homebrew，Homebrew 可能访问自己的下载服务。

## 日本語

選択した素材は Mac 上で処理します。必要に応じて一時ファイルを使い、指定したフォルダか元ファイルの隣に書き出します。アプリを終了するとキューは消去されます。言語、パネルの状態、更新確認の状態はローカルに保存します。

更新の自動確認と手動確認では、Any2WebP のユーザーエージェントで GitHub に公開リリース情報を匿名で問い合わせます。GitHub には接続元のネットワークアドレスが伝わります。素材、ファイル名、書き出し設定は送信しません。自動確認を個別に無効化する設定はありません。リリースページは既定のブラウザで開きます。依存ツールを手動でインストールまたは修復すると、ローカルの Homebrew が呼び出され、Homebrew が配布元へ接続することがあります。
