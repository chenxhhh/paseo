import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

// Everything the assignment actually needs. Kept narrower than SidebarWorkspaceEntry so the
// board page can build one from its own card model without a sidebar row.
export type StatusAssignableWorkspace = Pick<SidebarWorkspaceEntry, "serverId" | "workspaceId">;

export type SetWorkspaceUserStatus = (
  workspace: StatusAssignableWorkspace,
  status: string | null,
) => void;

// Module scope for the same reason the pin toggle keeps one: the sidebar menus and the board
// page each hold their own controller, and a per-instance guard would let two surfaces race
// two opposite assignments for the same workspace.
const pendingWorkspaceKeys = new Set<string>();

export function useWorkspaceUserStatusController(): {
  setWorkspaceUserStatus: SetWorkspaceUserStatus;
  isPending: (workspaceKey: string) => boolean;
} {
  const { t } = useTranslation();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: async ({
      workspace,
      status,
    }: {
      workspace: StatusAssignableWorkspace;
      status: string | null;
    }) => {
      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) {
        throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      }
      await client.setWorkspaceUserStatus(workspace.workspaceId, status);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.toasts.hostDisconnected"),
      );
    },
    onSettled: (_data, _error, { workspace }) => {
      pendingWorkspaceKeys.delete(`${workspace.serverId}:${workspace.workspaceId}`);
    },
  });
  const mutate = mutation.mutate;

  const setWorkspaceUserStatus = useCallback(
    (workspace: StatusAssignableWorkspace, status: string | null) => {
      const key = `${workspace.serverId}:${workspace.workspaceId}`;
      if (pendingWorkspaceKeys.has(key)) {
        return;
      }
      pendingWorkspaceKeys.add(key);
      mutate({ workspace, status });
    },
    [mutate],
  );

  const isPending = useCallback(
    (workspaceKey: string) => pendingWorkspaceKeys.has(workspaceKey),
    [],
  );

  return { setWorkspaceUserStatus, isPending };
}
