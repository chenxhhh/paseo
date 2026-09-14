import { useCallback, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react-native";
import { laneTintStyle, laneTopStyle, statusDotStyle } from "@/utils/workspace-status-colors";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { BoardCard } from "./board-card";
import {
  partitionProjectColumns,
  type BoardColumn,
  type BoardColumnGroup,
  type BoardCanvasHandleAssignment,
} from "./board-canvas.shared";

/**
 * The native board: the same columns and cards, without drag. Native DnD has no
 * kanban rails here yet, so a long-press opens the move-to-status menu instead —
 * the assignment is the verb; the gesture is just how this platform says it.
 * Project lanes are read-only, so their cards have no move menu at all.
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

  // Collapsed lanes are parked together at the end of the row instead of left
  // where they were, so the open lanes stay a solid block.
  const { openColumns, collapsedColumns } = partitionProjectColumns(columns);

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.columnsContent}
        style={styles.columnsScroll}
        testID="board-columns"
      >
        {openColumns.map((column) => (
          <NativeBoardColumn
            key={column.key}
            column={column}
            onOpenMenu={column.assignable ? handleOpenMenu : undefined}
          />
        ))}
        {collapsedColumns.length > 0 ? <NativeCollapsedRail columns={collapsedColumns} /> : null}
      </ScrollView>
      {renderCardMenu(menuWorkspace, closeMenu)}
    </>
  );
}

/**
 * The rail at the end of the row: every folded project, side by side, in
 * project order — expanding one puts it back where it came from.
 */
function NativeCollapsedRail({ columns }: { columns: readonly BoardColumn[] }): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.collapsedRail} testID="board-collapsed-rail">
      <View style={styles.collapsedRailHeader}>
        <ChevronsRight size={14} color={MUTED_ICON_COLOR} />
        <Text style={styles.collapsedRailTitle} numberOfLines={1}>
          {t("workspaceStatus.board.collapsedRail", { count: columns.length })}
        </Text>
      </View>
      <View style={styles.collapsedRailItems}>
        {columns.map((column) => (
          <Pressable
            key={column.key}
            onPress={column.onToggleCollapsed}
            accessibilityRole="button"
            accessibilityLabel={t("workspaceStatus.board.expandColumn", { name: column.label })}
            style={styles.collapsedLane}
            testID={`board-column-${column.key}`}
          >
            <ChevronRight size={14} color={MUTED_ICON_COLOR} />
            <Text style={styles.collapsedLabel} numberOfLines={6}>
              {verticalLabel(column.label)}
            </Text>
            <View style={styles.collapsedCountWrap}>
              <Text style={styles.columnHeaderCount}>{column.workspaces.length}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function NativeBoardColumn({
  column,
  onOpenMenu,
}: {
  column: BoardColumn;
  /** Omitted on read-only lanes, where there is no status to move a card to. */
  onOpenMenu?: (workspace: SidebarWorkspaceEntry) => void;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <View
      style={[styles.column, column.status ? laneTopStyle(column.status.color) : undefined]}
      testID={`board-column-${column.key}`}
    >
      <View
        style={[
          styles.columnHeader,
          column.status ? laneTintStyle(column.status.color) : undefined,
        ]}
      >
        {column.onToggleCollapsed ? (
          <Pressable
            onPress={column.onToggleCollapsed}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={t("workspaceStatus.board.collapseColumn", { name: column.label })}
            testID={`board-column-collapse-${column.key}`}
          >
            <ChevronLeft size={16} color={MUTED_ICON_COLOR} />
          </Pressable>
        ) : null}
        {column.status ? (
          <View style={styles.columnHeaderDotWrap}>
            <View style={[styles.columnHeaderDot, statusDotStyle(column.status.color)]} />
          </View>
        ) : null}
        <Text style={styles.columnHeaderLabel} numberOfLines={1}>
          {column.label}
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
        {column.groups
          ? column.groups.map((group) => (
              <NativeStatusGroup key={group.key} group={group} onOpenMenu={onOpenMenu} />
            ))
          : renderCards(column.workspaces, onOpenMenu, t)}
      </ScrollView>
    </View>
  );
}

function NativeStatusGroup({
  group,
  onOpenMenu,
}: {
  group: BoardColumnGroup;
  onOpenMenu?: (workspace: SidebarWorkspaceEntry) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        {group.status ? (
          <View style={styles.groupHeaderDotWrap}>
            <View style={[styles.columnHeaderDot, statusDotStyle(group.status.color)]} />
          </View>
        ) : null}
        <Text style={styles.groupHeaderLabel} numberOfLines={1}>
          {group.label}
        </Text>
        <Text style={styles.groupHeaderCount}>{group.workspaces.length}</Text>
      </View>
      {renderCards(group.workspaces, onOpenMenu, t)}
    </View>
  );
}

function renderCards(
  workspaces: readonly SidebarWorkspaceEntry[],
  onOpenMenu?: (workspace: SidebarWorkspaceEntry) => void,
  t?: (key: string) => string,
): ReactElement {
  if (workspaces.length === 0) {
    return (
      <View style={styles.columnEmptyBox}>
        <Text style={styles.columnEmptyText}>{t?.("workspaceStatus.board.emptyLane") ?? ""}</Text>
      </View>
    );
  }
  return (
    <>
      {workspaces.map((workspace) => (
        <BoardCard key={workspace.workspaceKey} workspace={workspace} onOpenMenu={onOpenMenu} />
      ))}
    </>
  );
}

// The collapse chevrons sit on a lane header whose tint shifts per lane, so they
// read a plain muted grey rather than a lane color they would rarely match.
const MUTED_ICON_COLOR = "#8b8b8b" as const;

// A collapsed lane is 44px wide, so its label runs top-to-bottom: one character
// per line, wrapped in the newline the Text needs to stack them.
function verticalLabel(label: string): string {
  return [...label].join("\n");
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
    flexGrow: 1,
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
  collapsedRail: {
    flexDirection: "column",
    alignItems: "flex-start",
    flexShrink: 0,
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[2],
    gap: theme.spacing[2],
  },
  collapsedRailHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    flexShrink: 0,
  },
  collapsedRailTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  collapsedRailItems: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: theme.spacing[2],
    minHeight: 0,
    flexShrink: 1,
  },
  collapsedLane: {
    width: 40,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "flex-start",
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  collapsedLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
    minWidth: 0,
    textAlign: "center",
  },
  collapsedCountWrap: {
    minWidth: 20,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
  },
  group: {
    gap: theme.spacing[2],
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[1],
    paddingTop: theme.spacing[0.5],
  },
  groupHeaderDotWrap: {
    width: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  groupHeaderLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    letterSpacing: 0.3,
    flexShrink: 1,
    flexGrow: 1,
    minWidth: 0,
  },
  groupHeaderCount: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
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
