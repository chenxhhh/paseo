import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TaskQuestionStore, TaskStore } from "./store.js";

function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    ownerAgentId: "11111111-1111-1111-1111-111111111111",
    title: "Implement feature",
    spec: "Do the thing",
    deps: [],
    assigneeAgentId: null,
    status: "pending" as const,
    result: null,
    failureReason: null,
    gate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("TaskStore", () => {
  let tempDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "task-store-test-"));
    store = new TaskStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("creates and reloads tasks from disk", async () => {
    const created = await store.create(baseTask());
    const reloaded = new TaskStore(tempDir);
    const listed = await reloaded.list();

    expect(created.id).toHaveLength(8);
    expect(listed).toEqual([created]);
  });

  test("lists tasks scoped by owner", async () => {
    const ownerA = "11111111-1111-1111-1111-111111111111";
    const ownerB = "22222222-2222-2222-2222-222222222222";
    await store.create(
      baseTask({ ownerAgentId: ownerA, title: "A1", createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    await store.create(
      baseTask({ ownerAgentId: ownerA, title: "A2", createdAt: "2026-01-01T00:00:01.000Z" }),
    );
    await store.create(
      baseTask({ ownerAgentId: ownerB, title: "B1", createdAt: "2026-01-01T00:00:02.000Z" }),
    );

    const owned = await store.listByOwner(ownerA);
    expect(owned.map((task) => task.title)).toEqual(["A1", "A2"]);
  });

  test("update round-trips changes and cannot change id", async () => {
    const created = await store.create(baseTask());
    const updated = await store.update(created.id, (task) => ({
      ...task,
      status: "completed",
      result: "done",
    }));
    expect(updated?.status).toBe("completed");

    await expect(store.update(created.id, (task) => ({ ...task, id: "other" }))).rejects.toThrow(
      /cannot change id/,
    );
  });

  test("update returns null for missing tasks", async () => {
    expect(await store.update("missing", (task) => task)).toBeNull();
    expect(await store.get("missing")).toBeNull();
  });
});

describe("TaskQuestionStore", () => {
  let tempDir: string;
  let store: TaskQuestionStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "task-question-store-test-"));
    store = new TaskQuestionStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("creates and reloads questions from disk", async () => {
    const created = await store.create({
      askerAgentId: "11111111-1111-1111-1111-111111111111",
      parentAgentId: "22222222-2222-2222-2222-222222222222",
      taskId: null,
      question: "Which branch?",
      status: "pending",
      answer: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      answeredAt: null,
    });

    const reloaded = new TaskQuestionStore(tempDir);
    const listed = await reloaded.list();

    expect(created.id).toHaveLength(8);
    expect(listed).toEqual([created]);
  });

  test("update transitions a question to answered", async () => {
    const created = await store.create({
      askerAgentId: "a",
      parentAgentId: "b",
      taskId: null,
      question: "Q?",
      status: "pending",
      answer: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      answeredAt: null,
    });

    const updated = await store.update(created.id, (question) => ({
      ...question,
      status: "answered" as const,
      answer: "A",
      answeredAt: "2026-01-01T00:01:00.000Z",
    }));
    expect(updated?.status).toBe("answered");
    expect(updated?.answer).toBe("A");
  });
});
