# MC Server Manager

[English](README.md)

MC Server Manager 是一款独立的 Electron 桌面应用，用于管理本地 Minecraft 服务器配置档。它基于 Electron、React、TypeScript、Node.js 和 SQLite 构建。

## 项目状态

本项目目前是 MVP。它聚焦本地桌面服务器管理、明确的安全确认和可见的失败状态。公开远程管理、RCON 和静默自动内容安装不在首版范围内。

## 前置要求

- Node.js 22
- pnpm 9
- 当前操作系统所需的 Electron 构建环境
- 应用可以复用本机 Java，也可以在用户明确同意后安装托管的 Eclipse Temurin 运行时。

## 首个服务器设置

MC Server Manager 为本地文件、拖放、已有文件夹、空白服务器，以及 Modrinth 内置发现提供统一的可信配置流程。CurseForge 暂不需要 API 密钥，仅支持用户下载后手动导入：

1. 选择或拖入一个服务端整合包、从市场选择服务端包、导入文件夹，或创建空白服务器。
2. 检查自动识别的 Minecraft 与加载器信息。当前支持 Vanilla、Paper、Forge、NeoForge、Fabric 和 Quilt。
3. 应用优先推荐专用服务端包。未验证或偏客户端的压缩包仍可选择，但必须先显示服务端包警告并由用户明确确认；缺失的版本信息必须由用户补充。
4. 复用兼容的 Java，或明确允许应用安装托管的 Eclipse Temurin；托管安装不会修改系统 `PATH`。
5. 设置内存、端口、游戏属性、崩溃重启策略，以及安装完成后是否自动启动。
6. 阅读 Minecraft 条款并明确确认 EULA。每个新方案的 EULA 复选框都默认未选中，应用不会代替用户接受。
7. 应用只下载加载器适配器认可的服务端文件，校验可用哈希，删除整合包自带脚本，写入配置，原子提交文件，创建配置档，并按用户选择启动服务器。

中断的安装会持久化。下次启动应用时，用户可以继续未完成任务，或清理尚未提交的暂存文件。

## 开发命令

```powershell
pnpm install
pnpm dev              # 启动完整桌面应用（Vite 渲染进程 + Electron 本地后端）
pnpm dev:renderer     # 仅启动渲染进程开发服务器
pnpm electron:dev     # pnpm dev 的兼容别名
pnpm vitest run
pnpm build
pnpm electron:build
```

如果 Windows 在 OneDrive 同步工作区内打包 Electron 时出现 `EPERM` 重命名错误，请改用本地临时目录输出：

```powershell
$out = Join-Path $env:TEMP 'mcsm-release'
pnpm exec electron-builder --win --publish never --config.directories.output=$out
```

## 发布构建

GitHub Actions 会从 tag release 发布按平台区分的 Electron 产物：

- Windows：已签名的 NSIS 安装器，以及 `latest.yml` 更新元数据。
- Linux：AppImage 和 `.deb` 包。
- macOS：已签名并完成公证的 `.dmg` 和 `.zip` 包。

稳定版发布采用失败关闭策略：Windows 必须配置 `WINDOWS_CSC_LINK` 和 `WINDOWS_CSC_KEY_PASSWORD`；macOS 必须配置 `MACOS_CSC_LINK`、`MACOS_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 与 `APPLE_TEAM_ID`。本地开发构建仍可在没有这些 GitHub secrets 的情况下运行 `pnpm electron:build`。

## 隐私

MC Server Manager 不包含遥测。应用会把本地数据库和服务器元数据保存在用户自己的机器上。

## 市场限制

市场集成是尽力而为的辅助功能，不是通用包管理器。Modrinth 提供应用内整合包发现。配置官方 API 凭据前，CurseForge 服务端整合包必须另行下载并手动导入。Hangar 与 BBSMC 继续支持公开元数据中提供稳定直链的兼容内容；只提供网盘链接的版本仍需在浏览器下载后手动导入。

启动配置流程始终是用户操作。兼容性警告、托管 Java 安装、EULA 接受和已安装内容更新，均需要各自可见的确认或操作。

## 应用更新

打包后的应用可以从 GitHub Releases 检查应用更新。更新下载需要用户手动确认，并且托管服务器运行时会阻止安装更新。

## 备份

默认只备份世界文件。只有用户明确选择非默认备份配置档时，备份范围才会扩大。

## 首版限制

- 无 RCON。
- 无公开远程管理界面。
- 无遥测。
- 无静默自动内容安装。
- 无停机期间错过任务的自动补跑。
- 诊断只报告问题，不会自动修改设置。
