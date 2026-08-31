import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceStatusDefinition } from "@/utils/workspace-statuses";

export interface BoardColumn {
  status: WorkspaceStatusDefinition;
  workspaces: SidebarWorkspaceEntry[];
}

export type BoardCanvasHandleAssignment = (
  workspace: SidebarWorkspaceEntry,
  statusId: string | null,
) => void;
