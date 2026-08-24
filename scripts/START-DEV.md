# Paseo Desktop 开发启动脚本（Windows）

本目录下的 `start-paseo-dev.ps1` 与 `start-paseo-dev.bat` 是 **Paseo Desktop 源码模式启动入口**（turn-recovery 版本），用于在 Windows 上以真实用户数据启动桌面端（Electron + Metro + 后台 daemon）。

## 启动方式

在 **仓库根目录**（`paseo/`）下执行：

```powershell
.\scripts\start-paseo-dev.bat
```

或直接：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-paseo-dev.ps1
```

> 脚本通过 `$PSScriptRoot` 自动定位仓库根，不依赖固定的克隆路径，可放在任意位置的 clone 中直接使用。

## 与官方 `scripts/dev.ps1` 的区别

- `scripts/dev.ps1`：官方入口，使用**临时 HOME**（或按 worktree 派生）、daemon 端口 **6768**、纯 `watch` 模式。
- `scripts/start-paseo-dev.ps1`：**本机调试入口（turn-recovery）**，使用**真实用户 HOME** `~/.paseo`、daemon 端口 **6767**，并聚焦「进程/文件状态恢复」的健壮性。两者用途不同，不要互相覆盖。

## 脚本做了什么（4 个阶段）

| 阶段                | 动作                                                                                                                                                              | 解决的坑                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `[1/4]` 依赖就绪    | 检查 `node_modules/.bin/tsc`，缺失则 `npm install`；检查 5 个内部包（protocol/client/highlight/plugin/relay）的 dist 探针文件，缺失则 `npm run build:server-deps` | `'tsc' 不是内部或外部命令`；`Cannot find module '@getpaseo/...'`                |
| `[2/4]` server dist | 比对 server 源码是否有更新，有则重建 `@getpaseo/server`                                                                                                           | 桌面 daemon 加载的是 `dist` 而非 TS，源码改动后 dist 过期导致 provider 探测失败 |
| `[3/4]` 端口 6767   | 若 6767 被已打包版或旧源码 daemon 占用，自动停止并重启                                                                                                            | 开发客户端误连已安装版 daemon、或复用旧 daemon 不加载新 dist                    |
| `[4/4]` 启动桌面端  | 设定 `PASEO_HOME` 等环境变量后调用 `packages/desktop/scripts/dev.ps1`                                                                                             | —                                                                               |

## 自愈逻辑（防坑）

首次 clone 或重建 `node_modules` 后，不需要手动预构建 —— 脚本会自动补齐依赖与内部包 dist，直接启动即可。

## 注意

- 仅适用于 Windows 桌面调试；macOS/Linux 请使用仓库内对应脚本。
- 若 6767 端口被其他程序占用且脚本提示确认，请先关闭对应进程再重跑。
