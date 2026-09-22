import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { WORKSPACE_LABEL_COLORS } from "@getpaseo/protocol/workspace-labels";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  cloneDefaultWorkspaceStatuses,
  makeWorkspaceStatusId,
  normalizeWorkspaceStatuses,
  type WorkspaceStatusDefinition,
} from "@/utils/workspace-statuses";

const WORKSPACE_STATUS_STORAGE_KEY = "workspace-status-catalog";
const WORKSPACE_STATUS_STORE_VERSION = 1;
const MIN_STATUS_COUNT = 1;

interface WorkspaceStatusStoreState {
  statuses: WorkspaceStatusDefinition[];
  addStatus: (label: string) => WorkspaceStatusDefinition;
  renameStatus: (id: string, label: string) => void;
  setStatusColor: (id: string, color: WorkspaceStatusDefinition["color"]) => void;
  moveStatus: (id: string, delta: 1 | -1) => void;
  removeStatus: (id: string) => void;
  resetStatuses: () => void;
}

const WorkspaceStatusDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.enum(WORKSPACE_LABEL_COLORS),
});
const WorkspaceStatusPersistedStateSchema = z.strictObject({
  statuses: z.array(WorkspaceStatusDefinitionSchema).optional(),
});

export function migrateWorkspaceStatusState(persistedState: unknown): {
  statuses: WorkspaceStatusDefinition[];
} {
  const result = WorkspaceStatusPersistedStateSchema.safeParse(persistedState);
  if (!result.success || !result.data.statuses) {
    return { statuses: cloneDefaultWorkspaceStatuses() };
  }
  return { statuses: normalizeWorkspaceStatuses(result.data.statuses) };
}

/**
 * The board-column catalog. Device-local by design in v1: assignments live on
 * the host and sync, while the columns themselves are a per-client view choice
 * (the same rails labels use could promote this host-side later).
 */
export const useWorkspaceStatusStore = create<WorkspaceStatusStoreState>()(
  persist(
    (set, get) => ({
      statuses: cloneDefaultWorkspaceStatuses(),
      addStatus: (label) => {
        const next: WorkspaceStatusDefinition = {
          id: makeWorkspaceStatusId(label, get().statuses),
          label,
          color: "sky",
        };
        set((state) => ({ statuses: normalizeWorkspaceStatuses([...state.statuses, next]) }));
        return next;
      },
      renameStatus: (id, label) =>
        set((state) => ({
          statuses: normalizeWorkspaceStatuses(
            state.statuses.map((status) => (status.id === id ? { ...status, label } : status)),
          ),
        })),
      setStatusColor: (id, color) =>
        set((state) => ({
          statuses: state.statuses.map((status) =>
            status.id === id ? { ...status, color } : status,
          ),
        })),
      moveStatus: (id, delta) =>
        set((state) => {
          const index = state.statuses.findIndex((status) => status.id === id);
          const targetIndex = index + delta;
          if (index < 0 || targetIndex < 0 || targetIndex >= state.statuses.length) {
            return state;
          }
          const statuses = [...state.statuses];
          const [moved] = statuses.splice(index, 1);
          statuses.splice(targetIndex, 0, moved);
          return { statuses };
        }),
      removeStatus: (id) =>
        set((state) => {
          if (state.statuses.length <= MIN_STATUS_COUNT) {
            return state;
          }
          return {
            statuses: normalizeWorkspaceStatuses(
              state.statuses.filter((status) => status.id !== id),
            ),
          };
        }),
      resetStatuses: () => set({ statuses: cloneDefaultWorkspaceStatuses() }),
    }),
    {
      name: WORKSPACE_STATUS_STORAGE_KEY,
      version: WORKSPACE_STATUS_STORE_VERSION,
      storage: createValidatedPersistStorage(AsyncStorage, WorkspaceStatusPersistedStateSchema),
      partialize: (state) => ({
        statuses: state.statuses,
      }),
      migrate: migrateWorkspaceStatusState,
    },
  ),
);
