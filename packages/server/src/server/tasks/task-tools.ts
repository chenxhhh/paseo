import { z } from "zod";
import { TaskQuestionViewSchema, TaskViewSchema } from "@getpaseo/protocol/tasks/types";
import type { TaskService } from "./service.js";
import type {
  PaseoToolConfig,
  PaseoToolExecutionContext,
  PaseoToolResult,
} from "../agent/tools/types.js";

export interface RegisterTaskToolsOptions {
  registerTool: (
    name: string,
    config: PaseoToolConfig,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool inputs are validated by the catalog before execution.
    handler: (input: any, context: PaseoToolExecutionContext) => Promise<PaseoToolResult>,
  ) => void;
  taskService?: TaskService | null;
  callerAgentId?: string;
  resolveCallerAgent: () => unknown;
  ensureValidJson: <T>(data: T) => T;
}

export function registerTaskTools(options: RegisterTaskToolsOptions): void {
  const { registerTool, taskService, callerAgentId, resolveCallerAgent, ensureValidJson } = options;

  const requireTaskToolSession = (): { service: TaskService; caller: string } => {
    if (!taskService) {
      throw new Error("Task service is not configured");
    }
    if (!callerAgentId) {
      throw new Error("Task tools require an agent-scoped session");
    }
    return { service: taskService, caller: callerAgentId };
  };

  registerTool(
    "create_task",
    {
      title: "Create task",
      description:
        "Create a durable coordination task owned by you. Tasks form your external memory for multi-agent work: list them with list_tasks, reference them from child agent prompts, and track completion with complete_task. A pending task becomes ready once all deps are completed and its gate (if any) is resolved.",
      inputSchema: {
        title: z.string().trim().min(1, "title is required"),
        spec: z.string().optional().describe("Full task description, acceptance criteria"),
        deps: z
          .array(z.string().trim().min(1))
          .optional()
          .describe("Task ids that must complete before this task is ready"),
        assignee_agent_id: z
          .string()
          .optional()
          .describe("Agent id of the worker that will execute this task"),
        gate: z
          .object({
            question: z.string().trim().min(1),
            options: z.array(z.string().trim().min(1)).optional(),
          })
          .optional()
          .describe(
            "Workflow-level decision gate: the task cannot start or complete until a human or you resolve it",
          ),
      },
      outputSchema: { ...TaskViewSchema.shape, guidance: z.string().optional() },
    },
    async ({ title, spec, deps, assignee_agent_id, gate }) => {
      const { service, caller } = requireTaskToolSession();
      resolveCallerAgent();
      const task = await service.createTask({
        ownerAgentId: caller,
        title,
        spec: spec ?? null,
        deps: deps ?? [],
        assigneeAgentId: assignee_agent_id ?? null,
        gate: gate ?? null,
      });
      const guidance = task.ready
        ? `Task ${task.id} is ready. Dispatch it by including the task id and spec in a child agent prompt (or work on it yourself); complete it with complete_task.`
        : `Task ${task.id} is not ready yet${task.gate?.status === "pending" ? " (gate unresolved)" : ""}${task.deps.length > 0 ? " (waiting on deps)" : ""}. Use list_tasks to track readiness.`;
      return {
        content: [],
        structuredContent: ensureValidJson({ ...task, guidance }),
      };
    },
  );

  registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List your coordination tasks. Filter status=ready to see what can be dispatched now (deps completed, gates resolved), or status=blocked to see tasks whose dependencies failed.",
      inputSchema: {
        status: z
          .enum(["ready", "pending", "in_progress", "completed", "failed", "blocked"])
          .optional(),
      },
      outputSchema: { tasks: z.array(TaskViewSchema) },
    },
    async ({ status }) => {
      const { service, caller } = requireTaskToolSession();
      const tasks = await service.listTasks({ ownerAgentId: caller });
      const filtered = tasks.filter((task) => {
        if (status === "ready") return task.ready;
        if (status === "blocked") return task.blocked;
        if (status === undefined) return true;
        return task.status === status;
      });
      return {
        content: [],
        structuredContent: ensureValidJson({ tasks: filtered }),
      };
    },
  );

  registerTool(
    "inspect_task",
    {
      title: "Inspect task",
      description:
        "Inspect one coordination task, including derived readiness, blocking dependencies, and gate state.",
      inputSchema: { task_id: z.string().trim().min(1) },
      outputSchema: { task: TaskViewSchema },
    },
    async ({ task_id }) => {
      const { service } = requireTaskToolSession();
      const task = await service.inspectTask(task_id);
      if (!task) {
        throw new Error(`Task not found: ${task_id}`);
      }
      return { content: [], structuredContent: ensureValidJson({ task }) };
    },
  );

  registerTool(
    "start_task",
    {
      title: "Start task",
      description:
        "Mark a task in progress. Only ready tasks can start; the error explains what is missing otherwise.",
      inputSchema: { task_id: z.string().trim().min(1) },
      outputSchema: { task: TaskViewSchema },
    },
    async ({ task_id }) => {
      const { service, caller } = requireTaskToolSession();
      const task = await service.startTask({ taskId: task_id, callerAgentId: caller });
      return { content: [], structuredContent: ensureValidJson({ task }) };
    },
  );

  registerTool(
    "complete_task",
    {
      title: "Complete task",
      description:
        "Mark a task completed with an optional result. Tasks depending on it become ready immediately (check with list_tasks status=ready).",
      inputSchema: {
        task_id: z.string().trim().min(1),
        result: z.string().optional().describe("Result summary or report for dependents"),
      },
      outputSchema: { task: TaskViewSchema },
    },
    async ({ task_id, result }) => {
      const { service, caller } = requireTaskToolSession();
      const task = await service.completeTask({
        taskId: task_id,
        callerAgentId: caller,
        result: result ?? null,
      });
      return { content: [], structuredContent: ensureValidJson({ task }) };
    },
  );

  registerTool(
    "fail_task",
    {
      title: "Fail task",
      description:
        "Mark a task failed. Every downstream task that depends on it (directly or transitively) becomes blocked; re-plan by creating replacement tasks.",
      inputSchema: {
        task_id: z.string().trim().min(1),
        reason: z.string().optional(),
      },
      outputSchema: { task: TaskViewSchema },
    },
    async ({ task_id, reason }) => {
      const { service, caller } = requireTaskToolSession();
      const task = await service.failTask({
        taskId: task_id,
        callerAgentId: caller,
        reason: reason ?? null,
      });
      return { content: [], structuredContent: ensureValidJson({ task }) };
    },
  );

  registerTool(
    "resolve_task_gate",
    {
      title: "Resolve task gate",
      description:
        "Resolve a decision gate on one of your tasks. If the gate declared options, the resolution must be one of them. A human can also resolve gates from the CLI (paseo task gate).",
      inputSchema: {
        task_id: z.string().trim().min(1),
        resolution: z.string().trim().min(1),
      },
      outputSchema: { task: TaskViewSchema },
    },
    async ({ task_id, resolution }) => {
      const { service, caller } = requireTaskToolSession();
      const task = await service.resolveGate({
        taskId: task_id,
        callerAgentId: caller,
        resolution,
      });
      return { content: [], structuredContent: ensureValidJson({ task }) };
    },
  );

  registerTool(
    "ask_parent",
    {
      title: "Ask parent agent",
      description:
        "Ask your parent agent a durable question. The parent is notified immediately and can answer with answer_question; the answer arrives as a system notification. Questions survive restarts — if you miss the notification, do not re-ask; the parent can recover pending questions with list_questions.",
      inputSchema: {
        question: z.string().trim().min(1, "question is required"),
        task_id: z.string().trim().min(1).optional(),
      },
      outputSchema: { question: TaskQuestionViewSchema, guidance: z.string().optional() },
    },
    async ({ question, task_id }) => {
      const { service, caller } = requireTaskToolSession();
      const created = await service.askParent({
        askerAgentId: caller,
        question,
        taskId: task_id ?? null,
      });
      const guidance =
        "Your parent agent has been notified and will answer with answer_question. The answer will arrive as a system notification. Do not poll; continue with other work or wait.";
      return {
        content: [],
        structuredContent: ensureValidJson({ question: created, guidance }),
      };
    },
  );

  registerTool(
    "answer_question",
    {
      title: "Answer question",
      description:
        "Answer a question asked by one of your child agents (see ask_parent). The child agent is notified with your answer immediately.",
      inputSchema: {
        question_id: z.string().trim().min(1),
        answer: z.string().trim().min(1),
      },
      outputSchema: { question: TaskQuestionViewSchema },
    },
    async ({ question_id, answer }) => {
      const { service, caller } = requireTaskToolSession();
      const question = await service.answerQuestion({
        questionId: question_id,
        callerAgentId: caller,
        answer,
      });
      return { content: [], structuredContent: ensureValidJson({ question }) };
    },
  );

  registerTool(
    "list_questions",
    {
      title: "List questions",
      description:
        "List questions addressed to you for answering (toAnswer) and questions you have asked (asked). Use this to recover pending questions after a restart.",
      inputSchema: {
        status: z.enum(["pending", "answered", "closed"]).optional(),
      },
      outputSchema: {
        toAnswer: z.array(TaskQuestionViewSchema),
        asked: z.array(TaskQuestionViewSchema),
      },
    },
    async ({ status }) => {
      const { service, caller } = requireTaskToolSession();
      const questions = await service.listQuestionsForAgent(caller, status);
      return { content: [], structuredContent: ensureValidJson(questions) };
    },
  );
}
