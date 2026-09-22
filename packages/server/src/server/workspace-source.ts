import { areEquivalentPaths, expandTilde } from "../utils/path.js";
import { isSameOrDescendantPath } from "./path-utils.js";
import type { ProjectRegistry, WorkspaceRegistry } from "./workspace-registry.js";

export interface WorktreeWorkspaceSource {
  cwd?: string;
  projectId?: string;
}

export async function resolveWorktreeSourceCwd(
  source: WorktreeWorkspaceSource,
  projectRegistry: Pick<ProjectRegistry, "get">,
): Promise<string> {
  if (source.cwd) {
    return expandTilde(source.cwd);
  }
  if (!source.projectId) {
    throw new Error("cwd or projectId is required for a worktree-backed workspace");
  }

  const project = await projectRegistry.get(source.projectId);
  if (!project || project.archivedAt) {
    throw new Error(`Project not found: ${source.projectId}`);
  }
  return project.rootPath;
}

export interface InheritedWorktreeProjectIdInput {
  callerWorkspaceId: string | undefined;
  resolvedSourceCwd: string;
  workspaceRegistry: Pick<WorkspaceRegistry, "get"> | undefined;
}

/**
 * Agent-scoped worktree creates inherit the caller's project when the source
 * path still sits inside that workspace. Anything else falls through to path
 * matching.
 */
export async function resolveInheritedProjectIdForWorktreeCreate(
  input: InheritedWorktreeProjectIdInput,
): Promise<string | undefined> {
  if (!input.callerWorkspaceId || !input.workspaceRegistry) {
    return undefined;
  }
  const workspace = await input.workspaceRegistry.get(input.callerWorkspaceId);
  if (!workspace || workspace.archivedAt) {
    return undefined;
  }
  if (!worktreeSourceOverlapsCallerCwd(input.resolvedSourceCwd, workspace.cwd)) {
    return undefined;
  }
  return workspace.projectId;
}

function worktreeSourceOverlapsCallerCwd(
  resolvedSourceCwd: string,
  callerWorkspaceCwd: string,
): boolean {
  if (areEquivalentPaths(resolvedSourceCwd, callerWorkspaceCwd)) {
    return true;
  }
  return (
    isSameOrDescendantPath(callerWorkspaceCwd, resolvedSourceCwd) ||
    isSameOrDescendantPath(resolvedSourceCwd, callerWorkspaceCwd)
  );
}
