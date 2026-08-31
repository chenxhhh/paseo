import { describe, expect, test } from "vitest";
import {
  TaskListRequestSchema,
  TaskListResponseSchema,
  TaskResolveGateRequestSchema,
  TaskAnswerQuestionRequestSchema,
} from "./rpc-schemas.js";

describe("task rpc schemas", () => {
  test("parses a task/list request", () => {
    expect(TaskListRequestSchema.parse({ type: "task/list", requestId: "r1" })).toEqual({
      type: "task/list",
      requestId: "r1",
    });
  });

  test("parses a task/list request with an owner filter", () => {
    const parsed = TaskListRequestSchema.parse({
      type: "task/list",
      requestId: "r1",
      ownerAgentId: "agent-1",
    });
    expect(parsed.ownerAgentId).toBe("agent-1");
  });

  test("parses a task/resolve-gate request", () => {
    expect(
      TaskResolveGateRequestSchema.parse({
        type: "task/resolve-gate",
        requestId: "r1",
        taskId: "abcd1234",
        resolution: "yes",
      }),
    ).toEqual({
      type: "task/resolve-gate",
      requestId: "r1",
      taskId: "abcd1234",
      resolution: "yes",
    });
  });

  test("rejects an empty resolution", () => {
    expect(() =>
      TaskResolveGateRequestSchema.parse({
        type: "task/resolve-gate",
        requestId: "r1",
        taskId: "abcd1234",
        resolution: "  ",
      }),
    ).toThrow();
  });

  test("parses a task/answer-question request", () => {
    expect(
      TaskAnswerQuestionRequestSchema.parse({
        type: "task/answer-question",
        requestId: "r1",
        questionId: "q1",
        answer: "use main",
      }),
    ).toEqual({
      type: "task/answer-question",
      requestId: "r1",
      questionId: "q1",
      answer: "use main",
    });
  });

  test("response payload carries a nullable error", () => {
    const parsed = TaskListResponseSchema.parse({
      type: "task/list/response",
      payload: { requestId: "r1", tasks: [], error: null },
    });
    expect(parsed.payload.tasks).toEqual([]);
  });
});
