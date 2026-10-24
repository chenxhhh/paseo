import { useCallback, useMemo, useState, type MutableRefObject, type ReactElement } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { type GestureType } from "react-native-gesture-handler";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react-native";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import { isWeb as platformIsWeb } from "@/constants/platform";
import type {
  SidebarWorkspacePlacement,
  SidebarWorkspaceSubgroup,
} from "@/hooks/use-sidebar-workspaces-list";
import type { Theme } from "@/styles/theme";

const workspaceKeyExtractor = (workspace: SidebarWorkspacePlacement) => workspace.workspaceKey;

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function WorktreeGroupLeadingVisual({
  collapsed,
  showChevron,
}: {
  collapsed: boolean;
  showChevron: boolean;
}) {
  if (!showChevron) {
    return <ThemedGitBranch size={14} uniProps={foregroundMutedColorMapping} />;
  }
  if (collapsed) {
    return <ThemedChevronRight size={14} uniProps={foregroundMutedColorMapping} />;
  }
  return <ThemedChevronDown size={14} uniProps={foregroundMutedColorMapping} />;
}

function WorktreeGroupHeader({
  group,
  collapsed,
  onToggle,
}: {
  group: SidebarWorkspaceSubgroup;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.worktreeGroupRow,
      isHovered && styles.worktreeGroupRowHovered,
      pressed && styles.worktreeGroupRowPressed,
    ],
    [isHovered],
  );
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const showBranch =
    group.kind === "worktree" && Boolean(group.branch && group.branch !== group.label);

  return (
    <View onPointerEnter={handleHoverIn} onPointerLeave={handleHoverOut}>
      <PressHighlight
        accessibilityRole={platformIsWeb ? undefined : "button"}
        accessibilityLabel={`${group.label} group`}
        accessibilityState={accessibilityState}
        style={rowStyle}
        onPress={onToggle}
        testID={`sidebar-worktree-group-${group.key}`}
      >
        <View style={styles.worktreeGroupRowLeft}>
          <View style={styles.worktreeGroupLeadingVisualSlot}>
            <WorktreeGroupLeadingVisual collapsed={collapsed} showChevron={isHovered} />
          </View>
          <View style={styles.worktreeGroupTitleGroup}>
            <Text style={styles.worktreeGroupTitle} numberOfLines={1}>
              {group.label}
            </Text>
            {showBranch ? (
              <Text style={styles.worktreeGroupBranch} numberOfLines={1}>
                {group.branch}
              </Text>
            ) : null}
          </View>
        </View>
      </PressHighlight>
    </View>
  );
}

export function WorktreeGroupSection({
  group,
  collapsed,
  onToggleWorktreeGroupCollapsed,
  renderItem,
  onDragEnd,
  extraData,
  parentGestureRef,
  useNestable,
  dragGestureHostPresented,
}: {
  group: SidebarWorkspaceSubgroup;
  collapsed: boolean;
  onToggleWorktreeGroupCollapsed: (key: string) => void;
  renderItem: (info: DraggableRenderItemInfo<SidebarWorkspacePlacement>) => ReactElement;
  onDragEnd: (workspaces: SidebarWorkspacePlacement[]) => void;
  extraData: string;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  useNestable: boolean;
  dragGestureHostPresented?: boolean;
}) {
  const { visibleItems, expanded, canToggle, toggleExpanded } = useLimitedSidebarGroup(
    group.workspaces,
  );
  const handleToggleCollapsed = useCallback(() => {
    onToggleWorktreeGroupCollapsed(group.key);
  }, [group.key, onToggleWorktreeGroupCollapsed]);

  return (
    <View>
      <WorktreeGroupHeader group={group} collapsed={collapsed} onToggle={handleToggleCollapsed} />
      {collapsed ? null : (
        <>
          <DraggableList
            testID={`sidebar-worktree-group-rows-${group.key}`}
            data={visibleItems}
            keyExtractor={workspaceKeyExtractor}
            renderItem={renderItem}
            onDragEnd={onDragEnd}
            extraData={extraData}
            scrollEnabled={false}
            useDragHandle
            nestable={useNestable}
            simultaneousGestureRef={parentGestureRef}
            gestureHostPresented={dragGestureHostPresented}
            containerStyle={styles.workspaceListContainer}
          />
          {canToggle ? (
            <SidebarGroupToggleRow
              expanded={expanded}
              onPress={toggleExpanded}
              indent="subgroup"
              testID={`sidebar-worktree-group-show-more-${group.key}`}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  workspaceListContainer: {},
  worktreeGroupRow: {
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2] + theme.spacing[2],
    paddingRight: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  worktreeGroupRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  worktreeGroupRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  worktreeGroupRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  worktreeGroupLeadingVisualSlot: {
    position: "relative",
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  worktreeGroupTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
  },
  worktreeGroupTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: "400",
    minWidth: 0,
    flexShrink: 1,
  },
  worktreeGroupBranch: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: 0,
    flexShrink: 1,
  },
}));
