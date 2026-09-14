import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { BoardViewMode } from "@/screens/board/board-canvas.shared";

const BOARD_VIEW_PREFERENCES_STORAGE_KEY = "board-view-preferences";

/**
 * How this device left the board: which slice was showing, and which project
 * lanes were folded away.
 *
 * Both are ways of arranging your own screen rather than facts about the
 * workspaces, so they live here and not on the host. Persisting them means the
 * board opens the way you closed it — the view you chose is the view you come
 * back to, and a lane you folded stays folded.
 */
interface BoardViewPreferencesState {
  viewMode: BoardViewMode;
  collapsedProjectKeys: Set<string>;
  setViewMode: (viewMode: BoardViewMode) => void;
  toggleProjectCollapsed: (projectKey: string) => void;
  setProjectCollapsed: (projectKey: string, collapsed: boolean) => void;
  expandAll: () => void;
}

interface PersistedBoardViewPreferences {
  viewMode?: BoardViewMode;
  collapsedProjectKeys?: string[];
}

const PersistedBoardViewPreferencesSchema: z.ZodType<PersistedBoardViewPreferences> =
  z.strictObject({
    viewMode: z.enum(["status", "project"]).optional(),
    collapsedProjectKeys: z.array(z.string()).optional(),
  });

function toggleKey(keys: Set<string>, key: string): Set<string> {
  const next = new Set(keys);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

function setKey(keys: Set<string>, key: string, collapsed: boolean): Set<string> {
  const next = new Set(keys);
  if (collapsed) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
}

export const useBoardViewPreferencesStore = create<BoardViewPreferencesState>()(
  persist<BoardViewPreferencesState, [], [], PersistedBoardViewPreferences>(
    (set) => ({
      viewMode: "status",
      collapsedProjectKeys: new Set(),
      setViewMode: (viewMode) => set({ viewMode }),
      toggleProjectCollapsed: (projectKey) =>
        set((state) => ({
          collapsedProjectKeys: toggleKey(state.collapsedProjectKeys, projectKey),
        })),
      setProjectCollapsed: (projectKey, collapsed) =>
        set((state) => ({
          collapsedProjectKeys: setKey(state.collapsedProjectKeys, projectKey, collapsed),
        })),
      expandAll: () => set({ collapsedProjectKeys: new Set() }),
    }),
    {
      name: BOARD_VIEW_PREFERENCES_STORAGE_KEY,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedBoardViewPreferencesSchema),
      partialize: (state) => ({
        viewMode: state.viewMode,
        collapsedProjectKeys: Array.from(state.collapsedProjectKeys),
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as PersistedBoardViewPreferences | undefined;
        return {
          ...currentState,
          viewMode: persisted?.viewMode ?? currentState.viewMode,
          collapsedProjectKeys: new Set(persisted?.collapsedProjectKeys ?? []),
        };
      },
    },
  ),
);
