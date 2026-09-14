import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { FolderKanban, KanbanSquare, PanelRightClose } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSidebarWorkspacesList } from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { useWorkspaceStatusStore } from "@/stores/workspace-status-store";
import { useBoardViewPreferencesStore } from "@/stores/board-view-preferences-store";
import { useWorkspaceUserStatusController } from "@/hooks/use-workspace-user-status";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getWorkspaceUserStatus } from "@/utils/workspace-statuses";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { BoardCanvas } from "./board-canvas";
import {
  projectBoardColumn,
  statusBoardColumn,
  type BoardColumn,
  type BoardViewMode,
} from "./board-canvas.shared";
import { BoardCardMenu } from "./board-card-menu";
import { BoardManageSheet } from "./board-manage-sheet";
import {
  filterBoardWorkspaces,
  groupWorkspacesByProject,
  groupWorkspacesByStatus,
} from "./board-filters";

const SEARCH_DEBOUNCE_MS = 200;

export interface BoardColumnCandidate {
  key: string;
  label: string;
  count: number;
}

/**
 * One project row in the Columns menu.
 *
 * Split out of the header so the row's `onSelect` and `trailing` are not new
 * function and element identities on every header render — the rule the board's
 * lint config enforces on props.
 */
const BoardColumnPickerItem = memo(function BoardColumnPickerItem({
  candidate,
  expanded,
  onToggle,
}: {
  candidate: BoardColumnCandidate;
  expanded: boolean;
  onToggle: (key: string) => void;
}) {
  const handleSelect = useCallback(() => onToggle(candidate.key), [candidate.key, onToggle]);
  const trailing = useMemo(
    () => <Text style={styles.menuCount}>{candidate.count}</Text>,
    [candidate.count],
  );
  return (
    <DropdownMenuItem
      // Ticked means expanded: the menu is a list of what is on screen, and an
      // unticked row is the one folded into the trailing collapsed area.
      selected={expanded}
      showSelectedCheck
      onSelect={handleSelect}
      trailing={trailing}
      testID={`board-column-picker-item-${candidate.key}`}
    >
      {candidate.label}
    </DropdownMenuItem>
  );
});

const ThemedKanbanSquare = withUnistyles(KanbanSquare);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The workspace board: every visible workspace, one column per user status or
 * per project. Assignments live on each workspace's host; the catalog itself is
 * this device's, so the status columns read the same everywhere the sidebar
 * does. Project columns are a read-only view — a project is not a status you can
 * drag a workspace into.
 */
export function BoardScreen(): ReactElement {
  const { t } = useTranslation();
  const [manageOpen, setManageOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS).trim();
  const list = useSidebarWorkspacesList();
  const statuses = useWorkspaceStatusStore((state) => state.statuses);
  const entries = useSidebarWorkspaceEntries(list.workspacePlacements, true);
  const { setWorkspaceUserStatus } = useWorkspaceUserStatusController();
  const viewMode = useBoardViewPreferencesStore((state) => state.viewMode);
  const setViewMode = useBoardViewPreferencesStore((state) => state.setViewMode);
  const collapsedProjectKeys = useBoardViewPreferencesStore((state) => state.collapsedProjectKeys);
  const toggleProjectCollapsed = useBoardViewPreferencesStore(
    (state) => state.toggleProjectCollapsed,
  );
  const expandAllProjects = useBoardViewPreferencesStore((state) => state.expandAll);

  const allWorkspaces = useMemo(() => [...entries.values()], [entries]);
  const serverIds = useMemo(
    () => Array.from(new Set(allWorkspaces.map((workspace) => workspace.serverId))),
    [allWorkspaces],
  );
  const statusSupport = useHostFeatureMap(serverIds, "workspaceUserStatus");
  const canAssign = useCallback(
    (workspace: SidebarWorkspaceEntry) => statusSupport.get(workspace.serverId) === true,
    [statusSupport],
  );

  const workspaces = useMemo(
    () => filterBoardWorkspaces(allWorkspaces, search),
    [allWorkspaces, search],
  );

  const projectOrder = useMemo(
    () => list.projects.map((project) => project.viewKey),
    [list.projects],
  );

  const columns = useMemo<BoardColumn[]>(() => {
    if (viewMode === "project") {
      return groupWorkspacesByProject(workspaces, projectOrder).map((group) =>
        projectBoardColumn({
          key: group.key,
          label: group.label,
          workspaces: group.workspaces,
          groups: groupWorkspacesByStatus(group.workspaces, statuses),
          collapsed: collapsedProjectKeys.has(group.key),
          onToggleCollapsed: () => toggleProjectCollapsed(group.key),
        }),
      );
    }
    const byStatusId = new Map<string, SidebarWorkspaceEntry[]>(
      statuses.map((status) => [status.id, []]),
    );
    for (const workspace of workspaces) {
      const statusId = getWorkspaceUserStatus({ userStatus: workspace.userStatus, statuses });
      byStatusId.get(statusId)?.push(workspace);
    }
    return statuses.map((status) => statusBoardColumn(status, byStatusId.get(status.id) ?? []));
  }, [collapsedProjectKeys, projectOrder, statuses, toggleProjectCollapsed, viewMode, workspaces]);

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
      for (const workspace of allWorkspaces) {
        if (workspace.userStatus === retiredStatusId) {
          setWorkspaceUserStatus(
            { serverId: workspace.serverId, workspaceId: workspace.workspaceId },
            reassignToStatusId,
          );
        }
      }
    },
    [allWorkspaces, setWorkspaceUserStatus],
  );

  const openManage = useCallback(() => setManageOpen(true), []);
  const closeManage = useCallback(() => setManageOpen(false), []);

  // The collapsible lanes come from the visible projects, not the catalog: you
  // collapse the projects crowding your screen today, not the ones you might
  // create tomorrow.
  const collapseCandidates = useMemo(() => {
    if (viewMode !== "project") return [];
    return groupWorkspacesByProject(workspaces, projectOrder).map((group) => ({
      key: group.key,
      label: group.label,
      count: group.workspaces.length,
    }));
  }, [projectOrder, viewMode, workspaces]);
  const hasCollapsedColumns = collapsedProjectKeys.size > 0;

  const viewOptions = useMemo<SegmentedControlOption<BoardViewMode>[]>(
    () => [
      {
        value: "status",
        label: t("workspaceStatus.board.viewStatus"),
        icon: ({ color, size }) => <KanbanSquare size={size} color={color} />,
        testID: "board-view-status",
      },
      {
        value: "project",
        label: t("workspaceStatus.board.viewProject"),
        icon: ({ color, size }) => <FolderKanban size={size} color={color} />,
        testID: "board-view-project",
      },
    ],
    [t],
  );

  const headerRight = useMemo(
    () => (
      <View style={styles.headerRight}>
        <SegmentedControl
          options={viewOptions}
          value={viewMode}
          onValueChange={setViewMode}
          size="sm"
          testID="board-view-toggle"
        />
        {collapseCandidates.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={PanelRightClose}
                testID="board-column-picker-trigger"
              >
                {t("workspaceStatus.board.columns")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{t("workspaceStatus.board.collapseHint")}</DropdownMenuLabel>
              {collapseCandidates.map((candidate) => (
                <BoardColumnPickerItem
                  key={candidate.key}
                  candidate={candidate}
                  expanded={!collapsedProjectKeys.has(candidate.key)}
                  onToggle={toggleProjectCollapsed}
                />
              ))}
              {hasCollapsedColumns ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={expandAllProjects} testID="board-columns-expand-all">
                    {t("workspaceStatus.board.expandAll")}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button variant="secondary" size="sm" onPress={openManage} testID="board-manage-trigger">
          {t("workspaceStatus.manage.title")}
        </Button>
      </View>
    ),
    [
      collapseCandidates,
      collapsedProjectKeys,
      expandAllProjects,
      hasCollapsedColumns,
      openManage,
      setViewMode,
      t,
      toggleProjectCollapsed,
      viewMode,
      viewOptions,
    ],
  );

  const renderCardMenu = useCallback(
    (menuWorkspace: SidebarWorkspaceEntry | null, closeCardMenu: () => void) => (
      <BoardCardMenu workspace={menuWorkspace} onClose={closeCardMenu} />
    ),
    [],
  );

  // Searching is a filter over every workspace, so an empty board means the
  // device has none — not that this query found none.
  const isEmpty = allWorkspaces.length === 0;

  return (
    <View style={styles.screen}>
      <MenuHeader title={t("workspaceStatus.board.title")} rightContent={headerRight} />
      <View style={styles.filterRow}>
        <SearchField
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder={t("workspaceStatus.board.searchPlaceholder")}
          clearAccessibilityLabel={t("workspaceStatus.board.clearSearch")}
          testID="board-search-input"
          clearTestID="board-search-clear"
        />
      </View>
      {isEmpty ? (
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
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[3],
  },
  menuCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
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
