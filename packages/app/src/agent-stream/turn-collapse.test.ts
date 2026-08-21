import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import { collapseCompletedTurns } from "./turn-collapse";

type AssistantMessageItem = Extract<StreamItem, { kind: "assistant_message" }>;
type UserMessageItem = Extract<StreamItem, { kind: "user_message" }>;

function toolCall(id: string, detail: ToolCallDetail, name?: string): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(`2026-01-01T00:00:${id.padStart(2, "0")}.000Z`),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: name ?? detail.type,
        status: "completed",
        error: null,
        detail,
      },
    },
  };
}

function assistant(id: string): AssistantMessageItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: new Date("2026-01-01T00:01:00.000Z"),
  };
}

function userMessage(id: string, turnId?: string): UserMessageItem {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
    ...(turnId ? { turnId } : {}),
  };
}

function thought(id: string): Extract<StreamItem, { kind: "thought" }> {
  return {
    kind: "thought",
    id,
    text: id,
    timestamp: new Date("2026-01-01T00:00:10.000Z"),
    status: "ready",
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

describe("collapseCompletedTurns", () => {
  it("collapses a completed response to the user prompt and final assistant", () => {
    const user = userMessage("u1");
    const mid = assistant("a-mid");
    const final = assistant("a-final");
    const tail = [
      user,
      thought("th1"),
      toolCall("1", { type: "read", filePath: "/repo/a.ts" }),
      mid,
      todoList("todo1"),
      final,
    ];

    const result = collapseCompletedTurns({
      tail,
      enabled: true,
      expandedAnchorItemIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });

    expect(result.tail).toEqual([user, final]);
    expect(result.summariesByAnchorItemId.get("a-final")?.hiddenItemCount).toBe(4);
  });

  it("returns the same tail reference when disabled or nothing is collapsible", () => {
    const collapsible = [
      userMessage("u1"),
      toolCall("1", { type: "shell", command: "ls" }),
      assistant("a1"),
    ];
    const disabled = collapseCompletedTurns({
      tail: collapsible,
      enabled: false,
      expandedAnchorItemIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });
    expect(disabled.tail).toBe(collapsible);
    expect(disabled.summariesByAnchorItemId.size).toBe(0);

    const plain = [userMessage("u2"), assistant("a2")];
    const untouched = collapseCompletedTurns({
      tail: plain,
      enabled: true,
      expandedAnchorItemIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });
    expect(untouched.tail).toBe(plain);
    expect(untouched.summariesByAnchorItemId.size).toBe(0);
  });

  it("does not collapse the trailing response while the turn is active", () => {
    const user = userMessage("u1");
    const read = toolCall("1", { type: "read", filePath: "/repo/a.ts" });
    const reply = assistant("a1");
    const tail = [user, read, reply];

    const active = collapseCompletedTurns({
      tail,
      enabled: true,
      expandedAnchorItemIds: EMPTY_EXPANDED,
      isTurnActive: true,
    });
    expect(active.tail).toBe(tail);
    expect(active.summariesByAnchorItemId.size).toBe(0);

    const idle = collapseCompletedTurns({
      tail,
      enabled: true,
      expandedAnchorItemIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });
    expect(idle.tail).toEqual([user, reply]);
    expect(idle.summariesByAnchorItemId.has("a1")).toBe(true);
  });

  it("passes an expanded response through while still collapsing others", () => {
    const firstUser = userMessage("u1");
    const firstReply = assistant("a1");
    const secondUser = userMessage("u2");
    const secondReply = assistant("a2");
    const tail = [
      firstUser,
      toolCall("1", { type: "shell", command: "one" }),
      firstReply,
      secondUser,
      toolCall("2", { type: "shell", command: "two" }),
      secondReply,
    ];

    const result = collapseCompletedTurns({
      tail,
      enabled: true,
      expandedAnchorItemIds: new Set(["a1"]),
      isTurnActive: false,
    });

    expect(result.tail).toEqual([
      firstUser,
      toolCall("1", { type: "shell", command: "one" }),
      firstReply,
      secondUser,
      secondReply,
    ]);
    expect(result.summariesByAnchorItemId.has("a1")).toBe(true);
    expect(result.summariesByAnchorItemId.has("a2")).toBe(true);
  });

  it("leaves a response without an assistant message untouched", () => {
    const user = userMessage("u1");
    const read = toolCall("1", { type: "read", filePath: "/repo/a.ts" });
    const tail = [user, read];

    const result = collapseCompletedTurns({
      tail,
      enabled: true,
      expandedAnchorItemIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });

    expect(result.tail).toBe(tail);
    expect(result.summariesByAnchorItemId.size).toBe(0);
  });

  it("merges edits to the same path and sums diff stats in first-seen order", () => {
    const user = userMessage("u1");
    const first = toolCall("1", {
      type: "edit",
      filePath: "/repo/a.ts",
      oldString: "a\n",
      newString: "a\nb\n",
    });
    const other = toolCall("2", {
      type: "write",
      filePath: "/repo/b.ts",
      content: "one\ntwo",
    });
    const second = toolCall("3", {
      type: "edit",
      filePath: "/repo/a.ts",
      oldString: "a\nb\n",
      newString: "a\nb\nc\n",
    });
    const reply = assistant("a1");

    const result = collapseCompletedTurns({
      tail: [user, first, other, second, reply],
      enabled: true,
      expandedAnchorItemIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });

    const files = result.summariesByAnchorItemId.get("a1")?.files;
    expect(files?.map((file) => file.path)).toEqual(["/repo/a.ts", "/repo/b.ts"]);
    expect(files?.[0]).toMatchObject({
      path: "/repo/a.ts",
      additions: 2,
      deletions: 0,
    });
    expect(files?.[1]).toMatchObject({
      path: "/repo/b.ts",
      additions: 2,
      deletions: 0,
    });
  });

  it("counts unique edited paths and every shell call", () => {
    const user = userMessage("u1");
    const reply = assistant("a1");
    const result = collapseCompletedTurns({
      tail: [
        user,
        toolCall("1", { type: "edit", filePath: "/repo/a.ts" }),
        toolCall("2", { type: "write", filePath: "/repo/a.ts", content: "x" }),
        toolCall("3", { type: "edit", filePath: "/repo/b.ts" }),
        toolCall("4", { type: "shell", command: "one" }),
        toolCall("5", { type: "shell", command: "two" }),
        reply,
      ],
      enabled: true,
      expandedAnchorItemIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });

    expect(result.summariesByAnchorItemId.get("a1")).toMatchObject({
      editedFileCount: 2,
      commandCount: 2,
    });
  });

  it("dedupes fetch and search web cards by url and parses hostnames", () => {
    const user = userMessage("u1");
    const reply = assistant("a1");
    const result = collapseCompletedTurns({
      tail: [
        user,
        toolCall("1", { type: "fetch", url: "https://paseo.sh/docs" }),
        toolCall("2", {
          type: "search",
          query: "paseo",
          webResults: [
            { title: "Docs", url: "https://paseo.sh/docs" },
            { title: "Blog", url: "https://example.com/post" },
          ],
        }),
        reply,
      ],
      enabled: true,
      expandedAnchorItemIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });

    expect(result.summariesByAnchorItemId.get("a1")?.webPages).toEqual([
      {
        url: "https://paseo.sh/docs",
        title: "https://paseo.sh/docs",
        hostname: "paseo.sh",
      },
      {
        url: "https://example.com/post",
        title: "Blog",
        hostname: "example.com",
      },
    ]);
  });

  it("keys summaries by the final assistant item id", () => {
    const user = userMessage("u1");
    const mid = assistant("a-mid");
    const final = assistant("a-final");
    const result = collapseCompletedTurns({
      tail: [user, toolCall("1", { type: "shell", command: "ls" }), mid, final],
      enabled: true,
      expandedAnchorItemIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });

    expect([...result.summariesByAnchorItemId.keys()]).toEqual(["a-final"]);
    expect(result.summariesByAnchorItemId.has("a-mid")).toBe(false);
  });

  it("keeps consecutive user messages that belong to the same response", () => {
    const first = userMessage("u1", "turn-1");
    const second = userMessage("u2", "turn-1");
    const reply = assistant("a1");
    const result = collapseCompletedTurns({
      tail: [first, second, thought("th1"), toolCall("1", { type: "shell", command: "ls" }), reply],
      enabled: true,
      expandedAnchorItemIds: EMPTY_EXPANDED,
      isTurnActive: false,
    });

    expect(result.tail).toEqual([first, second, reply]);
  });
});
