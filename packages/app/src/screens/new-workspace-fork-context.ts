import type { AgentAttachment } from "@getpaseo/protocol/messages";

function isLikelyWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path);
}

function isChatHistoryTextAttachment(attachment: AgentAttachment): boolean {
  return attachment.type === "text" && attachment.contextKind === "chat_history";
}

export function getWorkspaceNamingAttachments(
  attachments: readonly AgentAttachment[],
): AgentAttachment[] {
  return attachments.filter((attachment) => !isChatHistoryTextAttachment(attachment));
}

export function remapDraftCwdToWorkspace(input: {
  cwd: string;
  sourceDirectory?: string | null;
  workspaceDirectory: string;
}): string {
  const cwd = input.cwd.trim();
  const sourceDirectory = input.sourceDirectory?.trim();
  const workspaceDirectory = input.workspaceDirectory.trim();
  if (!cwd) {
    return workspaceDirectory;
  }
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedWorkspace = workspaceDirectory.replace(/\\/g, "/").replace(/\/+$/, "");
  const compareCaseInsensitively =
    isLikelyWindowsPath(normalizedCwd) ||
    isLikelyWindowsPath(normalizedWorkspace) ||
    (sourceDirectory ? isLikelyWindowsPath(sourceDirectory.replace(/\\/g, "/")) : false);
  const comparableCwd = compareCaseInsensitively ? normalizedCwd.toLowerCase() : normalizedCwd;
  const comparableWorkspace = compareCaseInsensitively
    ? normalizedWorkspace.toLowerCase()
    : normalizedWorkspace;
  const separator =
    workspaceDirectory.includes("\\") && !workspaceDirectory.includes("/") ? "\\" : "/";
  if (comparableCwd === comparableWorkspace) {
    return workspaceDirectory;
  }
  if (comparableCwd.startsWith(`${comparableWorkspace}/`)) {
    const existingRelative = normalizedCwd.slice(normalizedWorkspace.length + 1);
    return [workspaceDirectory.replace(/[\\/]+$/, ""), ...existingRelative.split("/")]
      .filter(Boolean)
      .join(separator);
  }
  if (!sourceDirectory) {
    return workspaceDirectory;
  }
  const normalizedSource = sourceDirectory.replace(/\\/g, "/").replace(/\/+$/, "");
  const comparableSource = compareCaseInsensitively
    ? normalizedSource.toLowerCase()
    : normalizedSource;
  if (comparableCwd === comparableSource) {
    return workspaceDirectory;
  }
  const relativePath = comparableCwd.startsWith(`${comparableSource}/`)
    ? normalizedCwd.slice(normalizedSource.length + 1)
    : "";
  if (!relativePath) {
    return workspaceDirectory;
  }
  return [workspaceDirectory.replace(/[\\/]+$/, ""), ...relativePath.split("/")]
    .filter(Boolean)
    .join(separator);
}
