import { useCallback, useState, type ReactElement, type Ref } from "react";
import { Pressable, ScrollView, Text, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
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
 * The web board: one column per status or per project, cards draggable between
 * status lanes. The drop commits the assignment; the lane is the only drop
 * target, so a drop always means "this status now". Project lanes are read-only
 * views, so they opt out of dropping entirely.
 */
export function BoardCanvas({
  columns,
  onAssign,
  canAssign,
}: {
  columns: readonly BoardColumn[];
  onAssign: BoardCanvasHandleAssignment;
  /** False hides the grab affordance for hosts that cannot store assignments. */
  canAssign: (workspace: SidebarWorkspaceEntry) => boolean;
  /** Unused on web, where drag is the move verb; kept so both canvases share a shape. */
  renderCardMenu?: unknown;
}): ReactElement {
  const [draggingWorkspace, setDraggingWorkspace] = useState<SidebarWorkspaceEntry | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingWorkspace((event.active.data.current?.workspace as SidebarWorkspaceEntry) ?? null);
  }, []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingWorkspace(null);
      const workspace = event.active.data.current?.workspace as SidebarWorkspaceEntry | undefined;
      const statusId = event.over?.data.current?.statusId as string | undefined;
      if (!workspace || !statusId) return;
      onAssign(workspace, statusId);
    },
    [onAssign],
  );
  const handleDragCancel = useCallback(() => setDraggingWorkspace(null), []);

  // Collapsed lanes are parked together at the end of the row instead of left
  // where they were, so the open lanes stay a solid block.
  const { openColumns, collapsedColumns } = partitionProjectColumns(columns);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.columnsContent}
        style={styles.columnsScroll}
        testID="board-columns"
      >
        {openColumns.map((column) => (
          <BoardColumnView key={column.key} column={column} canAssign={canAssign} />
        ))}
        {collapsedColumns.length > 0 ? <CollapsedRailView columns={collapsedColumns} /> : null}
      </ScrollView>
      <DragOverlay>
        {draggingWorkspace ? (
          <View style={styles.dragOverlay}>
            <BoardCard workspace={draggingWorkspace} dragging />
          </View>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * The rail at the end of the row: every folded project, side by side.
 *
 * Folding is not a reordering, so these stay in project order and expanding one
 * hands it back to `openColumns` — which is why a lane you unfold reappears in
 * its old place rather than at the end of the board.
 */
function CollapsedRailView({ columns }: { columns: readonly BoardColumn[] }): ReactElement {
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

function BoardColumnView({
  column,
  canAssign,
}: {
  column: BoardColumn;
  canAssign: (workspace: SidebarWorkspaceEntry) => boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: `board-column-${column.key}`,
    disabled: !column.assignable,
    data: { statusId: column.status?.id },
  });
  const laneStyle = column.status
    ? [laneTopStyle(column.status.color), isOver && laneTintStyle(column.status.color)]
    : isOver && styles.columnOver;

  return (
    <View
      ref={setNodeRef as unknown as Ref<View>}
      style={[styles.column, laneStyle, isOver && styles.columnOver]}
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
      >
        {column.groups
          ? column.groups.map((group) => (
              <ProjectStatusGroupView
                key={group.key}
                group={group}
                column={column}
                canAssign={canAssign}
              />
            ))
          : renderCards(column.workspaces, column, canAssign, t)}
      </ScrollView>
    </View>
  );
}

/** A status section inside a project lane: a small header, then that status's cards. */
function ProjectStatusGroupView({
  group,
  column,
  canAssign,
}: {
  group: BoardColumnGroup;
  column: BoardColumn;
  canAssign: (workspace: SidebarWorkspaceEntry) => boolean;
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
      {renderCards(group.workspaces, column, canAssign, t)}
    </View>
  );
}

function renderCards(
  workspaces: readonly SidebarWorkspaceEntry[],
  column: BoardColumn,
  canAssign: (workspace: SidebarWorkspaceEntry) => boolean,
  t: (key: string) => string,
): ReactElement {
  if (workspaces.length === 0) {
    return (
      <View style={styles.columnEmptyBox}>
        <Text style={styles.columnEmptyText}>{t("workspaceStatus.board.emptyLane")}</Text>
      </View>
    );
  }
  return (
    <>
      {workspaces.map((workspace) =>
        column.assignable && canAssign(workspace) ? (
          <DraggableBoardCard key={workspace.workspaceKey} workspace={workspace} />
        ) : (
          <BoardCard key={workspace.workspaceKey} workspace={workspace} />
        ),
      )}
    </>
  );
}

function DraggableBoardCard({ workspace }: { workspace: SidebarWorkspaceEntry }): ReactElement {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `board-card-${workspace.workspaceKey}`,
    data: { workspace },
  });
  return (
    <View
      // dnd-kit's DraggableAttributes are DOM-typed (a widened `role`, aria-*
      // strings); react-native-web passes them straight through to the DOM node.
      {...(attributes as unknown as Record<string, unknown>)}
      ref={setNodeRef as unknown as Ref<View>}
      {...listeners}
      style={[styles.draggable, GRAB_CURSOR, isDragging && styles.draggableActive]}
    >
      <BoardCard workspace={workspace} />
    </View>
  );
}

// Module-level: a stable object for the web-only grab cursor, so the style
// array never hands react-native-web a fresh reference per render.
const GRAB_CURSOR = { cursor: "grab" } as unknown as ViewStyle;

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
  // Full-height lanes: the content box owns the ScrollView's height, so an empty
  // lane still reads as a lane rather than a floating header.
  columnsContent: {
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    height: "100%",
    alignItems: "stretch",
    alignSelf: "stretch",
  },
  column: {
    width: 288,
    flexShrink: 0,
    flexDirection: "column",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surfaceSidebar,
    borderWidth: 1,
    borderTopWidth: 2,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  columnOver: {
    borderColor: theme.colors.ring,
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
  // The folded lanes live in one rail at the end of the row. Grouping them keeps
  // the open lanes a solid block and makes "the ones I set aside" a single
  // place to look, instead of narrow rails scattered between wide columns.
  collapsedRail: {
    flexDirection: "column",
    alignItems: "flex-start",
    flexShrink: 0,
    maxHeight: "100%",
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
  draggable: {
    opacity: 1,
  },
  draggableActive: {
    opacity: 0.35,
  },
  dragOverlay: {
    width: 272,
  },
}));
