import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Archive, X } from "lucide-react-native";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ThemedArchive = withUnistyles(Archive);
const ThemedX = withUnistyles(X);

/**
 * One-click archive in the workspace row's trailing slot, next to the kebab. Clicking the icon
 * swaps it for an inline confirm (no dialog); the confirm runs the same archive path as the
 * menu's Archive item. The X cancels — touch has no hover for the reveal to hide behind, so
 * cancel has to be a control; on web the trailing overlay unmounts when the pointer leaves the
 * row, which resets the confirm as well.
 */
export function SidebarWorkspaceArchiveAction({
  workspaceKey,
  disabled = false,
  onArchive,
}: {
  workspaceKey: string;
  disabled?: boolean;
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  const handleArm = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
    setConfirming(true);
  }, []);

  const handleCancel = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
    setConfirming(false);
  }, []);

  const handleConfirm = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      setConfirming(false);
      onArchive();
    },
    [onArchive],
  );

  const triggerStyle = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      hovered && !disabled && styles.triggerHovered,
      disabled && styles.disabled,
    ],
    [disabled],
  );

  if (confirming) {
    return (
      <View style={[styles.confirmGroup, disabled && styles.disabled]}>
        <Pressable
          onPress={handleCancel}
          disabled={disabled}
          hitSlop={4}
          accessibilityRole={isWeb ? undefined : "button"}
          accessibilityLabel={t("sidebar.workspace.actions.archiveCancel")}
          testID={`sidebar-workspace-archive-cancel-${workspaceKey}`}
        >
          {({ hovered }) => (
            <ThemedX
              size={14}
              uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
            />
          )}
        </Pressable>
        <Pressable
          onPress={handleConfirm}
          disabled={disabled}
          accessibilityRole={isWeb ? undefined : "button"}
          testID={`sidebar-workspace-archive-confirm-${workspaceKey}`}
        >
          <Text style={styles.confirmText}>{t("sidebar.workspace.actions.archiveConfirm")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      onPress={handleArm}
      disabled={disabled}
      hitSlop={8}
      style={triggerStyle}
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={t("sidebar.workspace.actions.archive")}
      testID={`sidebar-workspace-archive-${workspaceKey}`}
    >
      {({ hovered }) => (
        <ThemedArchive
          size={14}
          uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: 2,
    borderRadius: 4,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  // The confirm group carries its own surface because it grows leftward over the title text
  // and touch rows get no scrim to fade that text away.
  confirmGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    height: 20,
    paddingHorizontal: theme.spacing[1],
    borderRadius: 4,
    backgroundColor: theme.colors.surface2,
  },
  confirmText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
  disabled: {
    opacity: theme.opacity[50],
  },
}));
