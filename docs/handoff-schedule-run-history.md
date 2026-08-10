# Handoff：Schedules 桌面版"查看运行历史"功能

> 交接文档。规划已完成、未实施。接手 agent 请通读本文件后直接从「实施步骤」开始。
> 规划日期：2026-08-10。规划分支：main（工作区干净，仅 `packages/desktop/scripts/dev.ps1` 有无关改动）。

## 一、需求与背景

**问题**：桌面版 Schedules 页面（`packages/app/src/screens/schedules-screen.tsx`）能管理计划（Edit/Pause/Resume/Run now/Delete），但**无法查看每次运行的历史和输出**。

**现状**：数据链路完整，唯独 app UI 没有入口——

- 服务端把 runs 存在 `$PASEO_HOME/schedules/{id}.json`（`StoredSchedule.runs`）
- 协议层有现成 RPC：`schedule/inspect`、`schedule/logs`
- client 有现成方法：`client.scheduleInspect({id})` / `client.scheduleLogs({id})`
- CLI 已能看：`paseo schedule inspect <id>` / `paseo schedule logs <id>`
- **app 从未调用过这两个 RPC**（grep `packages/app` 零命中）

**目标**：Schedules 列表每行 kebab 菜单加 "View run history"，开 sheet 看运行历史列表，点单条 run 看完整输出。

**范围**：只改 `packages/app`（+ e2e helper + docs/glossary.md）。**不改** protocol / server / client / CLI。

## 二、用户已锁定的决策

| 决策点                    | 结论                                                                       |
| ------------------------- | -------------------------------------------------------------------------- |
| 入口位置                  | kebab 菜单加一项；行点击仍打开编辑表单（不变）                             |
| 详情展示                  | sheet 内两级钻取：运行列表 → 点 run 看完整 output，SheetHeader `back` 返回 |
| 数据获取                  | 按需调 `client.scheduleLogs({ id })`；**不改协议**（不让 list 带 runs）    |
| 心跳（target.type=agent） | 不显示入口（沿用现有 gating；心跳输出本就在会话里）                        |
| i18n                      | 不加 key，与 schedule 功能现状一致（全硬编码英文，仅导航标签本地化）       |

## 三、已验证的关键事实（不要重复探索，直接信）

### 协议层（只读参考，不改）

- `packages/protocol/src/schedule/rpc-schemas.ts`：9 个 schedule RPC。两个返回 runs：
  - `schedule/inspect` → `{ schedule: StoredSchedule | null, error }`
  - `schedule/logs` → `{ runs: ScheduleRun[], error }`（响应 type：`schedule/logs/response`）
- `packages/protocol/src/schedule/types.ts`：
  - `ScheduleRunSchema`（45-56 行）：`{ id, scheduledFor, startedAt, endedAt: string|null, status: "running"|"succeeded"|"failed", agentId: guid|null, workspaceId?: string|null, output: string|null, error: string|null }`
  - `ScheduleSummarySchema = StoredScheduleSchema.omit({ runs: true })`（76-79 行）——list 载荷**故意**不带 runs，保持这样
- 注意不对称：create/pause/resume 响应是 Summary（无 runs）；run-once/update 响应是完整 StoredSchedule（有 runs）

### 服务端（只读参考，不改）

- 分发：`packages/server/src/server/session.ts:2284-2301`（`dispatchChatScheduleLoopMessage`）
- handler：`packages/server/src/server/session/chat/chat-schedule-loop-session.ts:344-378`
- service：`packages/server/src/server/schedule/service.ts`（`inspect` :372、`logs` :380 按 startedAt 升序）
- store：`packages/server/src/server/schedule/store.ts`，原子写 `writeJsonFileAtomic`
- **runs 无上限增长**（service.ts 无截断）→ UI 必须截断长 output
- 无 capability/feature flag 门控 schedule/logs → 客户端无需门控

### client（只读参考，不改）

- `packages/client/src/daemon-client.ts`：`scheduleInspect` :5185、`scheduleLogs` :5196
- 选项类型 `InspectScheduleOptions { id, requestId? }`（:802）——字段是 `id`，方法内部映射到 wire 字段 `scheduleId`

### app 现状（要改的部分）

- `packages/app/src/hooks/use-schedules.ts` + `packages/app/src/schedules/aggregated-schedules.ts`：
  - 聚合查询跨 host 调 `scheduleList`，query key `[...schedulesQueryBaseKey, sortedServerIds, connectionStatusKey]`，`schedulesQueryBaseKey = ["schedules"]`
  - `staleTimeMs: 5_000`，`dataShape: "list"`
- `packages/app/src/hooks/use-schedule-mutations.ts`：
  - `useScheduleMutations({ serverId })`；mutation settle 时 `invalidateQueries({ queryKey: ["schedules"] })`（前缀匹配）
  - client 取自 `useSessionStore.getState().sessions[serverId]?.client`（`requireClient` :53）
- `packages/app/src/components/schedules/schedule-row.tsx`：
  - `ScheduleRowActions`（:53）：onEdit/onPause/onResume/onRunNow/onDelete
  - `ScheduleKebabMenu`（:300-358）：Edit → ScheduleExecutionMenuItems（Pause/Resume + Run now）→ 分隔线 → Delete
  - `ScheduleExecutionMenuItems`（:231-243）：`target.type === "agent"` 时返回 null（心跳只有 Edit+Delete）
  - 图标惯例：`withUnistyles` 包 lucide，`MENU_ICON_SIZE = 14`，testID `schedule-menu-<action>-<id>`
  - `buildMeta()`（:98）已有 "Last run X ago" / "Never run"
- `packages/app/src/components/schedules/schedules-table.tsx`：行包装器持 per-row pending state，`onEditSchedule` 向上委托
- `packages/app/src/screens/schedules-screen.tsx`：持 `FormState`（closed|create|edit），挂载单个 `ScheduleFormSheet`；过滤器 HostFilter + SegmentedControl(Active/Ended)

### 可复用的 UI 基建

- **`AdaptiveModalSheet`**（`packages/app/src/components/adaptive-modal-sheet.tsx`）：唯一 modal 原语（design.md §14 禁裸 Modal）。SheetHeader 支持 `{ title, subtitle, back: { onPress, label }, leading, actions, search }`。**back 槽目前无消费者，本功能是第一个**
- 只读详情 sheet 范本：`packages/app/src/components/provider-diagnostic-sheet.tsx`、`app-diagnostic-sheet.tsx`（AdaptiveModalSheet + ScrollableCodeSurface + copy）
- **`MarkdownRenderer`**（`packages/app/src/components/markdown/renderer.tsx:78`）：用 `compact` 变体（PR panel `pane.tsx:972` 有先例）
- `StatusBadge`（`components/ui/status-badge.tsx`）：success/error/muted
- 样式惯例：`settingsStyles.card/row/rowBorder/rowTitle/rowHint`（`@/styles/settings`）；`formatTimeAgo`（`@/utils/time`）；`resolveScheduleTitle`/`scheduleProductName`（`@/utils/schedule-format`）
- 跳 agent 详情：`buildHostAgentDetailRoute(serverId, agentId, workspaceId?)`（`packages/app/src/utils/host-routes.ts:375`）
- 数据获取范式：**`packages/app/src/git/use-commits-query.ts`** —— useHostRuntimeClient + useHostRuntimeIsConnected + useFetchQuery + 纯 resolver（unsupported/idle/connecting/loading/error/loaded），照抄这个模式
- `useFetchQuery`（`packages/app/src/data/query.ts:95`）：**staleTimeMs 必须有限**（否则抛错）；`refetchOnMount: "always"`；`dataShape: "list"` 给 keepPreviousData
- 无通用 Tabs 组件；sheet 内钻取用 SheetHeader back，不要用 tab

### 设计规范要点（docs/design.md）

- §11 状态：loading 居中 `LoadingSpinner size="large"`；empty 是短 muted 名词短语（"No runs yet"）；error 一句 red-300 xs；**加载切换不许跳版**
- §12 列表行：chevron = 钻取，kebab = 操作；可共存，chevron 最后
- §13：StatusBadge 是唯一 pill 原语

### 术语（docs/glossary.md）

- "Run" 作 Agent 同义词是**禁用**的（glossary :10）；但 schedule 执行语境 "run" 是既有词汇（ScheduleRun/Run now/Last run/maxRuns）
- `scheduleProductName()`：target.type=agent 时返回 "Heartbeat"，否则 "Schedule"

### COMPAT 标签（无需动，仅知悉）

`COMPAT(scheduleEveryMs)`（server cron.ts:90）、`COMPAT(scheduleSelfTarget)`（cli shared.ts:123）、`COMPAT(scheduleEveryInput)`（server paseo-tools.ts:423）——均 v0.2.0 引入，2027-01-17 后清理。

## 四、实施步骤

### 1. 数据 hook（新文件，TDD 先写测试）

**`packages/app/src/hooks/use-schedule-runs.ts`**

```ts
export interface UseScheduleRunsOptions {
  serverId: string;
  scheduleId: string;
  enabled?: boolean; // 传 sheet 的 visible
}

export type ScheduleRunsQueryResult =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "loaded"; runs: ScheduleRun[] };
```

- query key：`[...schedulesQueryBaseKey, "runs", serverId, scheduleId]` —— **嵌套在 `["schedules"]` 下是关键**，现有 mutation 的 `invalidate(["schedules"])` 前缀匹配会自动刷新开着的 sheet
- queryFn：`const payload = await client.scheduleLogs({ id: scheduleId }); if (payload.error) throw new Error(payload.error); return payload.runs;`（error 是载荷字段不是异常，必须手动 throw）
- runs 服务端按 startedAt 升序 → queryFn 里反转为最新在前
- `staleTimeMs = 10_000`，`dataShape: "list"`
- 导出纯函数 `resolveScheduleRunsQueryResult({ enabled, canFetch, data, isPlaceholderData, error })` 供单测（镜像 use-commits-query 的 resolver；本功能无 unsupported 态）
- 刷新语义：refetchOnMount always → 每次开 sheet 必拉新；mutation settle → 自动失效；"Run now" 后新 run（running 态）自动出现

**`packages/app/src/hooks/use-schedule-runs.test.ts`** — 仿 `use-commits-query.test.ts` 测 resolver 各分支。

### 2. sheet 组件（新文件）

**`packages/app/src/components/schedules/schedule-runs-sheet.tsx`**

```ts
interface ScheduleRunsSheetProps {
  serverId: string;
  schedule: ScheduleSummary;
  visible: boolean;
  onClose: () => void;
}
```

- 状态机：`type SheetView = { kind: "list" } | { kind: "detail"; runId: string }`；`visible` 变 false 时 useEffect 重置为 list
- 选中 run 用 `runs.find(r => r.id === view.runId)` **派生**，不存 run 对象——running 态 run 刷新时 output/endedAt 实时更新
- Header：
  - list：`{ title: "Run history", subtitle: resolveScheduleTitle(schedule) }`
  - detail：`{ title: "Run output", back: { onPress: () => setView({kind:"list"}), label: "Run history" } }`
  - onClose（X/背景/下滑）任何层级都直接关整个 sheet
- **列表级**：`settingsStyles.card`；每行 Pressable（`settingsStyles.row` + 非首行 `rowBorder`）：
  - 标题：`formatTimeAgo(new Date(run.startedAt))`
  - meta：时长（`endedAt - startedAt`）或 "Running…" + output/error 单行预览（`numberOfLines={1}`）
  - trailing：StatusBadge + ChevronRight + （有 agentId 时）跳 agent 图标按钮（`hitSlop={8}`，阻止冒泡，testID `schedule-run-open-agent-<id>`；导航写法 grep `buildHostAgentDetailRoute(` 现有调用方对齐）
  - 行 testID `schedule-run-<run.id>`
  - badge 映射：succeeded→success / failed→error / running→muted
- **详情级**：
  - error 非空 → 顶部红字一行（`palette.red[300]` xs）；error 和 output 可能同时存在，都渲染，error 在前
  - output → `MarkdownRenderer compact`
  - **截断**：`MAX_OUTPUT_CHARS = 50_000`，超出切掉 + 末尾加 muted 提示 "…(output truncated)"（MarkdownRenderer 对超大字符串有渲染性能风险）
  - 滚动用 sheet 自身 scrollable（默认），不要在 markdown 外再套 ScrollableCodeSurface（避免嵌套滚动区）
- 状态（design.md §11，各状态同尺寸容器防跳版）：
  - loading/connecting → 居中 `LoadingSpinner size="large"`
  - loaded 空数组 → "No runs yet" 一行居中，无 CTA
  - error → 一句红字 + ghost "Try again" Button（调 query refetch，hook 结果里把 refetch 透出来）
  - host 断连（canFetch false）→ connecting 态 + keepPreviousData 保留旧列表 + "Reconnecting…" muted 提示

**`packages/app/src/components/schedules/schedule-runs-sheet-state.ts`** + `.test.ts`

- 纯 resolver：`resolveRunSheetBodyState(result, view)` → `loading | error | empty | list | detail | detail-missing`
- `detail-missing`：正在看某 run 详情时它从列表消失 → 回退 list（镜像 `schedules-screen-state.ts` 的模式）

### 3. 接线（改 3 个现有文件）

**`schedule-row.tsx`**

- `ScheduleRowActions` 加 `onViewRuns: () => void`
- 模块级 `const ThemedHistory = withUnistyles(History)`（lucide `History` 图标）+ `historyLeading` 用 mutedColorMapping
- `ScheduleKebabMenu`：在 ScheduleExecutionMenuItems 与 DropdownMenuSeparator 之间插 "View run history"；gate 与执行菜单一致（`target.type === "agent"` 不渲染）；testID `schedule-menu-runs-<id>`
- onViewRuns 透传 ScheduleRow → ScheduleKebabMenu

**`schedules-table.tsx`**

- `SchedulesTableProps` 加 `onViewRuns: (schedule: AggregatedSchedule) => void`
- `SchedulesTableRow` 加 `handleViewRuns = useCallback(() => onViewRuns(schedule), ...)` 传给 ScheduleRow

**`schedules-screen.tsx`**

- **新独立 state，不混入 FormState**：
  ```ts
  const [runsSheet, setRunsSheet] = useState<
    { mode: "closed" } | { mode: "open"; serverId: string; schedule: ScheduleSummary }
  >({ mode: "closed" });
  ```
- `openRuns` / `closeRuns` 回调；`onViewRuns={openRuns}` 经 SchedulesScreenBody → SchedulesTable 透传
- 与 ScheduleFormSheet 并列挂载 `<ScheduleRunsSheet ... visible={runsSheet.mode === "open"} onClose={closeRuns} />`

### 4. e2e

**`packages/app/e2e/support/helpers/schedule-fake-host.ts`**（改）

- 消息 switch 加 `case "schedule/logs"`；install 输入加可选 `runs`（按 scheduleId 索引的 Record）；回 `schedule/logs/response` `{ requestId, runs, error: null }`
- 现状：只应答 `schedule/list`（:246）

**`packages/app/e2e/browser/schedules-run-history.spec.ts`**（新）

- 仿 `schedules-edit-model-hydration.spec.ts`：fake host 装计划+种子 runs → `buildSchedulesRoute()` → 开 kebab（`schedule-kebab-<id>`）→ 点 `schedule-menu-runs-<id>` → 断言 sheet 可见、run 行渲染 → 点 run → 断言 output 文本 → 点 back 回列表
- 沿用现有 spec 的 `expectSettled` / `expectStableHeight` 辅助

### 5. 文档

**`docs/glossary.md`**：在 Schedule 条目（:34）后加一条：

> **Schedule run** — One execution of a **Schedule**: the daemon fires the cadence, spawns the configured agent, and records `{ scheduledFor, startedAt, endedAt, status, output, error }`. Code: `ScheduleRun` (`packages/protocol/src/schedule/types.ts`). Not an **Agent session** (a run may spawn one); never shorten to bare "Run" in UI near agent lists.

### 6. 已知限制（实现时写进代码注释）

run 从 running → succeeded 的完成瞬间无服务端推送；sheet 依赖"下次打开/refetchOnMount + mutation settle 失效"刷新。后续如需"盯着 run 跑完"可加轮询，本期不做。

## 五、边界情况清单

| 情况                           | 处理                                                     |
| ------------------------------ | -------------------------------------------------------- |
| running 态 run（endedAt null） | meta 显示 "Running…"，badge muted，无时长                |
| error + output 并存            | 都渲染，error 在前（红字）                               |
| 超长 output                    | 50k 字符截断 + 截断提示                                  |
| runs 列表超长                  | sheet 自身 scrollable，不虚拟化（真实量级不需要）        |
| 看详情时该 run 消失            | resolver `detail-missing` → 回列表                       |
| host 断连时 sheet 开着         | connecting 态 + 保留旧数据 + Reconnecting 提示           |
| sheet 开着时计划被删           | sheet 持打开时快照可继续展示；refetch 若 404 走 error 态 |

## 六、验证（按顺序；严格守规矩）

1. **只跑目标单测文件**：`npx vitest run packages/app/src/hooks/use-schedule-runs.test.ts --bail=1`（sheet-state 测试同理）。**绝不 `npm run test` 全量**
2. **typecheck + lint**：`npm run typecheck`、`npm run lint -- <改动文件路径>`
3. **format**：`npm run format`（提交前）
4. **e2e 单 spec**：跑 `schedules-run-history.spec.ts`（确切脚本名看 `packages/app/package.json`）
5. **手动 e2e**：dev daemon + app，对真实计划（如"每日Token消耗汇总" id `8b1ad209`）点 Run now → kebab → View run history → 验证列表/钻取/back/跳 agent 详情
6. **绝不重启 6767 端口的主 daemon**

## 七、实现时再确认的小事（别预设，先查）

- 跳 agent 详情的导航原语：grep `buildHostAgentDetailRoute(` 看 sheet 场景怎么调（router？navigation ref？）
- `packages/app/src/utils/time.ts` 有没有现成时长格式化；没有才写 `formatDurationMs`
- `packages/app/package.json` 里 typecheck/e2e 脚本确切名字
- Unistyles 规矩：禁 `useUnistyles()` render 内调用；图标一律 `withUnistyles` 模块级包装（见 docs/unistyles.md）
- hover 若有：按 docs/hover.md（外层 View onPointerEnter/Leave + 内层 Pressable；禁 onPointerEnter 直挂 Pressable）

## 八、文件清单汇总

| 文件                                                                      | 改动                    |
| ------------------------------------------------------------------------- | ----------------------- |
| `packages/app/src/hooks/use-schedule-runs.ts`                             | 新增                    |
| `packages/app/src/hooks/use-schedule-runs.test.ts`                        | 新增                    |
| `packages/app/src/components/schedules/schedule-runs-sheet.tsx`           | 新增                    |
| `packages/app/src/components/schedules/schedule-runs-sheet-state.ts`      | 新增                    |
| `packages/app/src/components/schedules/schedule-runs-sheet-state.test.ts` | 新增                    |
| `packages/app/src/components/schedules/schedule-row.tsx`                  | kebab 加项 + onViewRuns |
| `packages/app/src/components/schedules/schedules-table.tsx`               | 透传 onViewRuns         |
| `packages/app/src/screens/schedules-screen.tsx`                           | runsSheet state + 挂载  |
| `packages/app/e2e/support/helpers/schedule-fake-host.ts`                  | 加 schedule/logs 分支   |
| `packages/app/e2e/browser/schedules-run-history.spec.ts`                  | 新增                    |
| `docs/glossary.md`                                                        | 加 "Schedule run" 条目  |

**不改**：`packages/protocol`、`packages/server`、`packages/client`、`packages/cli`。
