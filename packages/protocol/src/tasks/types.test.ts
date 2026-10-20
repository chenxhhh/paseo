import { describe, expect, test } from "vitest";
import { StoredTaskQuestionSchema, StoredTaskSchema, TaskViewSchema } from "./types.js";

const baseTask = {
  id: "abcd1234",
  ownerAgentId: "11111111-1111-1111-1111-111111111111",
  title: "Ship it",
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
};

describe("StoredTaskSchema", () => {
  test("accepts a minimal task", () => {
    expect(StoredTaskSchema.parse(baseTask)).toEqual(baseTask);
  });

  test("accepts a gated task with options", () => {
    const task = StoredTaskSchema.parse({
      ...baseTask,
      gate: {
        question: "Deploy?",
        options: ["yes", "no"],
        status: "pending",
        resolution: null,
        resolvedAt: null,
        resolvedBy: null,
      },
    });
    expect(task.gate?.options).toEqual(["yes", "no"]);
  });

  test("rejects an empty title", () => {
    expect(() => StoredTaskSchema.parse({ ...baseTask, title: "  " })).toThrow();
  });

  test("rejects an unknown status", () => {
    expect(() => StoredTaskSchema.parse({ ...baseTask, status: "ready" })).toThrow();
  });
});

describe("TaskViewSchema", () => {
  test("extends the stored task with derived flags", () => {
    const view = TaskViewSchema.parse({
      ...baseTask,
      ready: true,
      blocked: false,
      blockingDeps: [],
    });
    expect(view.ready).toBe(true);
  });

  test("requires the derived flags", () => {
    expect(() => TaskViewSchema.parse(baseTask)).toThrow();
  });
});

describe("StoredTaskQuestionSchema", () => {
  test("round-trips a pending question", () => {
    const question = {
      id: "abcd1234",
      askerAgentId: "a",
      parentAgentId: "b",
      taskId: null,
      question: "Which branch?",
      status: "pending",
      answer: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      answeredAt: null,
    };
    expect(StoredTaskQuestionSchema.parse(question)).toEqual(question);
  });

  test("rejects an unknown status", () => {
    expect(() =>
      StoredTaskQuestionSchema.parse({
        id: "abcd1234",
        askerAgentId: "a",
        parentAgentId: "b",
        taskId: null,
        question: "Q",
        status: "open",
        answer: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        answeredAt: null,
      }),
    ).toThrow();
  });
});
