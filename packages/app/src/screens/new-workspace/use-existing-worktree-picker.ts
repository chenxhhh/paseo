import { useCallback, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { View } from "react-native";
import type { TFunction } from "i18next";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { ComboboxOption as ComboboxOptionType } from "@/components/ui/combobox";
import { useFetchQuery } from "@/data/query";
import { worktreeListQueryKey } from "@/git/query-keys";
import type { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  selectWorkspaceDirectory,
  workspaceEqualityFns,
} from "@/stores/session-store-hooks/selectors";
import {
  buildExistingWorktreePickerData,
  collectActiveWorkspaceDirectories,
  existingWorktreeLabel,
  type ExistingWorktreeItem,
  type ExistingWorktreePickerEntry,
} from "./existing-worktree-picker";

const EMPTY_WORKSPACE_KEYS: readonly string[] = [];

export interface ExistingWorktreePickerState {
  selectedExistingWorktree: ExistingWorktreeItem | null;
  resetSelection: () => void;
  itemById: Map<string, ExistingWorktreePickerEntry>;
  control: {
    anchorRef: RefObject<View | null>;
    open: () => void;
    openState: boolean;
    onOpenChange: (open: boolean) => void;
    show: boolean;
    selectedSourceDirectory: string | null;
    triggerLabel: string;
    options: ComboboxOptionType[];
    selectedOptionId: string;
    onSelect: (id: string) => void;
    emptyText: string;
  };
}

function useActiveWorkspaceDirectories(input: {
  serverId: string;
  workspaceKeys: readonly string[];
}): string[] {
  const { serverId, workspaceKeys } = input;
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      collectActiveWorkspaceDirectories({
        serverId,
        workspaceKeys,
        getWorkspaceDirectory: (workspaceId) =>
          selectWorkspaceDirectory(state, serverId, workspaceId),
      }),
    workspaceEqualityFns.deep,
  );
}

export function useExistingWorktreePicker(input: {
  serverId: string;
  sourceDirectory: string | null;
  workspaceKeys: readonly string[] | undefined;
  clientReady: boolean;
  show: boolean;
  withConnectedClient: () => NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  t: TFunction;
}): ExistingWorktreePickerState {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedExistingWorktree, setSelectedExistingWorktree] =
    useState<ExistingWorktreeItem | null>(null);
  const pickerAnchorRef = useRef<View>(null);
  const workspaceKeys = input.workspaceKeys ?? EMPTY_WORKSPACE_KEYS;
  const activeWorkspaceDirectories = useActiveWorkspaceDirectories({
    serverId: input.serverId,
    workspaceKeys,
  });
  const hasSourceDirectory = input.sourceDirectory !== null;
  const worktreeListQuery = useFetchQuery({
    queryKey: worktreeListQueryKey(input.serverId, input.sourceDirectory ?? ""),
    queryFn: async () => {
      if (!input.sourceDirectory) {
        throw new Error("Choose a project");
      }
      const connectedClient = input.withConnectedClient();
      const payload = await connectedClient.getPaseoWorktreeList({
        cwd: input.sourceDirectory,
      });
      if (payload.error) {
        throw new Error(payload.error.message);
      }
      return payload.worktrees;
    },
    enabled: pickerOpen && input.clientReady && hasSourceDirectory,
    dataShape: "list",
    staleTimeMs: 15_000,
  });
  const { options, itemById, selectedOptionId } = useMemo(
    () =>
      buildExistingWorktreePickerData({
        worktrees: worktreeListQuery.data ?? [],
        activeWorkspaceDirectories,
        selectedWorktreePath: selectedExistingWorktree?.worktreePath,
      }),
    [activeWorkspaceDirectories, selectedExistingWorktree?.worktreePath, worktreeListQuery.data],
  );

  const resetSelection = useCallback(() => {
    setSelectedExistingWorktree(null);
  }, []);

  const open = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const onOpenChange = useCallback((nextOpen: boolean) => {
    setPickerOpen(nextOpen);
  }, []);

  const onSelect = useCallback(
    (id: string) => {
      const item = itemById.get(id);
      if (!item) return;
      setSelectedExistingWorktree({
        worktreePath: item.worktreePath,
        branchName: item.branchName,
      });
      setPickerOpen(false);
    },
    [itemById],
  );

  const triggerLabel = selectedExistingWorktree
    ? existingWorktreeLabel(selectedExistingWorktree)
    : input.t("newWorkspace.worktreePicker.chooseWorktree");
  const emptyText = worktreeListQuery.isFetching
    ? input.t("newWorkspace.refPicker.searching")
    : input.t("newWorkspace.worktreePicker.noWorktrees");

  return {
    selectedExistingWorktree,
    resetSelection,
    itemById,
    control: {
      anchorRef: pickerAnchorRef,
      open,
      openState: pickerOpen,
      onOpenChange,
      show: input.show,
      selectedSourceDirectory: input.sourceDirectory,
      triggerLabel,
      options,
      selectedOptionId,
      onSelect,
      emptyText,
    },
  };
}
