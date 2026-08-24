---
name: paseo-visual-test
description: 启动 Paseo web 可视化测试环境（worktree dev daemon + Expo web + 种子数据 + 内置浏览器）并执行/清理。当用户要求"可视化测试""浏览器验证 UI""起 web 服务看效果"或跑 "/paseo-visual-test" 时使用。遇到新的坑，补充到本文档"坑清单"一节——这里是唯一维护处。
user-invocable: true
---

# Paseo web 可视化测试

在 worktree 里起一套隔离的 dev 环境（daemon 6768 + Expo web 8083），用种子数据构造确定性场景，通过 Paseo 内置浏览器（`mcp__paseo__browser_*`）做视觉与交互验证。**本 skill 是流程与坑的唯一维护处：测试中发现新坑，直接补进对应小节。**

## 0. 前置检查

```bash
# 我方进程环境继承了生产变量，必须显式覆盖，见坑 1
echo "PASEO_HOME=$PASEO_HOME PASEO_LISTEN=$PASEO_LISTEN PASEO_DEV_ROOT=$PASEO_DEV_ROOT"
# 8081 被主仓 Expo 占用（用户的进程，绝不动），worktree 固定用 8083；6768 若被占先清残留
netstat -ano | grep -E ":6768 |:8083 " | grep -i listen
```

## 1. 种子数据（daemon 首次启动前写入）

参考实现：worktree `.dev/seed-visual-test.cjs`（可改可复跑）。写入 worktree 的 `.dev/paseo-home/`：

- `projects/projects.json`、`projects/workspaces.json` —— 字段见 `docs/data-model.md` 第 4/5 节
- `agents/<盘符-路径转杠>/<agentId>.json` —— 目录名规则 `C:\a\b` → `C-a-b`（`agent-storage.ts` 的 `projectDirNameFromCwd`）
- 子代理关系 = label `"paseo.parent-agent-id": "<父id>"`（protocol `agent-labels.ts`）
- provider 用 `"mock"`（protocol manifest 内置、同版本客户端可见、加载零依赖）
- 种子 schema 约束见坑 2、ID 约束见坑 3

**要种会话时间线（消息/工具/任务行）时**，mock provider 不够——它没有历史装载。改用 claude provider + 隔离 config dir：

- agent 记录 `provider: "claude"`、`persistence.sessionId` 指向合成会话
- 启动 daemon 时加 `CLAUDE_CONFIG_DIR=<worktree>/.dev/claude-config`
- 合成转录放 `.dev/claude-config/projects/<编码目录>/<sessionId>.jsonl`；编码规则 = `realpathSync.native` 后非字母数字全替换 `-`（`project-dir.ts` 的 `encode`，种子脚本里有移植）
- 转录行内 JSONL 结构照抄真实 `~/.claude/projects` 转录：assistant 条目 blocks（`thinking`/`text`/`tool_use`），user 条目带 `tool_result` block + 顶层 `toolUseResult`；任务快照由 `task-state.ts` 从 `TaskCreate/TaskUpdate` 的 use+result 对推导（result 条目 `toolUseResult.task.{id,subject}` 提供 id）

## 2. 启动 daemon（6768，独立 home）

```bash
cd <worktree> && PASEO_HOME="<worktree>/.dev/paseo-home" npm run dev:server
```

后台运行；就绪标志（`<worktree>/.dev/paseo-home/daemon.log`）：`Agent registry loaded (N records)` + `Server listening on http://127.0.0.1:6768`。出现 `Skipping invalid agent record` = 种子 schema 不合规（坑 2）。

## 3. 启动 Expo web（8083）

不能用 `npm run dev:app`（坑 4），直接跑脚本：

```bash
cd <worktree> && PASEO_HOME="<worktree>/.dev/paseo-home" PASEO_LISTEN=127.0.0.1:6768 EXPO_PORT=8083 bash scripts/dev-app.sh
```

后台运行；`curl -s -o /dev/null -w "%{http_code}" http://localhost:8083` 返回 200 即就绪（首次打包可能 1-2 分钟）。

## 4. 内置浏览器执行测例

1. `browser_new_tab` 打开 `http://localhost:8083`，`browser_wait` 等种子 workspace 名出现
2. **`browser_snapshot`（a11y 树）驱动交互**：行/按钮的 ref 从 snapshot 拿；无障碍标签自带状态后缀（如 "Fanout Test, Working"），可直接当断言用
3. **`browser_screenshot` + 图像分析验证视觉标记**（色点/徽章/环这类 a11y 树看不到的细节）；截图 URL 交给图像分析工具时要求逐项描述颜色+形状
4. workspace URL 形如 `http://localhost:8083/h/<serverId>/workspace/<workspaceId>`，可直接 `browser_navigate` 回去

## 5. 清理（必做）

```bash
# 1) 停 TaskStop 起的 daemon/metro 后台任务
# 2) 杀 supervisor 进程树 + concurrently/tsc watch 残留（TaskStop 杀不干净，见 worktree 验证 runbook 坑 4）
powershell -NoProfile -Command 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "<worktree-名>" -and ($_.Name -eq "node.exe" -or $_.Name -eq "esbuild.exe") } | ForEach-Object { taskkill /PID $_.ProcessId /T /F }'
# 3) 验证：进程数 0、6768/8083 释放、worktree git 干净（.dev/ 被 ignore）
# 4) 红线：主仓 8081 Expo 与生产 daemon 6767（~/.paseo）全程不可触碰
```

## 坑清单（新坑补在这里）

1. **继承的 `PASEO_DEV_ROOT=D:\UGit\Paseo\paseo` 比想象中隐蔽**——`env -u PASEO_HOME` 不够，`configure_dev_paseo_home` 在 unset 分支仍会用 `PASEO_DEV_ROOT` 定位到主仓 dev home（症状：daemon.log 的路径是主仓 + 种子 0 records）。解法：**显式设 `PASEO_HOME=<worktree>/.dev/paseo-home`**，走"已设置"分支。
2. **种子 agent 记录 schema**：`features`/`runtimeInfo` 只 optional 不 nullable，写 `null` 直接被跳载（`Skipping invalid agent record`）；`persistence`/`config`/`lastModeId`/`lastError` 可为 null。对照 `agent-storage.ts` 的 `STORED_AGENT_SCHEMA`。
3. **mock provider 要求 agentId 为 UUID 形状**（报 `createAgent: agentId must be a UUID`），种子 ID 用 `11111111-1111-4111-8111-xxxxxxxxxxxx` 形式。
4. **root `package.json` 的 `dev:app` 用 cross-env 硬编码 `EXPO_PORT=8081`**，环境变量 `EXPO_PORT=8083` 会被覆盖——换端口必须直接 `bash scripts/dev-app.sh`。
5. **8081 常年被主仓的 Expo dev server 占用**（用户自己的进程，绝不能杀），worktree 实例固定用 8083+。
6. **`browser_wait` 的 `timeoutMs` 上限 30000**——长等待分多次调用。
7. **种子 workspace 的 `cwd` 必须真实存在于磁盘**——daemon 启动时 workspace reconciliation 会把 `directory_missing` 的 workspace 自动归档（daemon.log 里 `workspace_archived`），侧边栏直接看不到、agent 也挂不上。种子脚本在 worktree `.dev/` 下 mkdir 该目录并 `git init -b main`（保住 `kind:"git"` 与 branch 显示）。
8. **内置浏览器同源残留上个会话的 localStorage**——旧 server id + workspace 路由 + 缓存的侧边栏数据（症状：侧边栏显示旧种子、直接 navigate 到新 server URL 报 ERR_ABORTED 被路由重定向到 /open-project）。解法：`browser_evaluate` 跑 `localStorage.clear()`，再 navigate 到根路径，应用会自动连 `EXPO_PUBLIC_LOCAL_DAEMON` 并显示新种子。
9. **改非默认显示设置要先写 localStorage 再加载页面**——如验证 drawer 折叠要 `localStorage.setItem("@paseo:app-settings", JSON.stringify({toolCallDetailLevel:"drawer"}))`（默认 detailed 不折叠），然后 navigate。键名见 `use-settings/keys.ts` 的 `APP_SETTINGS_KEY`。
10. **`npm run cli --` 在 git-bash 下跑不起来**（`'.' 不是内部或外部命令`，dev-home shim 是 cmd 语法）。要看 daemon 时间线时改用：`cd packages/cli && PASEO_HOME=<dev home> PASEO_LISTEN=127.0.0.1:6768 npx tsx src/index.js logs <agentId>`；注意 `logs` 只有人类可读输出，`-o json` 不生效。
11. **app 收到的时间线可能被 live 重放 + fetch 双份投递**——验证 reducer 语义时别以浏览器最终渲染为准：同一事件序列会先走订阅重放（overlay）再走 fetch baseline 归并，重复应用可吞掉个别行（例：紧跟 created 行的 started 单行）。reducer 层用 `hydrateStreamState` 单测直接断言，浏览器只验视觉。
