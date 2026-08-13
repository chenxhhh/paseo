import { generateMessageId } from "@/types/stream";

export const NEW_WORKSPACE_DRAFT_KEY = "new-workspace";
const NEW_WORKSPACE_FORK_DRAFT_PREFIX = `${NEW_WORKSPACE_DRAFT_KEY}:draft:`;

export function generateDraftId(): string {
  return `draft_${generateMessageId()}`;
}

export function isDraftId(value: string): boolean {
  const id = value.trim();
  return (
    id.startsWith("draft_") ||
    id === NEW_WORKSPACE_DRAFT_KEY ||
    id.startsWith(NEW_WORKSPACE_FORK_DRAFT_PREFIX)
  );
}

export function buildNewWorkspaceDraftKey(draftId?: string): string {
  const explicitDraftId = draftId?.trim();
  if (explicitDraftId) {
    return `${NEW_WORKSPACE_FORK_DRAFT_PREFIX}${explicitDraftId}`;
  }
  return NEW_WORKSPACE_DRAFT_KEY;
}

export function isLegacyNewWorkspaceDraftKey(draftKey: string): boolean {
  return (
    draftKey.startsWith(`${NEW_WORKSPACE_DRAFT_KEY}:`) &&
    !draftKey.startsWith(NEW_WORKSPACE_FORK_DRAFT_PREFIX)
  );
}

export function buildDraftStoreKey(input: {
  serverId: string;
  agentId: string;
  draftId?: string | null;
}): string {
  const serverId = input.serverId.trim();
  const explicitDraftId = input.draftId?.trim();
  if (explicitDraftId) {
    return `draft:${serverId}:${explicitDraftId}`;
  }
  return `agent:${serverId}:${input.agentId.trim()}`;
}
