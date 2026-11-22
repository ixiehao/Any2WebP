# Any2WebP 打包与 GitHub Releases

公开发布源为 [ixiehao/Any2WebP Releases](https://github.com/ixiehao/Any2WebP/releases)。应用通过同仓的 `releases/latest` 查询正式版本，版本标签使用 `vX.Y.Z`。发布页是查看说明和下载的入口。

## 首次公开源码

1. 检查拟提交文件。源码、公开文档、自制示例和必要的图标可以提交。仅本机使用的设计稿、试用包、归档、缓存和签名材料应留在 Git 之外。
2. 从干净源码副本运行 `./Scripts/verify.sh`，生成并检查包含许可证的本地应用。确认 README 的三个语言版本、[MIT 许可证](../LICENSE)、[第三方声明](../NOTICE.md)、[隐私说明](../PRIVACY.md)和 [反馈模板](../.github/ISSUE_TEMPLATE/) 与项目实际状态一致。
3. 获得公开源码授权后，在 `ixiehao/Any2WebP` 建立 GitHub 仓库并推送已审阅的初始提交。等待 `Verify` 工作流通过后将其设为默认分支必需检查，并启用 [GitHub 私密漏洞报告](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)。检查匿名访问是否看得到三语 README、许可证和反馈表单。
4. 公开源码和公开安装包可分开进行。公开 DMG 按下文选择签名方式，并在发布说明中标注实际签名和公证状态。

## 本机试用

在 Apple Silicon Mac 上按[构建说明](DEVELOPMENT.md)配置工具链。用 Python 3.11 或更新版本创建项目中的打包环境，脚本会校验 DMG 工具的固定版本。已有匹配环境时，可用 `ANY2WEBP_DMG_PYTHON` 指向它的 Python 解释器。

```sh
python3 -m venv dist/.dmg-tools
dist/.dmg-tools/bin/python3 -m pip install -r Scripts/dmg-requirements.txt
./Scripts/prepare-release.sh --preview
```

脚本生成 `dist/releases/vX.Y.Z-arm64-preview/Any2WebP-X.Y.Z-arm64-preview.dmg` 和同名 `.sha256` 文件。试用包使用 ad-hoc 签名。打开 DMG 后，Finder 安装窗口显示应用图标、应用程序入口和三语拖拽说明。打包后会挂载最终镜像并检查窗口设置、位置、背景引用、`Applications` 链接和签名。视频组件可在应用中通过「帮助 → 检查依赖…」检查和安装。

## 准备公开版

1. 在 Any2WebP 的独立 Git 仓库中完成评审和合并。确认 `origin` 指向官方仓库，工作区干净，Cargo、Tauri、应用顶栏与关于窗口使用同一版本。运行[构建与回归](DEVELOPMENT.md)中的检查。
2. 使用批准的签名方式构建。公开版可采用 ad-hoc 签名，发布说明需明确写明未经 Apple 公证，并链接 Apple 的首次打开说明。使用经过公证的分发流程时，将 Developer ID Application 证书及公证凭据存放于钥匙串或 CI Secrets，通过对应环境变量指定。

   ```sh
   ./Scripts/prepare-release.sh --release-ad-hoc

   ANY2WEBP_SIGN_IDENTITY='Developer ID Application: 团队名 (TEAMID)' \
   ANY2WEBP_NOTARY_PROFILE='any2webp-distribution' \
     ./Scripts/prepare-release.sh --stable
   ```

3. 核对 `dist/releases/vX.Y.Z-arm64/` 中的 DMG、SHA-256 和构建来源。脚本验证包内签名、镜像、标识、版本、arm64 架构、最低 macOS 版本和许可文件，公证流程另外验证票据和 Gatekeeper。用镜像中拖出的副本实测启动，导入 [测试动图](../engine/samples/planet.gif) 验证 WebP 和 GIF 导出与成品解码，并核对菜单及顶栏在三种语言下的状态。

## Windows x64 预览包

1. 从已核对的源码构建 [NSIS 试用安装包](DEVELOPMENT.md#windows-10-x64-试用包)。安装包的产品名为 Any2WebP Preview，应用标识为 `com.ixiehao.any2webp.preview`。核对 Cargo 与 Tauri 版本、程序及编解码器的 x64 架构和四份许可文件。
2. 在实际支持的 Windows 版本验证安装、首次启动、转换、多图合成、视频剪切导出和卸载。缺少 WebView2 的环境应单独实测。视频转换依赖本机另装的同版本 FFmpeg 与 ffprobe。记录签名状态、安装提示和未验证项，并计算最终安装包的 SHA-256。
3. 单独发布 Windows 预览包时使用新版本对应的预览标签与 Pre-release 状态。安装器名称保留产品名、版本、`x64-setup.exe` 和 Windows 标识，校验和与安装器一起准备。Windows 和 macOS 的正式应用目前共用 `releases/latest`，正式发布需同时核对两个平台预期的下载附件。

## 发布到 GitHub

1. 得到本次公开发布授权后，确认受保护默认分支上的提交、构建来源和 Git tree 一致，在该提交创建 `vX.Y.Z` 标记。标记与已公开产物保留原版本，修复使用新版本。
2. 在官方仓库创建 Release 草稿，使用该标签，附上 DMG 和对应的 `.dmg.sha256`。从 [CHANGELOG.md](../CHANGELOG.md) 提取英语、简体中文和日语变更说明，写明 Apple Silicon、最低 macOS 26.0、视频依赖和签名状态。预览包同样从匹配标签的干净源码构建，并保留文件名中的 `-preview`。
3. 核对草稿后公开发布。公开版设为 Latest，匿名访问 `releases/latest` 确认跳转到新标签，并用较旧的 Any2WebP 实测「检查更新」。预览版标记为 Pre-release。从公开地址重新下载 DMG 和校验文件，用 `shasum -a 256 -c` 验算并与本地产物比对。同步验证三语官网的 DMG 和校验文件直链。[GitHub Releases 文档](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
