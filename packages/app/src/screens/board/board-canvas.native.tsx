import { useCallback, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { laneTintStyle, laneTopStyle, statusDotStyle } from "@/utils/workspace-status-colors";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { BoardCard } from "./board-card";
import type { BoardColumn, BoardCanvasHandleAssignment } from "./board-canvas.shared";

/**
 * The native board: the same columns and cards, without drag. Native DnD has no
 * kanban rails here yet, so a long-press opens the move-to-status menu instead —
 * the assignment is the verb; the gesture is just how this platform says it.
 */
export function BoardCanvas({
  columns,
  onAssign: _onAssign,
  canAssign,
  renderCardMenu,
}: {
  columns: readonly BoardColumn[];
  onAssign: BoardCanvasHandleAssignment;
  canAssign: (workspace: SidebarWorkspaceEntry) => boolean;
  /** Long-pressed card for the move menu; null dismisses. */
  renderCardMenu: (workspace: SidebarWorkspaceEntry | null, close: () => void) => ReactElement;
}): ReactElement {
  const [menuWorkspace, setMenuWorkspace] = useState<SidebarWorkspaceEntry | null>(null);
  const closeMenu = useCallback(() => setMenuWorkspace(null), []);
  const handleOpenMenu = useCallback(
    (workspace: SidebarWorkspaceEntry) => {
      if (canAssign(workspace)) {
        setMenuWorkspace(workspace);
      }
    },
    [canAssign],
  );

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.columnsContent}
        style={styles.columnsScroll}
        testID="board-columns"
      >
        {columns.map((column) => (
          <NativeBoardColumn key={column.status.id} column={column} onOpenMenu={handleOpenMenu} />
        ))}
      </ScrollView>
      {renderCardMenu(menuWorkspace, closeMenu)}
    </>
  );
}

function NativeBoardColumn({
  column,
  onOpenMenu,
}: {
  column: BoardColumn;
  onOpenMenu: (workspace: SidebarWorkspaceEntry) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View
      style={[styles.column, laneTopStyle(column.status.color)]}
      testID={`board-column-${column.status.id}`}
    >
      <View style={[styles.columnHeader, laneTintStyle(column.status.color)]}>
        <View style={styles.columnHeaderDotWrap}>
          <View style={[styles.columnHeaderDot, statusDotStyle(column.status.color)]} />
        </View>
        <Text style={styles.columnHeaderLabel} numberOfLines={1}>
          {column.status.label}
        </Text>
        <View style={styles.columnHeaderCountWrap}>
          <Text style={styles.columnHeaderCount}>{column.workspaces.length}</Text>
        </View>
      </View>
      <ScrollView
        style={styles.columnScroll}
        contentContainerStyle={styles.columnScrollContent}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        {column.workspaces.length === 0 ? (
          <View style={styles.columnEmptyBox}>
            <Text style={styles.columnEmptyText}>{t("workspaceStatus.board.emptyLane")}</Text>
          </View>
        ) : (
          column.workspaces.map((workspace) => (
            <BoardCard key={workspace.workspaceKey} workspace={workspace} onOpenMenu={onOpenMenu} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  columnsScroll: {
    flex: 1,
    minWidth: 0,
  },
  columnsContent: {
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    alignItems: "stretch",
  },
  column: {
    width: 272,
    flexShrink: 0,
    flexDirection: "column",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surfaceSidebar,
    borderWidth: 1,
    borderTopWidth: 2,
    borderColor: theme.colors.border,
    maxHeight: "100%",
    overflow: "hidden",
  },
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    minHeight: 36,
  },
  columnHeaderDotWrap: {
    width: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  columnHeaderDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
  columnHeaderLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
    minWidth: 0,
  },
  columnHeaderCountWrap: {
    minWidth: 22,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
  },
  columnHeaderCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  columnScroll: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  columnScrollContent: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  columnEmptyBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    paddingVertical: theme.spacing[4],
    alignItems: "center",
  },
  columnEmptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
