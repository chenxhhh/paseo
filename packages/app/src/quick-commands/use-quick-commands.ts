import { useCallback, useMemo } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import {
  quickCommandMatchesProject,
  removeQuickCommand,
  upsertQuickCommand,
  type QuickCommand,
} from "./model";

/**
 * Reads and writes the stored quick commands, filtered to what the composer for
 * `projectId` should offer (its own project commands plus the global ones).
 * `projectId === null` is a composer without project context: global only.
 */
export function useQuickCommands(projectId: string | null) {
  const { settings, updateSettings } = useAppSettings();

  const commands = useMemo(
    () =>
      settings.quickCommands.filter((command) => quickCommandMatchesProject(command, projectId)),
    [settings.quickCommands, projectId],
  );

  const upsert = useCallback(
    (command: QuickCommand) =>
      updateSettings({ quickCommands: upsertQuickCommand(settings.quickCommands, command) }),
    [settings.quickCommands, updateSettings],
  );

  const remove = useCallback(
    (id: string) =>
      updateSettings({ quickCommands: removeQuickCommand(settings.quickCommands, id) }),
    [settings.quickCommands, updateSettings],
  );

  return { commands, upsert, remove };
}
