# MC Server Manager

[English](README.md)

MC Server Manager 是一款独立的 Electron 桌面应用，用于管理本地 Minecraft 服务器配置档。它基于 Electron、React、TypeScript、Node.js 和 SQLite 构建。

## 项目状态

本项目目前是 MVP。它聚焦本地桌面服务器管理、明确的安全确认和可见的失败状态。公开远程管理、RCON 和静默自动内容安装不在首版范围内。

## 前置要求

- Node.js 22
- pnpm 9
- 当前操作系统所需的 Electron 构建环境
- 与计划运行的 Minecraft 版本兼容的本地 Java 运行时

## 首个服务器设置

MC Server Manager 会指引设置流程，但不会替用户选择下载来源或接受法律协议。要启动新的服务器配置档：

1. 创建或导入服务器配置档。
2. 打开 Java 运行时；如果没有检测到所选 Minecraft 版本需要的 Java，请先安装对应版本。
3. 从 Mojang、Paper、Fabric、Forge、NeoForge 或其他可信加载器项目下载正确的服务端 jar。
4. 打开服务器的设置标签，再进入服务器更新，把已下载的文件安装为 `server.jar`。
5. 阅读 Minecraft EULA。如果你接受它，请编辑服务器文件夹里的 `eula.txt`，把 `eula` 设置为 `true`。
6. 启动服务器，并阅读应用显示的任何控制台错误。
7. 更换 jar、mod、配置或世界前先创建备份。

市场会安装 mod、插件或整合包等内容。它不会替代 Java、`server.jar` 和 EULA 接受流程。

## 开发命令

```powershell
pnpm install
pnpm dev              # 仅启动渲染进程开发服务器
pnpm electron:dev     # 启动桌面应用
pnpm vitest run
pnpm build
pnpm electron:build
```

如果 Windows 在 OneDrive 同步工作区内打包 Electron 时出现 `EPERM` 重命名错误，请改用本地临时目录输出：

```powershell
$out = Join-Path $env:TEMP 'mcsm-release'
pnpm exec electron-builder --win --publish never --config.directories.output=$out
```

## 隐私

MC Server Manager 不包含遥测。应用会把本地数据库和服务器元数据保存在用户自己的机器上。

## 市场限制

市场集成是尽力而为的辅助功能，不是完整包管理器。Modrinth 和 Hangar 使用公开 API 搜索。CurseForge 使用官方 API，官方下载需要有效 API key。BBSMC 支持搜索和公开元数据中提供稳定直链的文件安装；只提供网盘链接的版本需要在浏览器下载后手动导入。

应用不会静默自动安装 mod、插件、整合包或服务端 jar。已安装内容的更新需要用户主动检测，然后点击全部更新或单项更新，文件才会被下载和替换。

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
