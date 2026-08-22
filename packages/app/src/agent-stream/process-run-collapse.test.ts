import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import { collapseProcessRuns } from "./process-run-collapse";

function toolCall(
  id: string,
  detail: ToolCallDetail,
  status: "completed" | "running" | "failed" = "completed",
): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(`2026-01-01T00:00:${id.padStart(2, "0")}.000Z`),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: detail.type,
        status,
        error: null,
        detail,
      },
    },
  };
}

function assistant(id: string): Extract<StreamItem, { kind: "assistant_message" }> {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: new Date("2026-01-01T00:01:00.000Z"),
  };
}

function userMessage(id: string): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function thought(
  id: string,
  status: "ready" | "loading" = "ready",
): Extract<StreamItem, { kind: "thought" }> {
  return {
    kind: "thought",
    id,
    text: id,
    timestamp: new Date("2026-01-01T00:00:10.000Z"),
    status,
  };
}

function todoList(id: string): Extract<StreamItem, { kind: "todo_list" }> {
  return {
    kind: "todo_list",
    id,
    timestamp: new Date("2026-01-01T00:00:20.000Z"),
    provider: "claude",
    items: [{ text: "task", status: "pending", completed: false }],
    activity: { type: "created", count: 1 },
  };
}

const EMPTY_EXPANDED = new Set<string>();

describe("collapseProcessRuns", () => {
  it("collapses a mixed process run onto its first item and counts by kind", () => {
    const user = userMessage("u1");
    const thinking = thought("th1");
    const read = toolCall("1", { type: "read", filePath: "/repo/a.ts" });
    const search = toolCall("2", { type: "search", query: "paseo" });
    const todo = todoList("todo1");
    const reply = assistant("a1");
    const tail = [user, thinking, read, search, todo, reply];

    const result = collapseProcessRuns({
      tail,
      enabled: true,
      expandedRunIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });

    expect(result.tail).toEqual([user, thinking, reply]);
    expect(result.runsByFirstItemId.get("th1")).toEqual({
      firstItemId: "th1",
      thoughtCount: 1,
      toolCountsByCategory: {
        read: 1,
        search: 1,
        edit: 0,
        shell: 0,
        fetch: 0,
        other: 0,
      },
      todoCount: 1,
    });
  });

  it("collapses a consecutive thinking-only run", () => {
    const user = userMessage("u1");
    const first = thought("th1");
    const second = thought("th2");
    const third = thought("th3");
    const reply = assistant("a1");
    const result = collapseProcessRuns({
      tail: [user, first, second, third, reply],
      enabled: true,
      expandedRunIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });

    expect(result.tail).toEqual([user, first, reply]);
    expect(result.runsByFirstItemId.get("th1")?.thoughtCount).toBe(3);
    expect(result.runsByFirstItemId.get("th1")?.todoCount).toBe(0);
  });

  it("splits process runs around assistant narration", () => {
    const user = userMessage("u1");
    const firstThought = thought("th1");
    const read = toolCall("1", { type: "read", filePath: "/repo/a.ts" });
    const mid = assistant("a-mid");
    const edit = toolCall("2", { type: "edit", filePath: "/repo/a.ts" });
    const shell = toolCall("3", { type: "shell", command: "ls" });
    const final = assistant("a-final");
    const result = collapseProcessRuns({
      tail: [user, firstThought, read, mid, edit, shell, final],
      enabled: true,
      expandedRunIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });

    expect(result.tail).toEqual([user, firstThought, mid, edit, final]);
    expect(result.runsByFirstItemId.get("th1")?.toolCountsByCategory.read).toBe(1);
    expect(result.runsByFirstItemId.get("2")?.toolCountsByCategory).toMatchObject({
      edit: 1,
      shell: 1,
    });
  });

  it("passes an expanded run through while collapsing others", () => {
    const first = thought("th1");
    const read = toolCall("1", { type: "read", filePath: "/repo/a.ts" });
    const mid = assistant("a-mid");
    const edit = toolCall("2", { type: "edit", filePath: "/repo/a.ts" });
    const shell = toolCall("3", { type: "shell", command: "ls" });
    const tail = [first, read, mid, edit, shell];
    const result = collapseProcessRuns({
      tail,
      enabled: true,
      expandedRunIds: new Set(["th1"]),
      isTurnActive: false,
    });

    expect(result.tail).toEqual([first, read, mid, edit]);
    expect(result.runsByFirstItemId.has("th1")).toBe(true);
    expect(result.runsByFirstItemId.has("2")).toBe(true);
  });

  it("does not collapse a run that still has a live tool or thought", () => {
    const loading = thought("th1", "loading");
    const read = toolCall("1", { type: "read", filePath: "/repo/a.ts" });
    const running = toolCall("2", { type: "shell", command: "ls" }, "running");
    const grep = toolCall("3", { type: "search", query: "x" });
    const tail = [loading, read, assistant("a1"), running, grep];
    const result = collapseProcessRuns({
      tail,
      enabled: true,
      expandedRunIds: EMPTY_EXPANDED,
      isTurnActive: true,
    });

    expect(result.tail).toBe(tail);
    expect(result.runsByFirstItemId.size).toBe(0);
  });

  it("folds a finished turn even when restored statuses are stale", () => {
    const staleThought = thought("th1", "loading");
    const read = toolCall("1", { type: "read", filePath: "/repo/a.ts" });
    const reply = assistant("a1");
    const result = collapseProcessRuns({
      tail: [staleThought, read, reply],
      enabled: true,
      expandedRunIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });

    expect(result.tail).toEqual([staleThought, reply]);
    expect(result.runsByFirstItemId.get("th1")?.toolCountsByCategory.read).toBe(1);
  });

  it("returns the same tail reference when disabled or nothing is collapsible", () => {
    const collapsible = [
      thought("th1"),
      toolCall("1", { type: "read", filePath: "/repo/a.ts" }),
      assistant("a1"),
    ];
    const disabled = collapseProcessRuns({
      tail: collapsible,
      enabled: false,
      expandedRunIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });
    expect(disabled.tail).toBe(collapsible);
    expect(disabled.runsByFirstItemId.size).toBe(0);

    const singleton = [userMessage("u1"), toolCall("1", { type: "shell", command: "ls" })];
    const untouched = collapseProcessRuns({
      tail: singleton,
      enabled: true,
      expandedRunIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });
    expect(untouched.tail).toBe(singleton);
    expect(untouched.runsByFirstItemId.size).toBe(0);
  });

  it("counts fetch and unknown tools toward other", () => {
    const fetch = toolCall("1", { type: "fetch", url: "https://paseo.sh" });
    const unknown = toolCall("2", { type: "unknown", input: null, output: null });
    const result = collapseProcessRuns({
      tail: [fetch, unknown],
      enabled: true,
      expandedRunIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });

    expect(result.runsByFirstItemId.get("1")?.toolCountsByCategory).toEqual({
      read: 0,
      search: 0,
      edit: 0,
      shell: 0,
      fetch: 1,
      other: 1,
    });
  });
});
