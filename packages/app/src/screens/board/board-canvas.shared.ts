import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceStatusDefinition } from "@/utils/workspace-statuses";

/** How the board slices the same workspaces: by user status, or by project. */
export type BoardViewMode = "status" | "project";

/**
 * A sub-section inside a lane: the lane's cards, split by their user status.
 * Only the project view uses these — a status lane's cards all share one status
 * by definition, so a header there would restate the column.
 */
export interface BoardColumnGroup {
  key: string;
  label: string;
  status: WorkspaceStatusDefinition | null;
  workspaces: SidebarWorkspaceEntry[];
}

/**
 * A lane on the board. Status lanes are the assignable catalog; project lanes
 * are derived from the visible workspaces and accept no drops, so `status`
 * stays null there and the canvas hides its grab affordance.
 *
 * `groups` sub-divides the lane. `groups === null` means "render the cards
 * flat", which is the status view; a project lane carries one group per status
 * that actually has cards there.
 */
export interface BoardColumn {
  key: string;
  label: string;
  workspaces: SidebarWorkspaceEntry[];
  /** The lane's status when it is a status lane; null for project lanes. */
  status: WorkspaceStatusDefinition | null;
  /** False for lanes the board renders but the user cannot move cards into. */
  assignable: boolean;
  /** Non-null when the lane shows status sub-headers; null renders cards flat. */
  groups: readonly BoardColumnGroup[] | null;
  /** A collapsed project lane shows only its rail; only project lanes collapse. */
  collapsed: boolean;
  /** Present when this lane can be collapsed, so the canvas can offer the control. */
  onToggleCollapsed?: () => void;
}

export type BoardCanvasHandleAssignment = (
  workspace: SidebarWorkspaceEntry,
  statusId: string | null,
) => void;

export function statusBoardColumn(
  status: WorkspaceStatusDefinition,
  workspaces: SidebarWorkspaceEntry[],
): BoardColumn {
  return {
    key: status.id,
    label: status.label,
    workspaces,
    status,
    assignable: true,
    groups: null,
    collapsed: false,
  };
}

export function projectBoardColumn(input: {
  key: string;
  label: string;
  workspaces: SidebarWorkspaceEntry[];
  groups: readonly BoardColumnGroup[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
}): BoardColumn {
  return {
    key: input.key,
    label: input.label,
    workspaces: input.workspaces,
    status: null,
    assignable: false,
    groups: input.groups,
    collapsed: input.collapsed,
    onToggleCollapsed: input.onToggleCollapsed,
  };
}

/**
 * Splits project lanes into the ones on the board and the ones folded into the
 * rail at the end.
 *
 * Collapsed lanes are parked together rather than left in place: a rail is
 * narrow, so scattering them through the row would leave gaps that read as
 * broken columns. Each side keeps its own project order, so expanding a lane
 * returns it to where it belongs instead of to the end of the row.
 */
export function partitionProjectColumns(columns: readonly BoardColumn[]): {
  openColumns: BoardColumn[];
  collapsedColumns: BoardColumn[];
} {
  const openColumns: BoardColumn[] = [];
  const collapsedColumns: BoardColumn[] = [];
  for (const column of columns) {
    if (column.collapsed) {
      collapsedColumns.push(column);
    } else {
      openColumns.push(column);
    }
  }
  return { openColumns, collapsedColumns };
}
