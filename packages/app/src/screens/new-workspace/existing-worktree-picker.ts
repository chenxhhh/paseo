import type { ComboboxOptionModel } from "@/components/ui/combobox-options";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

export interface ExistingWorktreeItem {
  worktreePath: string;
  branchName?: string | null;
  createdAt?: string;
  head?: string | null;
}

export interface ExistingWorktreePickerEntry {
  worktreePath: string;
  branchName: string | null;
  label: string;
  inUse: boolean;
}

export interface ExistingWorktreePickerData {
  options: ComboboxOptionModel[];
  itemById: Map<string, ExistingWorktreePickerEntry>;
  selectedOptionId: string;
}

const OPTION_PREFIX = "worktree:";

export function existingWorktreeOptionId(worktreePath: string): string {
  return `${OPTION_PREFIX}${worktreePath}`;
}

export function existingWorktreeLabel(item: ExistingWorktreeItem): string {
  const branchName = item.branchName?.trim();
  if (branchName) return branchName;
  return worktreePathBasename(item.worktreePath);
}

export function workspacePathsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeWorkspacePath(left);
  const normalizedRight = normalizeWorkspacePath(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (!isWindowsFilesystemPath(normalizedLeft) && !isWindowsFilesystemPath(normalizedRight)) {
    return false;
  }
  return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
}

export function isExistingWorktreeInUse(
  worktreePath: string,
  activeWorkspaceDirectories: readonly string[],
): boolean {
  return activeWorkspaceDirectories.some((directory) =>
    workspacePathsMatch(worktreePath, directory),
  );
}

export function collectActiveWorkspaceDirectories(input: {
  serverId: string;
  workspaceKeys: readonly string[];
  getWorkspaceDirectory: (workspaceId: string) => string | null;
}): string[] {
  const prefix = `${input.serverId}:`;
  const directories: string[] = [];
  for (const workspaceKey of input.workspaceKeys) {
    if (!workspaceKey.startsWith(prefix)) continue;
    const workspaceId = workspaceKey.slice(prefix.length);
    if (!workspaceId) continue;
    const directory = input.getWorkspaceDirectory(workspaceId);
    if (directory) directories.push(directory);
  }
  return directories;
}

export function buildExistingWorktreePickerData(input: {
  worktrees: readonly ExistingWorktreeItem[];
  activeWorkspaceDirectories: readonly string[];
  selectedWorktreePath?: string | null;
}): ExistingWorktreePickerData {
  const itemById = new Map<string, ExistingWorktreePickerEntry>();
  const options: ComboboxOptionModel[] = [];

  for (const worktree of input.worktrees) {
    const label = existingWorktreeLabel(worktree);
    const id = existingWorktreeOptionId(worktree.worktreePath);
    const entry: ExistingWorktreePickerEntry = {
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName ?? null,
      label,
      inUse: isExistingWorktreeInUse(worktree.worktreePath, input.activeWorkspaceDirectories),
    };
    itemById.set(id, entry);
    options.push({
      id,
      label,
      description: worktree.worktreePath,
    });
  }

  const selectedWorktreePath = input.selectedWorktreePath;
  const selectedOptionId = selectedWorktreePath
    ? existingWorktreeOptionId(selectedWorktreePath)
    : "";
  if (selectedOptionId && !itemById.has(selectedOptionId) && selectedWorktreePath) {
    const selectedItem: ExistingWorktreeItem = { worktreePath: selectedWorktreePath };
    const label = existingWorktreeLabel(selectedItem);
    itemById.set(selectedOptionId, {
      worktreePath: selectedWorktreePath,
      branchName: null,
      label,
      inUse: isExistingWorktreeInUse(selectedWorktreePath, input.activeWorkspaceDirectories),
    });
    options.unshift({
      id: selectedOptionId,
      label,
      description: selectedWorktreePath,
    });
  }

  return {
    options,
    itemById,
    selectedOptionId: itemById.has(selectedOptionId) ? selectedOptionId : "",
  };
}

function worktreePathBasename(worktreePath: string): string {
  const normalized = worktreePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  if (separator === -1) return normalized;
  const basename = normalized.slice(separator + 1);
  return basename.length > 0 ? basename : worktreePath;
}

function isWindowsFilesystemPath(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path) || path.startsWith("//");
}
