# Agent Coordination Layer — 实现方案

状态：实现中（分支 `feature/coordination-layer`）
日期：2026-08-23

## 1. 背景与目标

对 Orca 编排子系统的调研（`orchestration.db` 状态机：Run/Message/Delivery/Task/DispatchContext/DecisionGate/Question）得出三项对 Paseo 最高性价比的借鉴。同时 Paseo 自身的两个历史事实约束了设计：

- **v0.4.0 移除 loops、v0.3.0 移除 chat rooms**（PR #3053）的直接原因是存储迁移瘦身：chat 把所有房间+消息塞进单个 `rooms.json`、loops 把全部记录塞进单个非原子写的 `loops.json`，是 JSON 存储模型里最坏的反模式，被"退役而非迁移"。
- **两个产品（Orca 与 Paseo）都独立退役了代码内调度器**，收敛到"agent 即协调者"。Orca 保留的真正资产是**持久化协调状态层**（agent 协调者可读写的外部记忆）；Paseo 在移除 loops 时把这层也一并删除了。

本方案在 Paseo 现有产品原语（父子 agent、`<paseo-system>` steer 通知、per-agent 工具目录）之上，补回最小而正确的协调状态层：

| 借鉴项                      | Orca 对应物                                       | Paseo 形态                                                                                                    |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 持久任务记录 + 依赖就绪计算 | `tasks` 表 + `promoteReadyTasks()`                | `TaskStore`/`TaskService` + `create_task` 等工具                                                              |
| worker→协调者可恢复问答     | `questions` 表 + 阻塞 `ask --wait` + `--resume`   | `TaskQuestion` 持久记录 + `ask_parent`/`answer_question` 工具 + steer 通知（非阻塞，契合 Paseo 通知优先哲学） |
| 工作流级决策门              | `decision_gates` 表（pending 门每 tick 阻塞任务） | task 内嵌 `gate`，未解决则任务不 ready、不可完成；父 agent 或人类（CLI）裁决                                  |

## 2. 设计原则

1. **状态层，不是调度器。** 不引入任何代码内 tick 循环、不自动派发 agent。就绪（ready）在**读取时惰性推导**，不做 eager promotion 写放大——存储里只有每个任务自己的显式状态，派生态（ready/blocked）永远可从依赖闭包重算，天然免于事务性提升的崩溃一致性问题。
2. **通知优先，绝不轮询。** 所有跨 agent 事件走既有 `sendPromptToAgent` + `<paseo-system>` 信封 + `activeTurnBehavior: "steer"` 管道（与 notify-on-finish、schedule fire 同一通道）。工具返回值包含"你会被通知，不要轮询"指引（沿用 `create_agent` 的 guidance 惯例）。
3. **每记录一个 JSON 文件 + 原子写 + 按 id 串行化变更。** 完全复用 `ScheduleStore` 模式（`writeJsonFileAtomic` + per-key mutation 链），从存储布局上就不重蹈 chat/loops 的覆辙。Store 层做成 query-shaped（`listByOwner` 等），为将来的 SQLite 迁移留直映射缝（呼应 PR #3053 的 `AgentStorage` 方向）。
4. **权限 = 标签图上的角色。** task 的 `ownerAgentId`（创建者/协调者）与 `assigneeAgentId`（执行者）；question 的 `askerAgentId` 与 `parentAgentId`。所有越权写入直接抛错。人类通过 CLI（与其它 daemon RPC 同级的信任级）裁决。

## 3. 数据模型

### 3.1 StoredTask（`$PASEO_HOME/tasks/{taskId}.json`，id 为 8 hex）

```ts
{
  id: string;
  ownerAgentId: string;        // 协调者（创建者）；任务集按 owner 隔离
  title: string;               // 单行摘要
  spec: string | null;         // 完整任务说明（可含验收标准）
  deps: string[];              // 依赖的 taskId，必须同 owner、无环
  assigneeAgentId: string | null;
  status: "pending" | "in_progress" | "completed" | "failed";
  result: string | null;       // complete 时写入的结果/报告
  failureReason: string | null;
  gate: {
    question: string;
    options: string[] | null;  // 可选枚举选项
    status: "pending" | "resolved";
    resolution: string | null;
    resolvedAt: string | null;
    resolvedBy: string | null; // agentId 或 "human"
  } | null;
  createdAt: string; updatedAt: string;
  startedAt: string | null; completedAt: string | null;
}
```

显式状态机：`pending → in_progress → completed | failed`（owner/assignee 可跳过 in_progress 直接完成）。

**派生态（读取时计算，不落盘）：**

- `ready(task)` = `status === "pending" && deps 全部 completed && gate 已 resolved`
- `blocked(task)` = 依赖闭包内存在 `failed` 或 `blocked`（递归、带 memo）
- 视图模型 `TaskView = StoredTask + { ready, blocked, blockingDeps: string[] }`

**创建期校验：** 每个 dep 必须存在、同 owner、且新边不构成环（沿 deps 深搜）。

### 3.2 StoredTaskQuestion（`$PASEO_HOME/task-questions/{questionId}.json`）

```ts
{
  id: string;
  askerAgentId: string; // 提问的子 agent
  parentAgentId: string; // 被问的父 agent
  taskId: string | null; // 可选关联任务（owner 须为 asker 或其 owner? → 校验为 asker 的 owner 的任务，或 null）
  question: string;
  status: "pending" | "answered" | "closed";
  answer: string | null;
  createdAt: string;
  answeredAt: string | null;
}
```

`answered`/`closed` 均为终态；answer 一经写入不可变（追加式修正由父 agent 在通知里自行补充，v1 不做编辑）。

## 4. 服务层（`packages/server/src/server/tasks/`）

`TaskService`（构造注入 `paseoHome, logger, agentManager, agentStorage`），方法即业务规则：

| 方法                                                        | 规则                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTask(input)`                                         | agent-scoped：owner=caller。校验 title 非空、deps 存在/同 owner/无环、assignee 存在（若给）。gate.options 非空数组且 ≤8 项。                                                                                              |
| `listTasks({ ownerAgentId })`                               | 返回 owner 全部任务的 TaskView（含派生态），按 createdAt 排序。人类调用（session RPC）可不传 owner 看全部。                                                                                                               |
| `inspectTask(id)`                                           | 单任务 TaskView。                                                                                                                                                                                                         |
| `startTask(id, caller)`                                     | caller ∈ {owner, assignee}；要求派生态 ready（未 ready 报错并说明原因：deps 未完成 / gate 未决 / blocked）。pending→in_progress。                                                                                         |
| `completeTask(id, caller, result)`                          | caller ∈ {owner, assignee}；gate pending → 报错；pending/ready/in_progress → completed。                                                                                                                                  |
| `failTask(id, caller, reason)`                              | caller ∈ {owner, assignee}；→ failed（依赖闭包此后推导为 blocked）。                                                                                                                                                      |
| `resolveGate(id, resolution, resolvedBy)`                   | owner 或人类；resolution 若 gate.options 存在则必须是其中之一；pending→resolved。                                                                                                                                         |
| `askParent(callerAgentId, question, taskId?)`               | 从 caller 的存储记录解析 `paseo.parent-agent-id`；无父标签 → 明确报错并指引（向用户提问走 permission 流）。持久化 question 后 **steer 通知父 agent**（含 questionId、提问者、问题正文、taskId、`answer_question` 用法）。 |
| `answerQuestion(questionId, callerAgentId, answer)`         | caller 须为 question.parentAgentId（或人类 RPC）；写 answer；**steer 通知提问子 agent**（含 questionId 与 answer 正文）。                                                                                                 |
| `closeQuestion(questionId, callerAgentId)`                  | parent 或人类；→ closed；steer 通知子 agent "问题已关闭"。                                                                                                                                                                |
| `listQuestions({ parentAgentId?, askerAgentId?, status? })` | 父 agent 恢复视图 / 人类视图。                                                                                                                                                                                            |

通知实现细节：与 `setupFinishNotification` 相同的三条纪律——`unarchive: false`（父/子已归档则静默跳过）、`activeTurnBehavior: "steer"`（并入运行中 turn）、队列化 catch-all 日志。提问在父 agent 归档时**不丢弃**：记录仍持久存在，父 agent 恢复后用 `list_questions` 找回（可恢复性，对应 Orca `ask --resume` 的语义，但用通知而非阻塞实现）。

## 5. Agent 工具面（`paseo-tools.ts` 注册，全部要求 agent-scoped）

| 工具                | 输入要点                                                                               | 返回要点                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `create_task`       | title, spec?, deps?, assignee_agent_id?, gate?{question, options?}                     | TaskView + guidance（如何派发：把 task id + spec 写进子 agent 提示词；用 `list_tasks` 查就绪）          |
| `list_tasks`        | status?: "ready" \| "pending" \| "in_progress" \| "completed" \| "failed" \| "blocked" | caller 名下 TaskView 列表（`status: "ready"` 过滤 = 派生 ready 的 pending 任务）                        |
| `inspect_task`      | task_id                                                                                | TaskView（含 blockingDeps、gate 状态）                                                                  |
| `start_task`        | task_id                                                                                | 更新后 TaskView；未就绪时报错并说明缺什么                                                               |
| `complete_task`     | task_id, result?                                                                       | 更新后 TaskView + guidance（依赖此任务的后续任务已就绪）                                                |
| `fail_task`         | task_id, reason?                                                                       | 更新后 TaskView + guidance（下游任务已被阻塞，评估重派或关闭）                                          |
| `resolve_task_gate` | task_id, resolution                                                                    | 仅 owner；resolution 须匹配 options（若有）                                                             |
| `ask_parent`        | question, task_id?                                                                     | questionId + 强指引："父 agent 会被通知并通过 `answer_question` 回复；答案将以系统通知送达。不要轮询。" |
| `answer_question`   | question_id, answer                                                                    | 仅被问父 agent 可用                                                                                     |
| `list_questions`    | status?: "pending"                                                                     | 作为父 agent 待我回答的 / 我提出的（两个数组）                                                          |

错误一律 `throw`（工具目录统一转为 isError 结果），消息里给出下一步动作。

## 6. Wire 协议（人类通道，`packages/protocol/src/tasks/rpc-schemas.ts`）

4 对请求/响应（`type` 字面量沿用 `domain/verb` 风格）：

- `task/list` → `task/list/response { tasks: TaskView[] }`（无 owner 过滤参数则全量，人类视图）
- `task/inspect` → `task/inspect/response { task: TaskView | null }`
- `task/resolve-gate` → `task/resolve-gate/response { task, error }`（resolvedBy = "human"）
- `task/answer-question` → `task/answer-question/response { question, error }`（人类直接回答，同样 steer 通知子 agent）

加入 `SessionInboundMessageSchema` / `SessionOutboundMessageSchema` discriminated unions（`messages.ts`），AOT 校验器由 `pretest`/`prebuild` 钩子自动再生成。

## 7. CLI（`packages/cli/src/commands/task/`）

- `paseo task ls [--owner <agentId>]` — 表格：id、title、status（含派生 ready/blocked）、deps、assignee、gate
- `paseo task inspect <id>`
- `paseo task gate <id> <resolution>` — 人类裁决决策门
- `paseo task answer <questionId> <answer>` — 人类回答子 agent 提问
- `paseo task questions [--pending]` — 查看待决问题

client 侧在 `daemon-client.ts` 增加对应 5 个方法（`sendCorrelatedSessionRequest` 模式）。

## 8. 存储与目录布局

```
$PASEO_HOME/
├── tasks/{taskId}.json            # 每任务一文件，原子写
└── task-questions/{questionId}.json
```

`TaskStore`/`TaskQuestionStore` 各自实现 `list/listByOwner/get/create/update(with per-id 串行化)/delete`，模式照抄 `ScheduleStore`（含 `serializeMutation` per-key promise 链）。

## 9. 测试计划

1. **protocol**：`tasks/types.test.ts`（schema 解析/拒绝）、`tasks/rpc-schemas.test.ts`（请求/响应字面量）。
2. **server/store**：原子写、per-id 串行化、损坏文件行为（parse 失败跳过并记日志——与 ScheduleStore 一致）。
3. **server/service**（重点）：
   - 就绪推导：deps 全 completed → ready；任一 dep failed → 传递 blocked
   - 环检测：A→B→A 拒绝
   - gate：pending 门使任务不 ready 且不可 complete；resolve 后可推进；options 枚举校验
   - 权限：非 owner/assignee 的 start/complete/fail 拒绝；answer_question 仅 parent
   - ask_parent：无父标签报错；有父标签创建记录并调用通知（stub sendPromptToAgent 断言 steer/unarchive:false/信封格式）
   - answer/close：状态迁移 + 对子 agent 的 steer 通知
4. **session**：`task-session.test.ts` 用伪 service 断言 RPC 分发与 rpc_error 路径。
5. **回归**：`packages/protocol`、`packages/server`、`packages/cli` 既有套件全绿。

## 10. 非目标（明确不做）

- 不做自动派发/调度循环（Orca 已退役同类物，教训一致）
- 不做跨 owner 共享任务集、不做任务模板
- 不做阻塞式 ask（Paseo 有原生通知通道，阻塞是 Orca 被 PTY 模型逼出来的形态）
- 不做消息信箱/DAG 可视化 UI（后续项）
- 不引入 SQLite（但 Store 是 query-shaped 的，迁移时直映射）
