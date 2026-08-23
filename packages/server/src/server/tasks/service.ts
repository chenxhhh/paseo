import { join } from "node:path";
import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { formatSystemNotificationPrompt, sendPromptToAgent } from "../agent/agent-prompt.js";
import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";
import type {
  StoredTask,
  StoredTaskQuestion,
  TaskQuestionStatus,
  TaskView,
} from "@getpaseo/protocol/tasks/types";
import { TaskQuestionStore, TaskStore } from "./store.js";

/**
 * Ownership check for task mutations: the owning coordinator or the assigned
 * worker may act; a missing callerAgentId is a trusted human surface (session
 * RPC) with the same authority as every other daemon RPC.
 */
function mayMutateTask(task: StoredTask, callerAgentId: string | undefined): boolean {
  if (!callerAgentId) {
    return true;
  }
  return task.ownerAgentId === callerAgentId || task.assigneeAgentId === callerAgentId;
}

function requireTask(task: StoredTask | null, id: string): asserts task is StoredTask {
  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }
}

async function validateDeps(store: TaskStore, ownerAgentId: string, deps: string[]): Promise<void> {
  if (deps.includes("")) {
    throw new Error("Task dependencies must be non-empty task ids");
  }
  // Deps can only reference tasks that already exist, and existing tasks
  // cannot reference the id this task is about to receive, so no cycle can
  // form here. What must be enforced: same-owner task sets and existence.
  for (const depId of deps) {
    const dep = await store.get(depId);
    if (!dep) {
      throw new Error(`Task dependency not found: ${depId}`);
    }
    if (dep.ownerAgentId !== ownerAgentId) {
      throw new Error(
        `Task dependency ${depId} belongs to another owner (${dep.ownerAgentId}); task sets are per-owner`,
      );
    }
  }
}

type NewTaskGate = NonNullable<StoredTask["gate"]>;

function buildGate(
  gate: { question: string; options?: string[] | null } | null | undefined,
): NewTaskGate | null {
  if (!gate) {
    return null;
  }
  const gateQuestion = gate.question.trim();
  if (!gateQuestion) {
    throw new Error("Gate question is required when a gate is requested");
  }
  const options = gate.options ?? null;
  if (options !== null) {
    const trimmed = [...new Set(options.map((option) => option.trim()))];
    if (trimmed.length === 0 || trimmed.some((option) => !option)) {
      throw new Error("Gate options must be non-empty strings");
    }
    if (trimmed.length > 8) {
      throw new Error("Gate options must contain at most 8 entries");
    }
    return {
      question: gateQuestion,
      options: trimmed,
      status: "pending",
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
    };
  }
  return {
    question: gateQuestion,
    options: null,
    status: "pending",
    resolution: null,
    resolvedAt: null,
    resolvedBy: null,
  };
}

/**
 * Derive `ready`/`blocked` for a set of tasks at read time. Nothing here is
 * persisted: the stored status of each task plus its dependency closure is
 * always sufficient to recompute both flags, which keeps the store free of
 * promotion writes that could desynchronize on a crash.
 *
 * ready   = pending, gate resolved, and every dependency completed.
 * blocked = any dependency in the transitive closure failed or blocked.
 */
export function deriveTaskViews(tasks: StoredTask[]): TaskView[] {
  const byId = new Map(tasks.map((task) => [task.id, task] as const));
  const blockedMemo = new Map<string, boolean>();

  const isBlocked = (task: StoredTask): boolean => {
    const cached = blockedMemo.get(task.id);
    if (cached !== undefined) {
      return cached;
    }
    // Cycles are impossible for tasks created through createTask (deps can
    // only reference tasks that already exist), but guard recursion anyway so
    // a hand-edited store cannot wedge listTasks.
    blockedMemo.set(task.id, false);
    const blocked = task.deps.some((depId) => {
      const dep = byId.get(depId);
      return Boolean(dep && (dep.status === "failed" || isBlocked(dep)));
    });
    blockedMemo.set(task.id, blocked);
    return blocked;
  };

  return tasks.map((task) => {
    const gateResolved = !task.gate || task.gate.status === "resolved";
    const depsCompleted = task.deps.every((depId) => byId.get(depId)?.status === "completed");
    const blockingDeps = task.deps.filter((depId) => {
      const dep = byId.get(depId);
      return Boolean(dep && (dep.status === "failed" || isBlocked(dep)));
    });
    const blocked = blockingDeps.length > 0;
    return {
      ...task,
      blocked,
      blockingDeps,
      ready: task.status === "pending" && !blocked && gateResolved && depsCompleted,
    };
  });
}

function describeNotReadyReasons(view: TaskView, tasksById: Map<string, StoredTask>): string {
  const reasons: string[] = [];
  const pendingDeps = view.deps.filter((depId) => {
    const dep = tasksById.get(depId);
    return !dep || dep.status !== "completed";
  });
  if (pendingDeps.length > 0) {
    reasons.push(`dependencies not completed: ${pendingDeps.join(", ")}`);
  }
  if (view.blockingDeps.length > 0) {
    reasons.push(`blocked by failed dependencies: ${view.blockingDeps.join(", ")}`);
  }
  if (view.gate?.status === "pending") {
    reasons.push(`gate unresolved (question: ${view.gate.question})`);
  }
  return reasons.length > 0 ? reasons.join("; ") : "not ready";
}

export interface CreateTaskInput {
  ownerAgentId: string;
  title: string;
  spec?: string | null;
  deps?: string[];
  assigneeAgentId?: string | null;
  gate?: { question: string; options?: string[] | null } | null;
}

export interface TaskServiceOptions {
  paseoHome: string;
  logger: Logger;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  now?: () => Date;
  /**
   * Steers a system notification into an agent. Injectable so tests can
   * capture notifications without standing up the prompt pipeline.
   */
  sendNotification?: (agentId: string, body: string) => Promise<void>;
}

/**
 * Durable coordination state for agent-orchestrated work: task records with
 * dependency-aware readiness, workflow-level decision gates, and recoverable
 * child→parent questions. This is a state layer, not a scheduler — nothing is
 * dispatched automatically; coordinator agents read and write this state
 * through tools and react through system notifications.
 */
export class TaskService {
  private readonly store: TaskStore;
  private readonly questionStore: TaskQuestionStore;
  private readonly logger: Logger;
  private readonly agentManager: AgentManager;
  private readonly agentStorage: AgentStorage;
  private readonly now: () => Date;
  private readonly sendNotification: (agentId: string, body: string) => Promise<void>;
  private notificationQueue: Promise<void> = Promise.resolve();

  constructor(options: TaskServiceOptions) {
    this.store = new TaskStore(join(options.paseoHome, "tasks"));
    this.questionStore = new TaskQuestionStore(join(options.paseoHome, "task-questions"));
    this.logger = options.logger.child({ module: "task-service" });
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.now = options.now ?? (() => new Date());
    this.sendNotification =
      options.sendNotification ??
      (async (agentId, body) => {
        await sendPromptToAgent({
          agentManager: this.agentManager,
          agentStorage: this.agentStorage,
          agentId,
          prompt: formatSystemNotificationPrompt(body),
          activeTurnBehavior: "steer",
          unarchive: false,
          logger: this.logger,
        });
      });
  }

  /** Resolves once every queued notification has been attempted. */
  async flushNotifications(): Promise<void> {
    await this.notificationQueue;
  }

  /**
   * Steer a system notification into an agent. Archived targets are skipped
   * silently (matching notify-on-finish): the durable record remains, and the
   * recipient can recover it later via list tools.
   */
  private notifyAgentSafely(agentId: string, body: string, context: Record<string, unknown>) {
    this.notificationQueue = this.notificationQueue
      .then(() => this.deliverNotification(agentId, body))
      .catch((error) => {
        this.logger.error({ err: error, agentId, ...context }, "Failed to notify agent");
      });
  }

  private async deliverNotification(agentId: string, body: string): Promise<void> {
    const record = await this.agentStorage.get(agentId);
    if (record?.archivedAt) {
      return;
    }
    await this.sendNotification(agentId, body);
  }

  async createTask(input: CreateTaskInput): Promise<TaskView> {
    const title = input.title.trim();
    if (!title) {
      throw new Error("Task title is required");
    }

    const deps = [...new Set(input.deps ?? [])];
    await validateDeps(this.store, input.ownerAgentId, deps);

    if (input.assigneeAgentId && !this.agentManager.getAgent(input.assigneeAgentId)) {
      throw new Error(`Assignee agent not found: ${input.assigneeAgentId}`);
    }

    const timestamp = this.now().toISOString();
    const created = await this.store.create({
      ownerAgentId: input.ownerAgentId,
      title,
      spec: input.spec?.trim() ? input.spec : null,
      deps,
      assigneeAgentId: input.assigneeAgentId ?? null,
      status: "pending",
      result: null,
      failureReason: null,
      gate: buildGate(input.gate),
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
    });

    const ownerTasks = await this.store.listByOwner(input.ownerAgentId);
    const view = deriveTaskViews(ownerTasks).find((task) => task.id === created.id);
    if (!view) {
      throw new Error(`Created task disappeared: ${created.id}`);
    }
    return view;
  }

  async listTasks(options?: { ownerAgentId?: string }): Promise<TaskView[]> {
    const tasks = options?.ownerAgentId
      ? await this.store.listByOwner(options.ownerAgentId)
      : await this.store.list();
    return deriveTaskViews(tasks);
  }

  async inspectTask(id: string): Promise<TaskView | null> {
    const task = await this.store.get(id);
    if (!task) {
      return null;
    }
    const ownerTasks = await this.store.listByOwner(task.ownerAgentId);
    return deriveTaskViews(ownerTasks).find((view) => view.id === id) ?? null;
  }

  private async viewOf(id: string): Promise<TaskView> {
    const view = await this.inspectTask(id);
    if (!view) {
      throw new Error(`Task not found: ${id}`);
    }
    return view;
  }

  async startTask(input: { taskId: string; callerAgentId?: string }): Promise<TaskView> {
    return this.mutateTask(input, async (view) => {
      if (view.status !== "pending") {
        throw new Error(`Task ${view.id} is ${view.status}; only pending tasks can start`);
      }
      if (!view.ready) {
        const ownerTasks = await this.store.listByOwner(view.ownerAgentId);
        throw new Error(
          `Task ${view.id} is not ready: ${describeNotReadyReasons(view, new Map(ownerTasks.map((task) => [task.id, task] as const)))}`,
        );
      }
      const timestamp = this.now().toISOString();
      return {
        ...view,
        status: "in_progress" as const,
        startedAt: timestamp,
        updatedAt: timestamp,
      };
    });
  }

  async completeTask(input: {
    taskId: string;
    callerAgentId?: string;
    result?: string | null;
  }): Promise<TaskView> {
    return this.mutateTask(input, async (view) => {
      if (view.status === "completed") {
        throw new Error(`Task ${view.id} is already completed`);
      }
      if (view.status === "failed") {
        throw new Error(`Task ${view.id} failed; create a new task instead of completing it`);
      }
      if (view.gate?.status === "pending") {
        throw new Error(
          `Task ${view.id} has an unresolved decision gate: "${view.gate.question}". Resolve it first (resolve_task_gate / paseo task gate).`,
        );
      }
      if (view.status === "pending" && !view.ready) {
        const ownerTasks = await this.store.listByOwner(view.ownerAgentId);
        throw new Error(
          `Task ${view.id} is not ready: ${describeNotReadyReasons(view, new Map(ownerTasks.map((task) => [task.id, task] as const)))}`,
        );
      }
      const timestamp = this.now().toISOString();
      return {
        ...view,
        status: "completed" as const,
        result: input.result?.trim() ? input.result : null,
        completedAt: timestamp,
        updatedAt: timestamp,
      };
    });
  }

  async failTask(input: {
    taskId: string;
    callerAgentId?: string;
    reason?: string | null;
  }): Promise<TaskView> {
    return this.mutateTask(input, async (view) => {
      if (view.status === "completed") {
        throw new Error(`Task ${view.id} is completed and cannot be marked failed`);
      }
      if (view.status === "failed") {
        throw new Error(`Task ${view.id} is already failed`);
      }
      const timestamp = this.now().toISOString();
      return {
        ...view,
        status: "failed" as const,
        failureReason: input.reason?.trim() ? input.reason : null,
        completedAt: timestamp,
        updatedAt: timestamp,
      };
    });
  }

  async resolveGate(input: {
    taskId: string;
    callerAgentId?: string;
    resolution: string;
  }): Promise<TaskView> {
    return this.mutateTask(input, (view) => {
      if (!view.gate) {
        throw new Error(`Task ${view.id} has no decision gate`);
      }
      if (view.gate.status === "resolved") {
        throw new Error(
          `Gate for task ${view.id} is already resolved (resolution: ${view.gate.resolution})`,
        );
      }
      const resolution = input.resolution.trim();
      if (!resolution) {
        throw new Error("Gate resolution is required");
      }
      if (view.gate.options && !view.gate.options.includes(resolution)) {
        throw new Error(
          `Gate resolution must be one of: ${view.gate.options.join(", ")} (received: ${resolution})`,
        );
      }
      const timestamp = this.now().toISOString();
      return {
        ...view,
        gate: {
          ...view.gate,
          status: "resolved" as const,
          resolution,
          resolvedAt: timestamp,
          resolvedBy: input.callerAgentId ?? "human",
        },
        updatedAt: timestamp,
      };
    });
  }

  private async mutateTask(
    input: { taskId: string; callerAgentId?: string },
    updater: (view: TaskView) => Promise<StoredTask> | StoredTask,
  ): Promise<TaskView> {
    const current = await this.store.get(input.taskId);
    requireTask(current, input.taskId);
    if (!mayMutateTask(current, input.callerAgentId)) {
      throw new Error(
        `Agent ${input.callerAgentId} may not mutate task ${input.taskId} (owner: ${current.ownerAgentId}, assignee: ${current.assigneeAgentId})`,
      );
    }
    const view = await this.viewOf(input.taskId);
    const next = await updater(view);
    const updated = await this.store.update(input.taskId, () => next);
    if (!updated) {
      throw new Error(`Task not found: ${input.taskId}`);
    }
    const result = await this.viewOf(input.taskId);
    if (!result) {
      throw new Error(`Task not found: ${input.taskId}`);
    }
    return result;
  }

  /**
   * A child agent asks its parent a durable question. The question survives
   * parent restarts/archival; the parent is steered a notification and can
   * recover anything missed via list_questions.
   */
  async askParent(input: {
    askerAgentId: string;
    question: string;
    taskId?: string | null;
  }): Promise<StoredTaskQuestion> {
    const questionText = input.question.trim();
    if (!questionText) {
      throw new Error("Question is required");
    }

    const askerRecord = await this.agentStorage.get(input.askerAgentId);
    if (!askerRecord) {
      throw new Error(`Agent not found: ${input.askerAgentId}`);
    }
    const parentAgentId = getParentAgentIdFromLabels(askerRecord.labels);
    if (!parentAgentId) {
      throw new Error(
        "ask_parent requires a parent agent. This agent has no parent label (paseo.parent-agent-id); to ask the human user, use your normal permission/question flow instead.",
      );
    }

    if (input.taskId) {
      const task = await this.store.get(input.taskId);
      requireTask(task, input.taskId);
      if (task.ownerAgentId !== input.askerAgentId && task.assigneeAgentId !== input.askerAgentId) {
        throw new Error(
          `Task ${input.taskId} is not owned or assigned to agent ${input.askerAgentId}`,
        );
      }
    }

    const created = await this.questionStore.create({
      askerAgentId: input.askerAgentId,
      parentAgentId,
      taskId: input.taskId ?? null,
      question: questionText,
      status: "pending",
      answer: null,
      createdAt: this.now().toISOString(),
      answeredAt: null,
    });

    const askerTitle = askerRecord.title ?? input.askerAgentId;
    const lines = [
      `Agent ${input.askerAgentId} (${askerTitle}) asks you a question (question ${created.id}).`,
      ...(input.taskId ? [`Related task: ${input.taskId}.`] : []),
      `<question>\n${questionText}\n</question>`,
      `Answer with the answer_question tool: question_id="${created.id}", answer="...".`,
    ];
    this.notifyAgentSafely(parentAgentId, lines.join("\n"), {
      questionId: created.id,
      kind: "ask_parent",
    });

    return created;
  }

  /**
   * Answer a pending question. The parent agent (or a human via the session
   * RPC) may answer; the asking child agent is steered the answer.
   */
  async answerQuestion(input: {
    questionId: string;
    callerAgentId?: string;
    answer: string;
  }): Promise<StoredTaskQuestion> {
    const answerText = input.answer.trim();
    if (!answerText) {
      throw new Error("Answer is required");
    }
    const current = await this.questionStore.get(input.questionId);
    if (!current) {
      throw new Error(`Question not found: ${input.questionId}`);
    }
    if (input.callerAgentId && input.callerAgentId !== current.parentAgentId) {
      throw new Error(
        `Agent ${input.callerAgentId} may not answer question ${input.questionId} (addressee: ${current.parentAgentId})`,
      );
    }
    if (current.status !== "pending") {
      throw new Error(`Question ${input.questionId} is already ${current.status}`);
    }

    const timestamp = this.now().toISOString();
    const updated = await this.questionStore.update(input.questionId, (question) => ({
      ...question,
      status: "answered" as const,
      answer: answerText,
      answeredAt: timestamp,
    }));
    if (!updated) {
      throw new Error(`Question not found: ${input.questionId}`);
    }

    this.notifyAgentSafely(
      current.askerAgentId,
      [
        `Your question ${current.id} was answered${current.taskId ? ` (task ${current.taskId})` : ""}.`,
        `<answer>\n${answerText}\n</answer>`,
      ].join("\n"),
      { questionId: current.id, kind: "answer_question" },
    );

    return updated;
  }

  /** Human-surface listing: every question, optionally filtered by status. */
  async listAllQuestions(status?: TaskQuestionStatus): Promise<StoredTaskQuestion[]> {
    const questions = await this.questionStore.list();
    return status ? questions.filter((question) => question.status === status) : questions;
  }

  /** Agent-surface listing: questions waiting on the caller plus the caller's own. */
  async listQuestionsForAgent(
    agentId: string,
    status?: TaskQuestionStatus,
  ): Promise<{ toAnswer: StoredTaskQuestion[]; asked: StoredTaskQuestion[] }> {
    const questions = await this.questionStore.list();
    const matchesStatus = (question: StoredTaskQuestion) =>
      status ? question.status === status : true;
    return {
      toAnswer: questions.filter(
        (question) => question.parentAgentId === agentId && matchesStatus(question),
      ),
      asked: questions.filter(
        (question) => question.askerAgentId === agentId && matchesStatus(question),
      ),
    };
  }
}
