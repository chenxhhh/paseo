import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { getWorkspaceUserStatus, type WorkspaceStatusDefinition } from "@/utils/workspace-statuses";
import type { BoardColumnGroup } from "./board-canvas.shared";

/**
 * The board's query and grouping rules, kept out of the screen so they can be
 * tested without a host runtime.
 *
 * Search is deliberately a plain substring match: the board holds every visible
 * workspace at once, and a ranked match (the command center's job) would make
 * cards jump between lanes while typing.
 */

/** Namespaces a sub-group's key so it can never collide with a lane key. */
const GROUP_KEY_PREFIX = "status-group:";

function searchFields(workspace: SidebarWorkspaceEntry): string[] {
  return [
    workspace.title ?? "",
    workspace.name,
    workspace.projectName,
    workspace.currentBranch ?? "",
    workspace.workspaceDirectoryLabel,
    ...(workspace.labels ?? []),
  ];
}

function matchesQuery(workspace: SidebarWorkspaceEntry, normalizedQuery: string): boolean {
  return searchFields(workspace).some((field) => field.toLowerCase().includes(normalizedQuery));
}

/** Empty or whitespace-only queries match everything, so the board never blanks out mid-typing. */
export function filterBoardWorkspaces(
  workspaces: readonly SidebarWorkspaceEntry[],
  query: string,
): SidebarWorkspaceEntry[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return workspaces as SidebarWorkspaceEntry[];
  }
  return workspaces.filter((workspace) => matchesQuery(workspace, normalized));
}

export interface BoardProjectGroup {
  key: string;
  label: string;
  workspaces: SidebarWorkspaceEntry[];
}

/**
 * Buckets workspaces into one group per project. `projectOrder` only decides
 * column order — projects absent from it fall to the end, and an empty project
 * never earns a column, which is what keeps a long project list from turning
 * into a long row of empty lanes.
 */
export function groupWorkspacesByProject(
  workspaces: readonly SidebarWorkspaceEntry[],
  projectOrder: readonly string[] = [],
): BoardProjectGroup[] {
  const buckets = new Map<string, SidebarWorkspaceEntry[]>();
  for (const workspace of workspaces) {
    const bucket = buckets.get(workspace.projectViewKey);
    if (bucket) {
      bucket.push(workspace);
    } else {
      buckets.set(workspace.projectViewKey, [workspace]);
    }
  }

  const rank = new Map(projectOrder.map((key, index) => [key, index]));
  const keys = [...buckets.keys()].sort((left, right) => {
    const leftRank = rank.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });

  return keys.map((key) => {
    const groupWorkspaces = buckets.get(key) ?? [];
    return {
      key,
      label: groupWorkspaces[0]?.projectName ?? key,
      workspaces: groupWorkspaces,
    };
  });
}

/**
 * Splits one project lane's cards into sections by their user status.
 *
 * The order follows the status catalog, not the cards, so the sections read the
 * same way in every project lane. Statuses with no cards here are dropped —
 * a project lane is already narrow, and empty headers would push the cards the
 * user came for below the fold.
 */
export function groupWorkspacesByStatus(
  workspaces: readonly SidebarWorkspaceEntry[],
  statuses: readonly WorkspaceStatusDefinition[],
): BoardColumnGroup[] {
  const buckets = new Map<string, SidebarWorkspaceEntry[]>(
    statuses.map((status) => [status.id, []]),
  );
  for (const workspace of workspaces) {
    const statusId = getWorkspaceUserStatus({ userStatus: workspace.userStatus, statuses });
    buckets.get(statusId)?.push(workspace);
  }

  const groups: BoardColumnGroup[] = [];
  for (const status of statuses) {
    const groupWorkspaces = buckets.get(status.id) ?? [];
    if (groupWorkspaces.length === 0) continue;
    groups.push({
      key: `${GROUP_KEY_PREFIX}${status.id}`,
      label: status.label,
      status,
      workspaces: groupWorkspaces,
    });
  }
  return groups;
}
