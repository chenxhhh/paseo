import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWorkspaceDraftAgentConfig,
  clearDraftRequestIdempotencyKeys,
  resolveDraftAgentRequestIdempotencyKey,
  resolveWorkspaceCreationIdempotencyKey,
  retryWorkspaceInitialAgentCreation,
} from "./workspace-draft-agent-config";

describe("workspace-draft-agent-config", () => {
  beforeEach(() => {
    clearDraftRequestIdempotencyKeys();
  });

  it("builds chat-only config for workspace draft agents and omits empty featureValues", () => {
    expect(
      buildWorkspaceDraftAgentConfig({
        provider: "codex",
        cwd: "/tmp/project",
        modeId: "auto",
        model: "gpt-5.4",
        thinkingOptionId: "high",
        featureValues: {},
      }),
    ).toEqual({
      provider: "codex",
      cwd: "/tmp/project",
      modeId: "auto",
      model: "gpt-5.4",
      thinkingOptionId: "high",
    });
  });

  it("replays initial workspace+agent creation when retrying without modifying agent parameters", async () => {
    const initialAgent = {
      config: buildWorkspaceDraftAgentConfig({
        provider: "custom",
        cwd: "/repo/source",
        modeId: "creator",
        model: "glm-5",
      }),
      initialPrompt: "  hello world  ",
      clientMessageId: "draft_1:initial-message",
    };
    const retryWorkspaceCreation = vi.fn(async (_agent) => ({ id: "agent_1" }));
    const createAgentInWorkspace = vi.fn(async (_request) => ({ id: "agent_2" }));

    await retryWorkspaceInitialAgentCreation({
      draftId: "draft_1",
      createdWorkspaceId: "ws_1",
      initialAgent,
      retryRequest: {
        idempotencyKey: "draft_1",
        workspaceId: "ws_1",
        config: {
          provider: "custom",
          cwd: "/worktrees/ws_1",
          modeId: "creator",
          model: "glm-5",
          featureValues: {},
        },
        initialPrompt: "hello world",
        clientMessageId: "draft_1:initial-message",
      },
      retryWorkspaceCreation,
      createAgentInWorkspace,
    });

    expect(retryWorkspaceCreation).toHaveBeenCalledTimes(1);
    expect(retryWorkspaceCreation).toHaveBeenCalledWith(initialAgent);
    expect(createAgentInWorkspace).not.toHaveBeenCalled();
  });

  it("switches to createAgent in the created workspace with a scoped idempotencyKey when retrying with modified parameters", async () => {
    const initialAgent = {
      config: buildWorkspaceDraftAgentConfig({
        provider: "custom",
        cwd: "/repo/source",
        modeId: "creator",
        model: "glm-5",
      }),
      initialPrompt: "hello world",
      clientMessageId: "draft_1:initial-message",
    };
    const retryWorkspaceCreation = vi.fn(async () => ({ id: "agent_ws" }));
    const createAgentInWorkspace = vi.fn(async (_request) => ({ id: "agent_direct" }));

    const modifiedRequest = {
      idempotencyKey: "draft_1",
      workspaceId: "ws_1",
      config: {
        provider: "custom" as const,
        cwd: "/worktrees/ws_1",
        modeId: "standard",
        model: "glm-5",
      },
      initialPrompt: "hello world",
      clientMessageId: "draft_1:initial-message",
    };

    await retryWorkspaceInitialAgentCreation({
      draftId: "draft_1",
      createdWorkspaceId: "ws_1",
      initialAgent,
      retryRequest: modifiedRequest,
      retryWorkspaceCreation,
      createAgentInWorkspace,
    });

    expect(retryWorkspaceCreation).not.toHaveBeenCalled();
    expect(createAgentInWorkspace).toHaveBeenCalledTimes(1);
    const firstCall = createAgentInWorkspace.mock.calls[0]![0];
    expect(firstCall.workspaceId).toBe("ws_1");
    expect(firstCall.config).toEqual(modifiedRequest.config);
    expect(firstCall.idempotencyKey).toMatch(/^draft_1:[0-9a-f]{16}$/);

    // Retrying the exact same modified request reuses the same scoped idempotencyKey.
    await retryWorkspaceInitialAgentCreation({
      draftId: "draft_1",
      createdWorkspaceId: "ws_1",
      initialAgent,
      retryRequest: modifiedRequest,
      retryWorkspaceCreation,
      createAgentInWorkspace,
    });
    const secondCall = createAgentInWorkspace.mock.calls[1]![0];
    expect(secondCall.idempotencyKey).toBe(firstCall.idempotencyKey);

    // Modifying parameters a second time generates a new non-conflicting idempotencyKey.
    await retryWorkspaceInitialAgentCreation({
      draftId: "draft_1",
      createdWorkspaceId: "ws_1",
      initialAgent,
      retryRequest: {
        ...modifiedRequest,
        initialPrompt: "updated prompt",
      },
      retryWorkspaceCreation,
      createAgentInWorkspace,
    });
    const thirdCall = createAgentInWorkspace.mock.calls[2]![0];
    expect(thirdCall.idempotencyKey).toMatch(/^draft_1:[0-9a-f]{16}$/);
    expect(thirdCall.idempotencyKey).not.toBe(firstCall.idempotencyKey);
  });

  it("preserves draftId for initial and unmodified standalone agent draft attempts, and scopes modified retries", () => {
    const firstKey = resolveDraftAgentRequestIdempotencyKey({
      draftId: "draft_standalone",
      request: {
        workspaceId: "ws_1",
        config: { provider: "custom", cwd: "/repo", modeId: "creator" },
        initialPrompt: "hello",
        clientMessageId: "draft_standalone:initial-message",
      },
    });
    expect(firstKey).toBe("draft_standalone");

    const unmodifiedRetryKey = resolveDraftAgentRequestIdempotencyKey({
      draftId: "draft_standalone",
      request: {
        workspaceId: "ws_1",
        config: { provider: "custom", cwd: "/repo", modeId: "creator", featureValues: {} },
        initialPrompt: "  hello ",
        clientMessageId: "draft_standalone:initial-message",
      },
    });
    expect(unmodifiedRetryKey).toBe("draft_standalone");

    const modifiedRetryKey = resolveDraftAgentRequestIdempotencyKey({
      draftId: "draft_standalone",
      request: {
        workspaceId: "ws_1",
        config: { provider: "custom", cwd: "/repo", modeId: "standard" },
        initialPrompt: "hello",
        clientMessageId: "draft_standalone:initial-message",
      },
    });
    expect(modifiedRetryKey).toMatch(/^draft_standalone:[0-9a-f]{16}$/);
  });

  it("preserves draftId for identical workspace creation attempts and scopes modified retries", () => {
    const firstKey = resolveWorkspaceCreationIdempotencyKey({
      draftId: "draft_ws",
      request: {
        source: { kind: "directory", path: "/repo", projectId: "proj_1" },
        agent: { config: { provider: "custom", cwd: "/repo", modeId: "creator" } },
      },
    });
    expect(firstKey).toBe("draft_ws");

    const duplicateClickKey = resolveWorkspaceCreationIdempotencyKey({
      draftId: "draft_ws",
      request: {
        source: { kind: "directory", path: "/repo", projectId: "proj_1" },
        agent: { config: { provider: "custom", cwd: "/repo", modeId: "creator" } },
      },
    });
    expect(duplicateClickKey).toBe("draft_ws");

    const modifiedKey = resolveWorkspaceCreationIdempotencyKey({
      draftId: "draft_ws",
      request: {
        source: { kind: "directory", path: "/repo", projectId: "proj_1" },
        agent: { config: { provider: "custom", cwd: "/repo", modeId: "standard" } },
      },
    });
    expect(modifiedKey).toMatch(/^draft_ws:[0-9a-f]{16}$/);
  });
});
