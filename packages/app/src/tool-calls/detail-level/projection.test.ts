import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type PreparedToolCallHistory,
  type ToolCallDetailLevel,
} from "./projection";

type AssistantMessageItem = Extract<StreamItem, { kind: "assistant_message" }>;

function toolCall(
  id: string,
  detail: ToolCallDetail,
  options: {
    name?: string;
    status?: "running" | "completed" | "failed" | "canceled";
  } = {},
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
        name: options.name ?? detail.type,
        status: options.status ?? "completed",
        error: options.status === "failed" ? "boom" : null,
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

function project(input: {
  level: ToolCallDetailLevel;
  tail?: StreamItem[];
  head?: StreamItem[];
  isTurnActive?: boolean;
  preparedHistory?: PreparedToolCallHistory | null;
}) {
  const tail = input.tail ?? [];
  return projectToolCallDetailLevel({
    level: input.level,
    tail,
    head: input.head ?? [],
    preparedHistory: input.preparedHistory ?? prepareToolCallHistory(input.level, tail),
    isTurnActive: input.isTurnActive ?? false,
  });
}

describe("tool call detail-level projection", () => {
  it("passes detailed timelines through without grouping work", () => {
    const tail = [toolCall("1", { type: "shell", command: "one" })];
    const head = [toolCall("2", { type: "shell", command: "two" })];

    const prepared = prepareToolCallHistory("detailed", tail);
    const result = project({ level: "detailed", tail, head, preparedHistory: prepared });

    expect(prepared).toBeNull();
    expect(result.tail).toBe(tail);
    expect(result.head).toBe(head);
    expect(result.groupsByHostId.size).toBe(0);
  });

  it("keeps one stable overview host as a run grows", () => {
    const firstCall = toolCall("1", { type: "shell", command: "one" });
    const secondCall = toolCall("2", { type: "read", filePath: "/repo/a.ts" });
    const prepared = prepareToolCallHistory("overview", []);

    const single = project({
      level: "overview",
      head: [firstCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(single.head).toEqual([firstCall]);
    expect(single.groupsByHostId.get(firstCall.id)?.run).toMatchObject({
      calls: [firstCall],
      latest: firstCall,
      isSealed: false,
    });

    const grouped = project({
      level: "overview",
      head: [firstCall, secondCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(grouped.head).toEqual([
      expect.objectContaining({ id: firstCall.id, timestamp: secondCall.timestamp }),
    ]);
    expect(grouped.groupsByHostId.get(firstCall.id)?.run).toMatchObject({
      calls: [firstCall, secondCall],
      latest: secondCall,
      isSealed: false,
    });
  });

  it("keeps a parallel group loading while any call is still running", () => {
    const calls = [
      toolCall("1", { type: "shell", command: "slow" }, { status: "running" }),
      toolCall("2", { type: "shell", command: "done" }),
    ];
    const result = project({ level: "overview", head: calls, isTurnActive: true });

    expect(result.groupsByHostId.get("1")?.isLoading).toBe(true);
  });

  it("builds a loading aggregate for a one-call run", () => {
    const call = toolCall("1", { type: "shell", command: "one" }, { status: "running" });
    const result = project({ level: "overview", head: [call], isTurnActive: true });
    const group = result.groupsByHostId.get(call.id);
    if (!group) {
      throw new Error("Expected an overview group");
    }

    expect(group).toMatchObject({
      isLoading: true,
      summary: { commandCount: 1 },
    });
  });

  it("keeps an active overview group on its latest call until a visible boundary arrives", () => {
    const calls = [
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "read", filePath: "/repo/a.ts" }),
      toolCall("3", { type: "read", filePath: "/repo/b.ts" }),
      toolCall("4", { type: "edit", filePath: "/repo/a.ts" }),
    ];
    const prepared = prepareToolCallHistory("overview", []);
    const active = project({
      level: "overview",
      head: calls,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const activeGroup = active.groupsByHostId.get("1");

    expect(activeGroup).toMatchObject({
      mode: "overview",
      run: { id: "1", latest: calls[3], isSealed: false },
    });
    const boundary = assistant("answer");
    const sealed = project({
      level: "overview",
      head: [...calls, boundary],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(sealed.groupsByHostId.get("1")).toMatchObject({
      mode: "overview",
      run: { latest: calls[3], isSealed: true },
      summary: { editedFileCount: 1, readFileCount: 2, commandCount: 1 },
    });
  });

  it("keeps a running overview group live before the agent lifecycle catches up", () => {
    const calls = ["1", "2", "3", "4"].map((id) =>
      toolCall(id, { type: "shell", command: id }, { status: "running" }),
    );

    const result = project({
      level: "overview",
      tail: calls,
      isTurnActive: false,
    });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      run: { latest: calls[3], isSealed: false },
      isLoading: true,
      summary: { commandCount: 4 },
    });
  });

  it("seals the trailing overview group only when the turn ends", () => {
    const calls = ["1", "2", "3", "4"].map((id) => toolCall(id, { type: "shell", command: id }));
    const prepared = prepareToolCallHistory("overview", []);

    const betweenCalls = project({
      level: "overview",
      head: calls,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const nextCall = toolCall("5", { type: "read", filePath: "/repo/a.ts" });
    const continued = project({
      level: "overview",
      head: [...calls, nextCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const ended = project({
      level: "overview",
      head: [...calls, nextCall],
      isTurnActive: false,
      preparedHistory: prepared,
    });

    expect(betweenCalls.groupsByHostId.get("1")?.run.isSealed).toBe(false);
    expect(continued.groupsByHostId.get("1")?.run).toMatchObject({
      latest: nextCall,
      isSealed: false,
    });
    expect(ended.groupsByHostId.get("1")?.run.isSealed).toBe(true);
  });

  it("builds overview summaries without category-specific presentation data", () => {
    const calls = [
      toolCall("1", { type: "read", filePath: "/repo/src/a.ts" }),
      toolCall("2", { type: "read", filePath: "/repo/src/b.ts" }),
      toolCall("3", { type: "shell", command: "npm test" }),
      toolCall("4", { type: "edit", filePath: "/repo/src/a.ts" }, { status: "failed" }),
    ];

    const overview = project({ level: "overview", head: calls });

    expect(overview.groupsByHostId.get("1")).toEqual({
      mode: "overview",
      run: expect.any(Object),
      isLoading: false,
      summary: {
        editedFileCount: 1,
        commandCount: 1,
        readFileCount: 2,
        searchCount: 0,
        otherToolCount: 0,
        paseoCallCount: 0,
      },
    });
  });

  it("distinguishes reads, searches, and other tools in overview", () => {
    const calls = [
      toolCall("1", { type: "read", filePath: "/repo/src/a.ts" }),
      toolCall("2", { type: "read", filePath: "C:\\repo\\src\\beta.ts" }),
      toolCall("3", { type: "fetch", url: "https://github.com/org/repo" }),
      toolCall(
        "4",
        { type: "search", query: "paseo", toolName: "web_search" },
        { status: "failed" },
      ),
      toolCall("5", { type: "fetch", url: "not a url" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: {
        editedFileCount: 0,
        commandCount: 0,
        readFileCount: 2,
        searchCount: 1,
        otherToolCount: 2,
      },
    });
  });

  it("counts unique edited files and every shell command in overview", () => {
    const calls = [
      toolCall("1", { type: "edit", filePath: "/repo/a.ts" }),
      toolCall("2", { type: "edit", filePath: "/repo/a.ts" }),
      toolCall("3", { type: "write", filePath: "/repo/b.ts" }),
      toolCall("4", { type: "shell", command: "npm test" }),
      toolCall("5", { type: "shell", command: "npm run lint" }),
      toolCall("6", { type: "read", filePath: "/repo/c.ts" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: {
        editedFileCount: 2,
        commandCount: 2,
        readFileCount: 1,
        otherToolCount: 0,
      },
    });
  });

  it("counts Paseo calls separately from other tools", () => {
    const calls = [
      toolCall("1", { type: "unknown", input: null, output: null }, { name: "paseo.list_agents" }),
      toolCall(
        "2",
        { type: "unknown", input: null, output: null },
        { name: "mcp__paseo__list_worktrees" },
      ),
      toolCall("3", { type: "fetch", url: "https://paseo.sh" }),
      toolCall("4", { type: "fetch", url: "https://github.com/getpaseo" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: { otherToolCount: 2, paseoCallCount: 2 },
    });
  });

  it("classifies direct Brave search and Paseo runtime tool names", () => {
    const unknownDetail = { type: "unknown" as const, input: null, output: null };
    const calls = [
      toolCall("1", unknownDetail, { name: "brave-search_brave_web_search" }),
      toolCall("2", unknownDetail, { name: "brave-search_brave_llm_context" }),
      toolCall("3", unknownDetail, { name: "paseo_list_providers" }),
      toolCall("4", unknownDetail, { name: "paseo_list_worktrees" }),
      toolCall("5", unknownDetail, { name: "paseo_list_worktrees" }),
      toolCall("6", unknownDetail, { name: "mcp__exa__web_search" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: { searchCount: 3, otherToolCount: 0, paseoCallCount: 3 },
    });
  });

  it("reuses prepared history and sealed group models across live-head updates", () => {
    const historicalCalls = ["1", "2", "3", "4"].map((id) =>
      toolCall(id, { type: "shell", command: id }),
    );
    const tail = [...historicalCalls, assistant("boundary")];
    const prepared = prepareToolCallHistory("overview", tail);
    if (!prepared) {
      throw new Error("Overview history must be prepared");
    }
    expect(prepared.grouped.tail).toEqual([
      expect.objectContaining({ id: "1", timestamp: historicalCalls[3]?.timestamp }),
      tail[4],
    ]);
    const first = project({
      level: "overview",
      tail,
      head: [toolCall("5", { type: "read", filePath: "/repo/a.ts" })],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const second = project({
      level: "overview",
      tail,
      head: [
        toolCall("5", { type: "read", filePath: "/repo/a.ts" }),
        toolCall("6", { type: "read", filePath: "/repo/b.ts" }),
      ],
      isTurnActive: true,
      preparedHistory: prepared,
    });

    expect(first.tail).toBe(prepared.grouped.tail);
    expect(second.tail).toBe(prepared.grouped.tail);
    expect(first.groupsByHostId.get("1")).toBe(prepared.grouped.groupsByHostId.get("1"));
    expect(second.groupsByHostId.get("1")).toBe(prepared.grouped.groupsByHostId.get("1"));
    expect(first.historyGroupUpdatesByHostId.size).toBe(0);
    expect(second.historyGroupUpdatesByHostId).toBe(first.historyGroupUpdatesByHostId);
    expect(second.groupsByHostId.get("5")?.run.calls).toHaveLength(2);
  });

  it("preserves projected history identity during assistant-only head updates", () => {
    const trailingCalls = [
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "read", filePath: "/repo/a.ts" }),
    ];
    const tail = [assistant("before"), ...trailingCalls];
    const prepared = prepareToolCallHistory("overview", tail);
    if (!prepared) {
      throw new Error("Overview history must be prepared");
    }

    const firstHead = [assistant("answer")];
    const secondHead = [{ ...firstHead[0], text: "answer grows" }];
    const first = project({
      level: "overview",
      tail,
      head: firstHead,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const second = project({
      level: "overview",
      tail,
      head: secondHead,
      isTurnActive: true,
      preparedHistory: prepared,
    });

    expect(first.tail).toBe(prepared.grouped.tail);
    expect(second.tail).toBe(prepared.grouped.tail);
    expect(first.groupsByHostId).toBe(prepared.grouped.groupsByHostId);
    expect(second.groupsByHostId).toBe(prepared.grouped.groupsByHostId);
    expect(first.historyGroupUpdatesByHostId.size).toBe(0);
    expect(second.historyGroupUpdatesByHostId).toBe(first.historyGroupUpdatesByHostId);
  });

  it("forms one group across the retained-history and live-head boundary", () => {
    const tail = [
      assistant("before"),
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "shell", command: "two" }),
    ];
    const head = [
      toolCall("3", { type: "read", filePath: "/repo/a.ts" }),
      toolCall("4", { type: "edit", filePath: "/repo/a.ts" }, { status: "running" }),
    ];

    const result = project({ level: "overview", tail, head, isTurnActive: true });

    expect(result.tail).toEqual([
      tail[0],
      expect.objectContaining({ id: "1", timestamp: tail[2]?.timestamp }),
    ]);
    expect(result.head).toEqual([]);
    expect(result.groupsByHostId.get("1")?.run).toMatchObject({
      calls: [...tail.slice(1), ...head],
      latest: head[1],
      isSealed: false,
    });
    expect(result.historyGroupUpdatesByHostId.get("1")).toBe(result.groupsByHostId.get("1"));
  });

  it("keeps a trailing history-only group in the retained segment", () => {
    const tail = ["1", "2", "3", "4"].map((id) => toolCall(id, { type: "shell", command: id }));

    const result = project({ level: "overview", tail, isTurnActive: false });

    expect(result.tail).toEqual([
      expect.objectContaining({ id: "1", timestamp: tail[3]?.timestamp }),
    ]);
    expect(result.head).toEqual([]);
    expect(result.groupsByHostId.get("1")?.run.isSealed).toBe(true);
  });

  it("hosts single calls while leaving plans and spoken messages ungrouped", () => {
    const singleCall = toolCall("1", { type: "shell", command: "one" });
    const plan = toolCall("2", { type: "plan", text: "Plan" });
    const speak = toolCall(
      "3",
      { type: "unknown", input: "Hello", output: null },
      { name: "speak" },
    );

    const result = project({ level: "overview", head: [singleCall, plan, speak] });

    expect(result.head).toEqual([singleCall, plan, speak]);
    expect(result.groupsByHostId.get(singleCall.id)?.run.calls).toEqual([singleCall]);
    expect(result.groupsByHostId.size).toBe(1);
  });
});

describe("balanced tool call detail level", () => {
  it("splits a mixed tail run into noise groups and signal pass-throughs", () => {
    const readA = toolCall("1", { type: "read", filePath: "/repo/a.ts" });
    const readB = toolCall("2", { type: "read", filePath: "/repo/b.ts" });
    const edit = toolCall("3", { type: "edit", filePath: "/repo/a.ts" });
    const shell = toolCall("4", { type: "shell", command: "npm test" });
    const search = toolCall("5", { type: "search", query: "paseo" });
    const tail = [readA, readB, edit, shell, search, assistant("boundary")];

    const prepared = prepareToolCallHistory("auto", tail);
    if (!prepared) {
      throw new Error("Balanced history must be prepared");
    }

    // tail hosts: read-a host (grouped), edit + shell pass through, search host (grouped)
    expect(prepared.grouped.tail).toEqual([
      expect.objectContaining({ id: "1" }),
      edit,
      shell,
      expect.objectContaining({ id: "5" }),
      tail[5],
    ]);
    expect(prepared.grouped.groupsByHostId.get("1")).toMatchObject({
      mode: "balanced",
      summary: { readFileCount: 2, searchCount: 0, otherToolCount: 0 },
    });
    expect(prepared.grouped.groupsByHostId.get("5")).toMatchObject({
      mode: "balanced",
      summary: { readFileCount: 0, searchCount: 1 },
    });
    expect(prepared.grouped.groupsByHostId.has("3")).toBe(false);
    expect(prepared.grouped.groupsByHostId.has("4")).toBe(false);
  });

  it("counts unique read paths across a noise segment", () => {
    const tail = [
      toolCall("1", { type: "read", filePath: "/repo/a.ts" }),
      toolCall("2", { type: "read", filePath: "/repo/a.ts" }),
      toolCall("3", { type: "read", filePath: "/repo/b.ts" }),
      assistant("boundary"),
    ];

    const prepared = prepareToolCallHistory("auto", tail);
    if (!prepared) {
      throw new Error("Balanced history must be prepared");
    }

    expect(prepared.grouped.groupsByHostId.get("1")).toMatchObject({
      summary: { readFileCount: 2 },
    });
  });

  it("passes thinking tool calls through as signal rows", () => {
    const read = toolCall("1", { type: "read", filePath: "/repo/a.ts" });
    const thinking = toolCall(
      "2",
      { type: "unknown", input: null, output: null },
      { name: "thinking" },
    );
    const tail = [read, thinking, assistant("boundary")];

    const prepared = prepareToolCallHistory("auto", tail);
    if (!prepared) {
      throw new Error("Balanced history must be prepared");
    }

    expect(prepared.grouped.tail).toEqual([
      expect.objectContaining({ id: "1" }),
      thinking,
      tail[2],
    ]);
    expect(prepared.grouped.groupsByHostId.has("2")).toBe(false);
    expect(prepared.grouped.pendingCalls).toEqual([]);
  });

  it("grows a live noise segment and updates the retained history host", () => {
    const read1 = toolCall("1", { type: "read", filePath: "/repo/a.ts" });
    const tail = [read1];
    const prepared = prepareToolCallHistory("auto", tail);
    if (!prepared) {
      throw new Error("Balanced history must be prepared");
    }

    const read2 = toolCall("2", { type: "read", filePath: "/repo/b.ts" });
    const grown = project({
      level: "auto",
      tail,
      head: [read2],
      isTurnActive: true,
      preparedHistory: prepared,
    });

    expect(grown.tail).toEqual([expect.objectContaining({ id: "1" })]);
    expect(grown.head).toEqual([]);
    expect(grown.historyGroupUpdatesByHostId.get("1")).toMatchObject({
      summary: { readFileCount: 2 },
    });

    const edit3 = toolCall("3", { type: "edit", filePath: "/repo/a.ts" });
    const extended = project({
      level: "auto",
      tail,
      head: [read2, edit3],
      isTurnActive: true,
      preparedHistory: prepared,
    });

    expect(extended.head).toEqual([edit3]);
    expect(extended.groupsByHostId.get("1")).toMatchObject({
      summary: { readFileCount: 2 },
    });
  });

  it("keeps segmentation host ids stable as the head run grows", () => {
    const read1 = toolCall("1", { type: "read", filePath: "/repo/a.ts" });
    const edit2 = toolCall("2", { type: "edit", filePath: "/repo/a.ts" });
    const prepared = prepareToolCallHistory("auto", []);

    const first = project({
      level: "auto",
      head: [read1, edit2],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const read3 = toolCall("3", { type: "read", filePath: "/repo/b.ts" });
    const second = project({
      level: "auto",
      head: [read1, edit2, read3],
      isTurnActive: true,
      preparedHistory: prepared,
    });

    expect(first.groupsByHostId.get("1")).toMatchObject({
      summary: { readFileCount: 1 },
    });
    expect(second.groupsByHostId.get("1")).toMatchObject({
      summary: { readFileCount: 1 },
    });
    expect(second.groupsByHostId.get("3")).toMatchObject({
      summary: { readFileCount: 1 },
    });
  });

  it("keeps a trailing noise segment unsealed while a call runs", () => {
    const read1 = toolCall("1", { type: "read", filePath: "/repo/a.ts" }, { status: "running" });
    const prepared = prepareToolCallHistory("auto", []);

    const active = project({
      level: "auto",
      head: [read1],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(active.groupsByHostId.get("1")).toMatchObject({
      mode: "balanced",
      run: { isSealed: false },
      isLoading: true,
    });

    const runningIdle = project({
      level: "auto",
      head: [read1],
      isTurnActive: false,
      preparedHistory: prepared,
    });
    expect(runningIdle.groupsByHostId.get("1")).toMatchObject({
      run: { isSealed: false },
    });
  });

  it("seals an idle trailing noise segment with only completed calls", () => {
    const read1 = toolCall("1", { type: "read", filePath: "/repo/a.ts" });
    const prepared = prepareToolCallHistory("auto", []);

    const idle = project({
      level: "auto",
      head: [read1],
      isTurnActive: false,
      preparedHistory: prepared,
    });
    expect(idle.groupsByHostId.get("1")).toMatchObject({
      run: { isSealed: true },
    });
  });

  it("counts fetch calls into fetchCount, not otherToolCount", () => {
    const fetch = toolCall("1", { type: "fetch", url: "https://paseo.sh" });
    const shell = toolCall("2", { type: "shell", command: "npm test" });
    const result = project({ level: "auto", head: [fetch, shell] });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      summary: { fetchCount: 1, otherToolCount: 0 },
    });
  });
});

describe("auto tool call detail level routing", () => {
  it("prepares history with balanced mode and projects without throwing", () => {
    const tail = [toolCall("1", { type: "read", filePath: "/repo/a.ts" }), assistant("boundary")];
    const prepared = prepareToolCallHistory("auto", tail);
    expect(prepared?.mode).toBe("balanced");

    expect(() => project({ level: "auto", tail, preparedHistory: prepared })).not.toThrow();
    const result = project({ level: "auto", tail, preparedHistory: prepared });
    expect(result.groupsByHostId.get("1")).toMatchObject({ mode: "balanced" });
  });
});
