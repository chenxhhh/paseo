import type { Agent } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "./sidebar-agent-state";

/**
 * One root agent worth showing under a workspace row: the sidebar's status dot already
 * summarizes a workspace whose only agent is quiet, so a row earns its place by doing
 * something — running, blocked, or asking.
 */
export interface WorkspaceAgentRowSummary {
  agentId: string;
  /** The agent's own title, when it has one; null renders the fallback label. */
  title: string | null;
  bucket: SidebarStateBucket;
  activityAt: Date;
}

export type WorkspaceAgentRowsIndex = ReadonlyMap<string, readonly WorkspaceAgentRowSummary[]>;

export function buildWorkspaceAgentRowsIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: WorkspaceAgentRowsIndex,
): WorkspaceAgentRowsIndex {
  const rowsByWorkspaceId = new Map<string, WorkspaceAgentRowSummary[]>();

  for (const agent of agents.values()) {
    const parentAgent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (agent.archivedAt || !agent.workspaceId || !isWorkspaceRootAgent(agent, parentAgent)) {
      continue;
    }

    const bucket = deriveSidebarStateBucket({
      status: agent.status,
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    });
    if (bucket === "done") {
      continue;
    }

    let rows = rowsByWorkspaceId.get(agent.workspaceId);
    if (!rows) {
      rows = [];
      rowsByWorkspaceId.set(agent.workspaceId, rows);
    }
    rows.push({
      agentId: agent.id,
      title: agent.title,
      bucket,
      activityAt: agent.attentionTimestamp ?? agent.updatedAt,
    });
  }

  for (const rows of rowsByWorkspaceId.values()) {
    rows.sort((a, b) => b.activityAt.getTime() - a.activityAt.getTime());
  }

  // Preserve object identity per workspace when nothing the row shows changed, so the
  // sidebar's equality-preserving entry pipeline does not re-render every row because
  // an unrelated agent on the host pinged.
  if (previous) {
    for (const [workspaceId, rows] of rowsByWorkspaceId) {
      const previousRows = previous.get(workspaceId);
      if (previousRows && areAgentRowSummariesEqual(previousRows, rows)) {
        rowsByWorkspaceId.set(workspaceId, previousRows as WorkspaceAgentRowSummary[]);
      }
    }
    if (areAgentRowsIndexesIdentical(previous, rowsByWorkspaceId)) {
      return previous;
    }
  }
  return rowsByWorkspaceId;
}

function areAgentRowSummariesEqual(
  left: readonly WorkspaceAgentRowSummary[],
  right: readonly WorkspaceAgentRowSummary[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) return false;
    if (
      a.agentId !== b.agentId ||
      a.title !== b.title ||
      a.bucket !== b.bucket ||
      a.activityAt.getTime() !== b.activityAt.getTime()
    ) {
      return false;
    }
  }
  return true;
}

function areAgentRowsIndexesIdentical(
  previous: WorkspaceAgentRowsIndex,
  next: Map<string, readonly WorkspaceAgentRowSummary[]>,
): boolean {
  if (previous.size !== next.size) {
    return false;
  }
  for (const [workspaceId, rows] of next) {
    if (previous.get(workspaceId) !== rows) {
      return false;
    }
  }
  return true;
}
