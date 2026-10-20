import { getWorkspaceUserStatus, type WorkspaceStatusDefinition } from "@/utils/workspace-statuses";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";

export interface UserStatusGroup {
  statusId: string;
  label: string;
  color: WorkspaceStatusDefinition["color"];
  rows: SidebarWorkspaceEntry[];
}

/**
 * Groups workspaces into lanes by their user-assigned status, in catalog order.
 * Empty lanes are omitted (the board is the surface that shows the full lane
 * set); unassigned or stale-assigned workspaces resolve to the default lane so
 * nothing falls outside the grouping.
 */
export function buildUserStatusGroups(
  workspaces: SidebarWorkspaceEntry[],
  statuses: readonly WorkspaceStatusDefinition[],
  projectNamesByViewKey: Map<string, string>,
): UserStatusGroup[] {
  const rowsByStatusId = new Map<string, SidebarWorkspaceEntry[]>();

  for (const workspace of workspaces) {
    const statusId = getWorkspaceUserStatus({
      userStatus: workspace.userStatus,
      statuses,
    });
    let rows = rowsByStatusId.get(statusId);
    if (!rows) {
      rows = [];
      rowsByStatusId.set(statusId, rows);
    }
    rows.push(workspace);
  }

  const groups: UserStatusGroup[] = [];
  for (const status of statuses) {
    const rows = rowsByStatusId.get(status.id);
    if (!rows || rows.length === 0) continue;
    rows.sort((a, b) => compareUserStatusRows(a, b, projectNamesByViewKey));
    groups.push({ statusId: status.id, label: status.label, color: status.color, rows });
  }
  return groups;
}

function compareUserStatusRows(
  a: SidebarWorkspaceEntry,
  b: SidebarWorkspaceEntry,
  projectNamesByViewKey: Map<string, string>,
): number {
  const aProject = projectNamesByViewKey.get(a.projectViewKey) ?? a.projectName;
  const bProject = projectNamesByViewKey.get(b.projectViewKey) ?? b.projectName;
  const projectCmp = aProject.localeCompare(bProject);
  if (projectCmp !== 0) return projectCmp;

  const nameCmp = a.name.localeCompare(b.name);
  if (nameCmp !== 0) return nameCmp;

  return a.workspaceKey.localeCompare(b.workspaceKey);
}

export function userStatusWorkspaceGroups(
  groups: readonly UserStatusGroup[],
): SidebarWorkspaceGroup[] {
  return groups.map((group) => ({
    key: `user-status:${encodeURIComponent(group.statusId)}`,
    label: group.label,
    rows: group.rows,
    leading: { kind: "user-status", statusId: group.statusId, color: group.color },
  }));
}
