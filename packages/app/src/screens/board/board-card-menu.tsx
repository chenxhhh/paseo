import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceStatusMenuPages, type WorkspaceStatusTarget } from "@/workspace-status/picker";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

/**
 * The move-to-status menu behind a board card. Controlled entirely by the
 * workspace the canvas hands it — null means closed — so the canvas owns when
 * it opens and the picker page owns the assignment.
 */
export function BoardCardMenu({
  workspace,
  onClose,
}: {
  workspace: SidebarWorkspaceEntry | null;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const target = useMemo<WorkspaceStatusTarget | null>(
    () =>
      workspace
        ? {
            serverId: workspace.serverId,
            workspaceId: workspace.workspaceId,
            userStatus: workspace.userStatus,
          }
        : null,
    [workspace],
  );
  const pages = useWorkspaceStatusMenuPages(target);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  return (
    <DropdownMenu open={workspace !== null} onOpenChange={handleOpenChange}>
      {/* The card is the trigger; this zero-size stand-in exists only because a
          controlled menu still mounts one. */}
      <DropdownMenuTrigger accessibilityElementsHidden pointerEvents="none">
        <View style={styles.hiddenTrigger} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        width={260}
        pages={pages}
        sheetTitle={t("workspaceStatus.moveTitle")}
      >
        {null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create(() => ({
  hiddenTrigger: {
    width: 0,
    height: 0,
  },
}));
