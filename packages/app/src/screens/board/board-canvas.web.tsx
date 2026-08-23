import { useCallback, useState, type ReactElement, type Ref } from "react";
import { ScrollView, Text, View, type ViewStyle } from "react-native";
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
import { laneTintStyle, laneTopStyle, statusDotStyle } from "@/utils/workspace-status-colors";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { BoardCard } from "./board-card";
import type { BoardColumn, BoardCanvasHandleAssignment } from "./board-canvas.shared";

/**
 * The web board: one column per status, cards draggable between columns. The
 * drop commits the assignment; the column is the only drop target, so a drop
 * always means "this status now".
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
        {columns.map((column) => (
          <BoardColumnView key={column.status.id} column={column} canAssign={canAssign} />
        ))}
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

function BoardColumnView({
  column,
  canAssign,
}: {
  column: BoardColumn;
  canAssign: (workspace: SidebarWorkspaceEntry) => boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: `board-column-${column.status.id}`,
    data: { statusId: column.status.id },
  });

  return (
    <View
      ref={setNodeRef as unknown as Ref<View>}
      style={[
        styles.column,
        laneTopStyle(column.status.color),
        isOver && styles.columnOver,
        isOver && laneTintStyle(column.status.color),
      ]}
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
      >
        {column.workspaces.length === 0 ? (
          <View style={styles.columnEmptyBox}>
            <Text style={styles.columnEmptyText}>{t("workspaceStatus.board.emptyLane")}</Text>
          </View>
        ) : (
          column.workspaces.map((workspace) =>
            canAssign(workspace) ? (
              <DraggableBoardCard key={workspace.workspaceKey} workspace={workspace} />
            ) : (
              <BoardCard key={workspace.workspaceKey} workspace={workspace} />
            ),
          )
        )}
      </ScrollView>
    </View>
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
