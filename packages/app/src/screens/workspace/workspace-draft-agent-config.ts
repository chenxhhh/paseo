import type {
  CreateAgentRequestOptions,
  CreateWorkspaceRequestOptions,
} from "@getpaseo/client/internal/daemon-client";
import type { AgentSessionConfig } from "@getpaseo/protocol/agent-types";

export interface WorkspaceDraftAgentRequestIntent {
  workspaceId?: string;
  config: AgentSessionConfig;
  initialPrompt?: string;
  clientMessageId?: string;
  images?: unknown[];
  attachments?: unknown[];
}

const initialIntentFingerprintByScopeKey = new Map<string, string>();

function canonicalizeJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)))
      : nested,
  );
}

function hashString64Hex(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export function buildWorkspaceDraftAgentConfig(input: {
  provider: AgentSessionConfig["provider"];
  cwd: string;
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}): AgentSessionConfig {
  const hasFeatureValues =
    input.featureValues !== undefined && Object.keys(input.featureValues).length > 0;
  return {
    provider: input.provider,
    cwd: input.cwd,
    ...(input.modeId ? { modeId: input.modeId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.thinkingOptionId ? { thinkingOptionId: input.thinkingOptionId } : {}),
    ...(hasFeatureValues ? { featureValues: input.featureValues } : {}),
  };
}

export function serializeWorkspaceDraftAgentIntent(
  input: WorkspaceDraftAgentRequestIntent,
  options?: { cwdOverride?: string; trimInitialPrompt?: boolean; includeWorkspaceId?: boolean },
): string {
  const config = buildWorkspaceDraftAgentConfig({
    ...input.config,
    cwd: options?.cwdOverride ?? input.config.cwd,
  });
  const initialPrompt = options?.trimInitialPrompt
    ? (input.initialPrompt ?? "").trim()
    : (input.initialPrompt ?? "");
  return canonicalizeJson({
    ...(options?.includeWorkspaceId !== false && input.workspaceId
      ? { workspaceId: input.workspaceId }
      : {}),
    config,
    initialPrompt,
    ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
  });
}

export function matchesWorkspaceInitialAgentIntent(input: {
  initialAgent: WorkspaceDraftAgentRequestIntent;
  retryRequest: WorkspaceDraftAgentRequestIntent;
}): boolean {
  const initialCwd = input.initialAgent.config.cwd;
  return (
    serializeWorkspaceDraftAgentIntent(input.initialAgent, {
      cwdOverride: initialCwd,
      trimInitialPrompt: true,
      includeWorkspaceId: false,
    }) ===
    serializeWorkspaceDraftAgentIntent(input.retryRequest, {
      cwdOverride: initialCwd,
      trimInitialPrompt: true,
      includeWorkspaceId: false,
    })
  );
}

export function buildModifiedDraftIdempotencyKey(draftId: string, fingerprint: string): string {
  const normalizedDraftId = draftId.trim();
  return `${normalizedDraftId}:${hashString64Hex(fingerprint)}`;
}

export function resolveDraftAgentRequestIdempotencyKey(input: {
  draftId: string;
  request: WorkspaceDraftAgentRequestIntent;
}): string {
  const normalizedDraftId = input.draftId.trim();
  if (!normalizedDraftId) return input.draftId;
  const scopeKey = `agent:${normalizedDraftId}`;
  const fingerprint = serializeWorkspaceDraftAgentIntent(input.request, {
    trimInitialPrompt: true,
  });
  const initialFingerprint = initialIntentFingerprintByScopeKey.get(scopeKey);
  if (!initialFingerprint) {
    initialIntentFingerprintByScopeKey.set(scopeKey, fingerprint);
    return normalizedDraftId;
  }
  if (initialFingerprint === fingerprint) {
    return normalizedDraftId;
  }
  return buildModifiedDraftIdempotencyKey(normalizedDraftId, fingerprint);
}

export function resolveWorkspaceCreationIdempotencyKey(input: {
  draftId: string;
  request: Record<string, unknown>;
}): string {
  const normalizedDraftId = input.draftId.trim();
  if (!normalizedDraftId) return input.draftId;
  const scopeKey = `workspace:${normalizedDraftId}`;
  const fingerprint = canonicalizeJson(input.request);
  const initialFingerprint = initialIntentFingerprintByScopeKey.get(scopeKey);
  if (!initialFingerprint) {
    initialIntentFingerprintByScopeKey.set(scopeKey, fingerprint);
    return normalizedDraftId;
  }
  if (initialFingerprint === fingerprint) {
    return normalizedDraftId;
  }
  return buildModifiedDraftIdempotencyKey(normalizedDraftId, fingerprint);
}

export function clearDraftRequestIdempotencyKeys(draftId?: string): void {
  if (!draftId) {
    initialIntentFingerprintByScopeKey.clear();
    return;
  }
  const normalizedDraftId = draftId.trim();
  if (!normalizedDraftId) return;
  initialIntentFingerprintByScopeKey.delete(`agent:${normalizedDraftId}`);
  initialIntentFingerprintByScopeKey.delete(`workspace:${normalizedDraftId}`);
}

export function retryWorkspaceInitialAgentCreation<TResult>(input: {
  draftId: string;
  createdWorkspaceId?: string | null;
  initialAgent: NonNullable<CreateWorkspaceRequestOptions["agent"]>;
  retryRequest: CreateAgentRequestOptions;
  retryWorkspaceCreation: (
    agent: NonNullable<CreateWorkspaceRequestOptions["agent"]>,
  ) => Promise<TResult>;
  createAgentInWorkspace: (request: CreateAgentRequestOptions) => Promise<TResult>;
}): Promise<TResult> {
  const workspaceId = input.retryRequest.workspaceId ?? input.createdWorkspaceId ?? undefined;
  const initialConfig = input.initialAgent.config;
  const retryConfig = input.retryRequest.config;
  if (
    !workspaceId ||
    !initialConfig ||
    !retryConfig ||
    matchesWorkspaceInitialAgentIntent({
      initialAgent: {
        ...input.initialAgent,
        config: initialConfig,
      },
      retryRequest: {
        ...input.retryRequest,
        config: retryConfig,
      },
    })
  ) {
    return input.retryWorkspaceCreation(input.initialAgent);
  }
  const fingerprint = serializeWorkspaceDraftAgentIntent(
    {
      ...input.retryRequest,
      workspaceId,
      config: retryConfig,
    },
    { trimInitialPrompt: true },
  );
  return input.createAgentInWorkspace({
    ...input.retryRequest,
    workspaceId,
    idempotencyKey: buildModifiedDraftIdempotencyKey(input.draftId, fingerprint),
  });
}
