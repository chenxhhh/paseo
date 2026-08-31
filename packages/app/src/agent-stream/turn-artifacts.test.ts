import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { createUserMessage, type AgentToolCallStatus } from "@/types/stream";
import type { StreamItem, ToolCallItem, UserMessageItem } from "@/types/stream";
import { deriveTurnArtifactsSummary, isTurnArtifactExtension } from "./turn-artifacts";

const arrayNeighbor = (index: number, relation: "above" | "below"): number =>
  relation === "above" ? index - 1 : index + 1;

function toolCallItem(input: {
  id: string;
  detail: ToolCallDetail;
  status?: AgentToolCallStatus;
  timestamp?: Date;
}): ToolCallItem {
  return {
    kind: "tool_call",
    id: input.id,
    timestamp: input.timestamp ?? new Date("2026-08-01T10:00:00.000Z"),
    payload: {
      source: "agent",
      data: {
        provider: "claude/opus",
        callId: input.id,
        name: "Write",
        status: input.status ?? "completed",
        error: null,
        detail: input.detail,
      },
    },
  };
}

function assistantItem(id: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    timestamp: new Date("2026-08-01T10:00:05.000Z"),
    text: "Done.",
  };
}

function userItem(id: string, messageId?: string): UserMessageItem {
  return createUserMessage({
    id,
    ...(messageId ? { messageId } : {}),
    text: "Write the report",
    timestamp: new Date("2026-08-01T09:59:00.000Z"),
  });
}

describe("isTurnArtifactExtension", () => {
  it("accepts document, image, media, and archive extensions", () => {
    expect(isTurnArtifactExtension("docx")).toBe(true);
    expect(isTurnArtifactExtension("pdf")).toBe(true);
    expect(isTurnArtifactExtension("png")).toBe(true);
    expect(isTurnArtifactExtension("xlsx")).toBe(true);
  });

  it("rejects code and config extensions", () => {
    expect(isTurnArtifactExtension("ts")).toBe(false);
    expect(isTurnArtifactExtension("md")).toBe(false);
    expect(isTurnArtifactExtension("json")).toBe(false);
    expect(isTurnArtifactExtension("")).toBe(false);
  });
});

describe("deriveTurnArtifactsSummary", () => {
  it("collects completed write artifacts with name and type label", () => {
    const items: StreamItem[] = [
      userItem("u1", "msg-1"),
      toolCallItem({
        id: "t1",
        detail: { type: "write", filePath: "reports/thesis.docx", content: "binary-ish" },
      }),
      assistantItem("a1"),
    ];

    const summary = deriveTurnArtifactsSummary({
      items,
      startIndex: items.length - 1,
      getNeighborIndex: arrayNeighbor,
    });

    expect(summary.artifacts).toHaveLength(1);
    expect(summary.artifacts[0]).toMatchObject({
      filePath: "reports/thesis.docx",
      fileName: "thesis.docx",
      typeLabel: "DOCX",
    });
    expect(summary.rewindTarget).toEqual({ messageId: "msg-1", promptText: "Write the report" });
  });

  it("sums write content and edit fragments into change stats", () => {
    const items: StreamItem[] = [
      userItem("u1", "msg-1"),
      toolCallItem({
        id: "t1",
        detail: { type: "write", filePath: "src/main.ts", content: "a\nb\nc\n" },
      }),
      toolCallItem({
        id: "t2",
        detail: {
          type: "edit",
          filePath: "src/main.ts",
          oldString: "b",
          newString: "b\nb2",
        },
      }),
      toolCallItem({
        id: "t3",
        detail: { type: "write", filePath: "docs/report.pdf", content: "%PDF" },
      }),
      assistantItem("a1"),
    ];

    const summary = deriveTurnArtifactsSummary({
      items,
      startIndex: items.length - 1,
      getNeighborIndex: arrayNeighbor,
    });

    expect(summary.stats).toEqual({ fileCount: 2, additions: 6, deletions: 1 });
    expect(summary.artifacts.map((artifact) => artifact.fileName)).toEqual(["report.pdf"]);
  });

  it("treats rewriting a file as additions plus deletions of the previous version", () => {
    const items: StreamItem[] = [
      userItem("u1"),
      toolCallItem({
        id: "t1",
        detail: { type: "write", filePath: "out/diagram.png", content: "x\ny\nz\nw\n" },
      }),
      toolCallItem({
        id: "t2",
        detail: { type: "write", filePath: "out/diagram.png", content: "x\n" },
      }),
      assistantItem("a1"),
    ];

    const summary = deriveTurnArtifactsSummary({
      items,
      startIndex: items.length - 1,
      getNeighborIndex: arrayNeighbor,
    });

    expect(summary.stats).toEqual({ fileCount: 1, additions: 5, deletions: 4 });
    expect(summary.artifacts).toHaveLength(1);
    expect(summary.rewindTarget).toBeNull();
  });

  it("parses unified diffs for edits without old/new strings", () => {
    const items: StreamItem[] = [
      userItem("u1"),
      toolCallItem({
        id: "t1",
        detail: {
          type: "edit",
          filePath: "src/main.ts",
          unifiedDiff: "--- a\n+++ b\n@@\n-old\n+new\n+new2\n context",
        },
      }),
      assistantItem("a1"),
    ];

    const summary = deriveTurnArtifactsSummary({
      items,
      startIndex: items.length - 1,
      getNeighborIndex: arrayNeighbor,
    });

    expect(summary.stats).toEqual({ fileCount: 1, additions: 2, deletions: 1 });
  });

  it("ignores failed and running tool calls and non-agent payloads", () => {
    const items: StreamItem[] = [
      userItem("u1"),
      toolCallItem({
        id: "t1",
        status: "failed",
        detail: { type: "write", filePath: "out/report.docx", content: "x" },
      }),
      toolCallItem({
        id: "t2",
        status: "running",
        detail: { type: "edit", filePath: "src/main.ts", oldString: "a", newString: "b" },
      }),
      assistantItem("a1"),
    ];

    const summary = deriveTurnArtifactsSummary({
      items,
      startIndex: items.length - 1,
      getNeighborIndex: arrayNeighbor,
    });

    expect(summary.artifacts).toHaveLength(0);
    expect(summary.stats).toBeNull();
  });

  it("keeps tool calls below the anchor assistant inside the same response", () => {
    const items: StreamItem[] = [
      userItem("u1", "msg-1"),
      assistantItem("a1"),
      toolCallItem({
        id: "t1",
        detail: { type: "write", filePath: "out/table.xlsx", content: "1,2\n" },
      }),
    ];

    const summary = deriveTurnArtifactsSummary({
      items,
      startIndex: 1,
      getNeighborIndex: arrayNeighbor,
    });

    expect(summary.artifacts.map((artifact) => artifact.fileName)).toEqual(["table.xlsx"]);
    expect(summary.stats).toEqual({ fileCount: 1, additions: 1, deletions: 0 });
  });

  it("stops the upward walk at the turn's user message", () => {
    const previousTurnWrite = toolCallItem({
      id: "t0",
      detail: { type: "write", filePath: "out/old.docx", content: "old" },
    });
    const items: StreamItem[] = [
      userItem("u0", "msg-0"),
      previousTurnWrite,
      assistantItem("a0"),
      userItem("u1", "msg-1"),
      toolCallItem({
        id: "t1",
        detail: { type: "write", filePath: "out/new.pdf", content: "new" },
      }),
      assistantItem("a1"),
    ];

    const summary = deriveTurnArtifactsSummary({
      items,
      startIndex: items.length - 1,
      getNeighborIndex: arrayNeighbor,
    });

    expect(summary.artifacts.map((artifact) => artifact.fileName)).toEqual(["new.pdf"]);
    expect(summary.stats).toEqual({ fileCount: 1, additions: 1, deletions: 0 });
    expect(summary.rewindTarget).toEqual({ messageId: "msg-1", promptText: "Write the report" });
  });

  it("returns no rewind target when the user message has no provider message id", () => {
    const items: StreamItem[] = [
      userItem("u1"),
      toolCallItem({
        id: "t1",
        detail: { type: "write", filePath: "out/a.pdf", content: "x" },
      }),
      assistantItem("a1"),
    ];

    const summary = deriveTurnArtifactsSummary({
      items,
      startIndex: items.length - 1,
      getNeighborIndex: arrayNeighbor,
    });

    expect(summary.rewindTarget).toBeNull();
    expect(summary.artifacts).toHaveLength(1);
  });
});
