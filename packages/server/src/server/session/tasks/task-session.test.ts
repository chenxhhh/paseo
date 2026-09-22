import { describe, expect, test, vi } from "vitest";
import type pino from "pino";
import type { SessionOutboundMessage } from "../../messages.js";
import { TaskSession } from "./task-session.js";
import type { TaskService } from "../../tasks/service.js";
import type { TaskView } from "@getpaseo/protocol/tasks/types";

const logger = {
  child: () => logger,
  error: () => undefined,
} as unknown as pino.Logger;

function baseTaskView(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: "abcd1234",
    ownerAgentId: "11111111-1111-1111-1111-111111111111",
    title: "T",
    spec: null,
    deps: [],
    assigneeAgentId: null,
    status: "pending",
    result: null,
    failureReason: null,
    gate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ready: true,
    blocked: false,
    blockingDeps: [],
    ...overrides,
  };
}

function buildSession(service: Partial<TaskService>) {
  const emitted: SessionOutboundMessage[] = [];
  const session = new TaskSession({
    host: { emit: (msg) => emitted.push(msg) },
    taskService: service as TaskService,
    logger,
  });
  return { session, emitted };
}

describe("TaskSession", () => {
  test("task/list emits the service views", async () => {
    const tasks = [baseTaskView()];
    const { session, emitted } = buildSession({ listTasks: vi.fn().mockResolvedValue(tasks) });

    await session.handleTaskListRequest({ type: "task/list", requestId: "r1" });

    expect(emitted).toEqual([
      {
        type: "task/list/response",
        payload: { requestId: "r1", tasks, error: null },
      },
    ]);
  });

  test("task/list failures become rpc_error", async () => {
    const { session, emitted } = buildSession({
      listTasks: vi.fn().mockRejectedValue(new Error("disk on fire")),
    });

    await session.handleTaskListRequest({ type: "task/list", requestId: "r2" });

    expect(emitted).toEqual([
      {
        type: "rpc_error",
        payload: {
          requestId: "r2",
          requestType: "task/list",
          error: "disk on fire",
          code: "task_request_failed",
        },
      },
    ]);
  });

  test("task/inspect emits null-error rpc for missing tasks", async () => {
    const { session, emitted } = buildSession({ inspectTask: vi.fn().mockResolvedValue(null) });

    await session.handleTaskInspectRequest({
      type: "task/inspect",
      requestId: "r3",
      taskId: "missing",
    });

    expect(emitted[0]).toEqual({
      type: "rpc_error",
      payload: {
        requestId: "r3",
        requestType: "task/inspect",
        error: "Task not found: missing",
        code: "task_request_failed",
      },
    });
  });

  test("task/resolve-gate resolves as the human", async () => {
    const resolveGate = vi.fn().mockResolvedValue(
      baseTaskView({
        gate: {
          question: "Go?",
          options: null,
          status: "resolved",
          resolution: "go",
          resolvedAt: "2026-01-01T00:01:00.000Z",
          resolvedBy: "human",
        },
      }),
    );
    const { session, emitted } = buildSession({ resolveGate });

    await session.handleTaskResolveGateRequest({
      type: "task/resolve-gate",
      requestId: "r4",
      taskId: "abcd1234",
      resolution: "go",
    });

    expect(resolveGate).toHaveBeenCalledWith({
      taskId: "abcd1234",
      resolution: "go",
    });
    expect(emitted[0]?.type).toBe("task/resolve-gate/response");
  });

  test("task/answer-question answers as the human", async () => {
    const answerQuestion = vi.fn().mockResolvedValue({
      id: "q1",
      askerAgentId: "a",
      parentAgentId: "b",
      taskId: null,
      question: "Q?",
      status: "answered",
      answer: "A",
      createdAt: "2026-01-01T00:00:00.000Z",
      answeredAt: "2026-01-01T00:01:00.000Z",
    });
    const { session, emitted } = buildSession({ answerQuestion });

    await session.handleTaskAnswerQuestionRequest({
      type: "task/answer-question",
      requestId: "r5",
      questionId: "q1",
      answer: "A",
    });

    expect(answerQuestion).toHaveBeenCalledWith({ questionId: "q1", answer: "A" });
    expect(emitted[0]?.type).toBe("task/answer-question/response");
  });

  test("task/questions lists with an optional status filter", async () => {
    const listAllQuestions = vi.fn().mockResolvedValue([]);
    const { session, emitted } = buildSession({ listAllQuestions });

    await session.handleTaskQuestionsRequest({
      type: "task/questions",
      requestId: "r6",
      status: "pending",
    });

    expect(listAllQuestions).toHaveBeenCalledWith("pending");
    expect(emitted[0]?.type).toBe("task/questions/response");
  });
});
