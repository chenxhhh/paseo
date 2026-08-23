import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { buildWorkspaceAgentRowsIndex } from "./workspace-agent-rows";

function agent(input: {
  id: string;
  workspaceId?: string;
  status?: Agent["status"];
  updatedAt: string;
  title?: string | null;
  attentionTimestamp?: string | null;
  requiresAttention?: boolean;
  attentionReason?: Agent["attentionReason"];
  pendingPermissionCount?: number;
  archivedAt?: string | null;
  parentAgentId?: string | null;
}): Agent {
  return {
    serverId: "host-a",
    id: input.id,
    provider: "codex",
    status: input.status ?? "idle",
    activeTurn: input.status === "running" ? { turnId: "turn-1", startedAt: null } : null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date(input.updatedAt),
    lastUserMessageAt: null,
    lastActivityAt: new Date(input.updatedAt),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: Array.from({ length: input.pendingPermissionCount ?? 0 }, (_, index) => ({
      id: `permission-${index}`,
      provider: "codex",
      name: "shell",
      kind: "tool",
      input: {},
    })),
    persistence: null,
    title: input.title ?? null,
    cwd: "/repo",
    workspaceId: input.workspaceId,
    model: null,
    requiresAttention: input.requiresAttention,
    attentionReason: input.attentionReason,
    attentionTimestamp: input.attentionTimestamp ? new Date(input.attentionTimestamp) : null,
    archivedAt: input.archivedAt ? new Date(input.archivedAt) : null,
    parentAgentId: input.parentAgentId ?? null,
    labels: {},
  };
}

describe("workspace agent rows index", () => {
  it("keeps only busy root agents and sorts by recency", () => {
    const index = buildWorkspaceAgentRowsIndex(
      new Map([
        [
          "older",
          agent({
            id: "older",
            workspaceId: "ws-1",
            status: "running",
            title: "Refactor parser",
            updatedAt: "2026-05-01T10:00:00.000Z",
          }),
        ],
        [
          "newer",
          agent({
            id: "newer",
            workspaceId: "ws-1",
            status: "running",
            title: "Fix flaky test",
            updatedAt: "2026-05-01T12:00:00.000Z",
          }),
        ],
        [
          "quiet",
          agent({
            id: "quiet",
            workspaceId: "ws-1",
            status: "idle",
            updatedAt: "2026-05-01T13:00:00.000Z",
          }),
        ],
        [
          "archived",
          agent({
            id: "archived",
            workspaceId: "ws-1",
            status: "running",
            updatedAt: "2026-05-01T14:00:00.000Z",
            archivedAt: "2026-05-01T14:01:00.000Z",
          }),
        ],
        [
          "sub",
          agent({
            id: "sub",
            workspaceId: "ws-1",
            status: "running",
            updatedAt: "2026-05-01T15:00:00.000Z",
            parentAgentId: "newer",
          }),
        ],
      ]),
    );

    expect(index.get("ws-1")?.map((row) => row.agentId)).toEqual(["newer", "older"]);
    expect(index.get("ws-1")?.[0]).toMatchObject({
      title: "Fix flaky test",
      bucket: "running",
    });
  });

  it("maps permission requests to needs_input", () => {
    const index = buildWorkspaceAgentRowsIndex(
      new Map([
        [
          "blocked",
          agent({
            id: "blocked",
            workspaceId: "ws-1",
            status: "running",
            pendingPermissionCount: 1,
            updatedAt: "2026-05-01T10:00:00.000Z",
          }),
        ],
      ]),
    );
    expect(index.get("ws-1")?.[0]?.bucket).toBe("needs_input");
  });

  it("preserves row identity when nothing shown changed", () => {
    const agents = new Map([
      [
        "a",
        agent({
          id: "a",
          workspaceId: "ws-1",
          status: "running",
          updatedAt: "2026-05-01T10:00:00.000Z",
        }),
      ],
    ]);
    const first = buildWorkspaceAgentRowsIndex(agents);
    const second = buildWorkspaceAgentRowsIndex(agents, first);
    expect(second).toBe(first);
    expect(second.get("ws-1")).toBe(first.get("ws-1"));
  });

  it("replaces rows when a title changes", () => {
    const first = buildWorkspaceAgentRowsIndex(
      new Map([
        [
          "a",
          agent({
            id: "a",
            workspaceId: "ws-1",
            status: "running",
            title: "Before",
            updatedAt: "2026-05-01T10:00:00.000Z",
          }),
        ],
      ]),
    );
    const second = buildWorkspaceAgentRowsIndex(
      new Map([
        [
          "a",
          agent({
            id: "a",
            workspaceId: "ws-1",
            status: "running",
            title: "After",
            updatedAt: "2026-05-01T10:00:00.000Z",
          }),
        ],
      ]),
      first,
    );
    expect(second.get("ws-1")?.[0]?.title).toBe("After");
  });
});
