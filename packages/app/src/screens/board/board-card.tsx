import { memo, useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { StatusRing } from "@/components/status-ring";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

/**
 * A workspace on the board: enough to recognize it (status dot, title, project,
 * branch) and nothing more. The card's column already says the thing the board
 * exists to say.
 */
export const BoardCard = memo(function BoardCard({
  workspace,
  dragging = false,
  onOpenMenu,
}: {
  workspace: SidebarWorkspaceEntry;
  dragging?: boolean;
  /** Native and right-click surfaces open the move-to-status menu instead of dragging. */
  onOpenMenu?: (workspace: SidebarWorkspaceEntry) => void;
}) {
  const handlePress = useCallback(() => {
    navigateToWorkspace({ serverId: workspace.serverId, workspaceId: workspace.workspaceId });
  }, [workspace.serverId, workspace.workspaceId]);
  const handleLongPress = useCallback(() => {
    onOpenMenu?.(workspace);
  }, [onOpenMenu, workspace]);
  const cardStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.card,
      (hovered || pressed) && styles.cardHovered,
      dragging && styles.cardDragging,
    ],
    [dragging],
  );

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={onOpenMenu ? handleLongPress : undefined}
      delayLongPress={250}
      accessibilityRole="button"
      accessibilityLabel={workspace.title ?? workspace.name}
      style={cardStyle}
      testID={`board-card-${workspace.workspaceKey}`}
    >
      <View style={styles.cardRow}>
        <View style={styles.dotSlot}>
          {workspace.statusBucket === "running" ? (
            <StatusRing />
          ) : (
            <View style={[styles.dot, activityDotStyle(workspace.statusBucket)]} />
          )}
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {workspace.title ?? workspace.name}
        </Text>
      </View>
      <Text style={styles.meta} numberOfLines={1}>
        {[workspace.projectName, workspace.currentBranch].filter(Boolean).join(" · ")}
      </Text>
    </Pressable>
  );
});

// The activity dot's palette, prebuilt per bucket the way the sidebar's status
// dots resolve — `useUnistyles` is a restricted import, so the theme read lives here once.
const themedDots = StyleSheet.create((theme) => ({
  needsInput: { backgroundColor: theme.colors.statusDotWarning },
  failed: { backgroundColor: theme.colors.statusDotDanger },
  attention: { backgroundColor: theme.colors.statusDotSuccess },
}));

function activityDotStyle(bucket: SidebarWorkspaceEntry["statusBucket"]) {
  switch (bucket) {
    case "needs_input":
      return themedDots.needsInput;
    case "failed":
      return themedDots.failed;
    case "attention":
      return themedDots.attention;
    default:
      return null;
  }
}

const styles = StyleSheet.create((theme) => ({
  card: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    gap: 3,
  },
  cardHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.ring,
  },
  cardDragging: {
    opacity: 0.92,
    shadowColor: theme.colors.foreground,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  dotSlot: {
    width: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: theme.borderRadius.full,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
    minWidth: 0,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
