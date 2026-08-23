import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { KanbanSquare } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { useSidebarWorkspacesList } from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { useWorkspaceStatusStore } from "@/stores/workspace-status-store";
import { useWorkspaceUserStatusController } from "@/hooks/use-workspace-user-status";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getWorkspaceUserStatus } from "@/utils/workspace-statuses";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { BoardCanvas } from "./board-canvas";
import type { BoardColumn } from "./board-canvas.shared";
import { BoardCardMenu } from "./board-card-menu";
import { BoardManageSheet } from "./board-manage-sheet";

const ThemedKanbanSquare = withUnistyles(KanbanSquare);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The workspace board: every visible workspace, one column per user status, in
 * catalog order. Assignments live on each workspace's host; the catalog itself
 * is this device's, so the columns read the same everywhere the sidebar does.
 */
export function BoardScreen(): ReactElement {
  const { t } = useTranslation();
  const [manageOpen, setManageOpen] = useState(false);
  const list = useSidebarWorkspacesList();
  const statuses = useWorkspaceStatusStore((state) => state.statuses);
  const entries = useSidebarWorkspaceEntries(list.workspacePlacements, true);
  const { setWorkspaceUserStatus } = useWorkspaceUserStatusController();

  const workspaces = useMemo(() => [...entries.values()], [entries]);
  const serverIds = useMemo(
    () => Array.from(new Set(workspaces.map((workspace) => workspace.serverId))),
    [workspaces],
  );
  const statusSupport = useHostFeatureMap(serverIds, "workspaceUserStatus");
  const canAssign = useCallback(
    (workspace: SidebarWorkspaceEntry) => statusSupport.get(workspace.serverId) === true,
    [statusSupport],
  );

  const columns = useMemo<BoardColumn[]>(() => {
    const byStatusId = new Map<string, SidebarWorkspaceEntry[]>(
      statuses.map((status) => [status.id, []]),
    );
    for (const workspace of workspaces) {
      const statusId = getWorkspaceUserStatus({ userStatus: workspace.userStatus, statuses });
      byStatusId.get(statusId)?.push(workspace);
    }
    return statuses.map((status) => ({
      status,
      workspaces: byStatusId.get(status.id) ?? [],
    }));
  }, [statuses, workspaces]);

  const handleAssign = useCallback(
    (workspace: SidebarWorkspaceEntry, statusId: string | null) => {
      setWorkspaceUserStatus(
        { serverId: workspace.serverId, workspaceId: workspace.workspaceId },
        statusId,
      );
    },
    [setWorkspaceUserStatus],
  );

  // A retired column's workspaces move to the neighbour; every one of them is an
  // ordinary assignment from here on.
  const handleRetire = useCallback(
    (retiredStatusId: string, reassignToStatusId: string) => {
      for (const workspace of workspaces) {
        if (workspace.userStatus === retiredStatusId) {
          setWorkspaceUserStatus(
            { serverId: workspace.serverId, workspaceId: workspace.workspaceId },
            reassignToStatusId,
          );
        }
      }
    },
    [setWorkspaceUserStatus, workspaces],
  );

  const openManage = useCallback(() => setManageOpen(true), []);
  const closeManage = useCallback(() => setManageOpen(false), []);
  const manageButton = useMemo(
    () => (
      <Button variant="secondary" size="sm" onPress={openManage} testID="board-manage-trigger">
        {t("workspaceStatus.manage.title")}
      </Button>
    ),
    [openManage, t],
  );
  const renderCardMenu = useCallback(
    (menuWorkspace: SidebarWorkspaceEntry | null, closeCardMenu: () => void) => (
      <BoardCardMenu workspace={menuWorkspace} onClose={closeCardMenu} />
    ),
    [],
  );

  return (
    <View style={styles.screen}>
      <MenuHeader title={t("workspaceStatus.board.title")} rightContent={manageButton} />
      {workspaces.length === 0 ? (
        <View style={styles.empty} testID="board-empty">
          <View style={styles.emptyIconWrap}>
            <ThemedKanbanSquare size={28} uniProps={mutedIconMapping} />
          </View>
          <Text style={styles.emptyText}>{t("workspaceStatus.board.empty")}</Text>
        </View>
      ) : (
        <View style={styles.canvasArea}>
          <BoardCanvas
            columns={columns}
            onAssign={handleAssign}
            canAssign={canAssign}
            renderCardMenu={renderCardMenu}
          />
        </View>
      )}
      <BoardManageSheet open={manageOpen} onClose={closeManage} onRetire={handleRetire} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    minWidth: 0,
  },
  canvasArea: {
    flex: 1,
    minHeight: 0,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
    maxWidth: 420,
  },
}));
