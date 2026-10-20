import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuItem, MenuHint, MenuSeparator, type MenuPageDefinition } from "@/components/ui/menu";
import { useWorkspaceStatusStore } from "@/stores/workspace-status-store";
import { getWorkspaceUserStatus, type WorkspaceStatusDefinition } from "@/utils/workspace-statuses";
import { statusDotStyle } from "@/utils/workspace-status-colors";
import { useWorkspaceUserStatusController } from "@/hooks/use-workspace-user-status";
import { useHostFeature } from "@/runtime/host-features";

/** The `MenuSubTrigger` on a workspace's menu that opens the assign page. */
export const WORKSPACE_STATUS_PAGE_ID = "workspaceUserStatus";

export interface WorkspaceStatusTarget {
  serverId: string;
  workspaceId: string;
  /** The workspace's stored assignment, from the sidebar entry. */
  userStatus: string | null;
}

/**
 * The page behind a workspace's `Move to status` row, for whichever menu is asking. Mirrors the
 * label picker's shape — both the kebab dropdown and the context menu open the same page — but
 * assigns a single value instead of toggling a set.
 */
export function useWorkspaceStatusMenuPages(
  target: WorkspaceStatusTarget | null,
): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  return useMemo(() => {
    if (!target) return [];
    return [
      {
        id: WORKSPACE_STATUS_PAGE_ID,
        title: t("workspaceStatus.moveTitle"),
        content: (
          <WorkspaceStatusPickerPage
            serverId={target.serverId}
            workspaceId={target.workspaceId}
            userStatus={target.userStatus}
          />
        ),
      },
    ];
  }, [t, target]);
}

function WorkspaceStatusPickerPage({
  serverId,
  workspaceId,
  userStatus,
}: {
  serverId: string;
  workspaceId: string;
  userStatus: string | null;
}): ReactElement {
  const { t } = useTranslation();
  const statuses = useWorkspaceStatusStore((state) => state.statuses);
  const supported = useHostFeature(serverId, "workspaceUserStatus");
  const { setWorkspaceUserStatus } = useWorkspaceUserStatusController();
  const currentStatusId = getWorkspaceUserStatus({ userStatus, statuses });

  const assign = useCallback(
    (statusId: string | null) => {
      setWorkspaceUserStatus({ serverId, workspaceId }, statusId);
    },
    [serverId, setWorkspaceUserStatus, workspaceId],
  );
  const assignStatus = useCallback(
    (status: WorkspaceStatusDefinition) => assign(status.id),
    [assign],
  );
  const clearStatus = useCallback(() => assign(null), [assign]);

  const clearLeading = useMemo(() => <EmptyStatusDotSlot />, []);

  return (
    <>
      {statuses.map((status) => (
        <StatusPickerRow
          key={status.id}
          status={status}
          selected={status.id === currentStatusId}
          disabled={!supported}
          onSelect={assignStatus}
        />
      ))}
      <MenuSeparator />
      <MenuItem
        leading={clearLeading}
        disabled={!supported || userStatus == null}
        closeOnSelect={false}
        onSelect={clearStatus}
        testID="workspace-status-picker-clear"
      >
        {t("workspaceStatus.clear")}
      </MenuItem>
      {!supported ? <MenuHint>{t("workspaceStatus.updateHost")}</MenuHint> : null}
    </>
  );
}

function StatusPickerRow({
  status,
  selected,
  disabled,
  onSelect,
}: {
  status: WorkspaceStatusDefinition;
  selected: boolean;
  disabled: boolean;
  onSelect: (status: WorkspaceStatusDefinition) => void;
}): ReactElement {
  const leading = useMemo(() => <StatusDot color={status.color} />, [status.color]);
  const handleSelect = useCallback(() => {
    onSelect(status);
  }, [onSelect, status]);
  return (
    <MenuItem
      leading={leading}
      selected={selected}
      disabled={disabled}
      closeOnSelect={false}
      onSelect={handleSelect}
      testID={`workspace-status-picker-row-${status.id}`}
    >
      {status.label}
    </MenuItem>
  );
}

function StatusDot({ color }: { color: WorkspaceStatusDefinition["color"] }): ReactElement {
  return <View style={[styles.statusDotBase, statusDotStyle(color)]} />;
}

// The clear row leads with the empty dot slot the status rows above it use, so every row of the
// page stays on one rail.
function EmptyStatusDotSlot(): ReactElement {
  return <View style={styles.statusDotBase} />;
}

const styles = StyleSheet.create((theme) => ({
  statusDotBase: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
}));
