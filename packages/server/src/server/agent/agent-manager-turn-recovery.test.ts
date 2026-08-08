import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager, type AgentManagerEvent } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentProvider,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentTimelineItem,
  ProviderCatalog,
} from "./agent-sdk-types.js";

/**
 * AgentManager turn auto-recovery: after a foreground turn ends abnormally
 * (rate limit / silent stream death), an automatic continuation prompt is
 * scheduled with backoff so unattended agents survive transient provider
 * failures. These tests drive scripted sessions with fake timers.
 */

const TEST_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

type TurnScript =
  | { kind: "abnormal" }
  | { kind: "normal" }
  | { kind: "canceled" }
  | { kind: "failed"; error: string };

function toolCallItem(): Extract<AgentTimelineItem, { type: "tool_call" }> {
  return {
    type: "tool_call",
    callId: "tool-1",
    name: "Bash",
    status: "completed",
    error: null,
    detail: { type: "shell", command: "printf ok", output: "ok", exitCode: 0 },
  };
}

function assistantItem(text = "done"): Extract<AgentTimelineItem, { type: "assistant_message" }> {
  return { type: "assistant_message", text, messageId: "m1" };
}

class ScriptedSession implements AgentSession {
  readonly capabilities = TEST_CAPABILITIES;
  readonly id: string;
  readonly prompts: AgentPromptInput[] = [];
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private turnCount = 0;

  constructor(
    readonly provider: AgentProvider,
    private readonly config: AgentSessionConfig,
    sessionId: string,
    private readonly scripts: TurnScript[],
  ) {
    this.id = sessionId;
  }

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(prompt: AgentPromptInput): Promise<{ turnId: string }> {
    this.prompts.push(prompt);
    const idx = Math.min(this.turnCount, this.scripts.length - 1);
    const script = this.scripts[idx];
    this.turnCount += 1;
    const turnId = `turn-${this.turnCount}`;
    // Deferred so the foreground waiter is registered before events arrive.
    setTimeout(() => {
      this.pushEvent({ type: "turn_started", provider: this.provider, turnId });
      switch (script.kind) {
        case "abnormal":
          this.pushEvent({
            type: "timeline",
            provider: this.provider,
            turnId,
            item: toolCallItem(),
          });
          this.pushEvent({ type: "turn_completed", provider: this.provider, turnId });
          break;
        case "normal":
          this.pushEvent({
            type: "timeline",
            provider: this.provider,
            turnId,
            item: assistantItem(),
          });
          this.pushEvent({ type: "turn_completed", provider: this.provider, turnId });
          break;
        case "canceled":
          this.pushEvent({
            type: "turn_canceled",
            provider: this.provider,
            reason: "user stop",
            turnId,
          });
          break;
        case "failed":
          this.pushEvent({
            type: "turn_failed",
            provider: this.provider,
            error: script.error,
            turnId,
          });
          break;
      }
    }, 0);
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  pushEvent(event: AgentStreamEvent): void {
    for (const callback of this.subscribers) {
      callback(event);
    }
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo() {
    return { provider: this.provider, sessionId: this.id, model: null, modeId: null };
  }

  async getAvailableModes() {
    return [];
  }

  async getCurrentMode() {
    return null;
  }

  async setMode(): Promise<void> {}

  getPendingPermissions() {
    return [];
  }

  async respondToPermission(): Promise<void> {}

  describePersistence(): AgentPersistenceHandle {
    return { provider: this.provider, sessionId: this.id };
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {}
}

class ScriptedClient implements AgentClient {
  readonly capabilities = TEST_CAPABILITIES;
  session: ScriptedSession | null = null;

  constructor(private readonly scripts: TurnScript[]) {}

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    this.session = new ScriptedSession(
      "codex",
      config,
      `session-${this.scripts.length}`,
      this.scripts,
    );
    return this.session;
  }

  async resumeSession(handle: AgentPersistenceHandle): Promise<AgentSession> {
    this.session = new ScriptedSession(
      "codex",
      { provider: "codex", cwd: process.cwd() },
      handle.sessionId,
      this.scripts,
    );
    return this.session;
  }

  async fetchCatalog(): Promise<ProviderCatalog> {
    return { models: [], modes: [] };
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

async function setupManager(scripts: TurnScript[]) {
  const workdir = mkdtempSync(join(tmpdir(), "agent-manager-recovery-"));
  const storage = new AgentStorage(join(workdir, "agents"), createTestLogger());
  const client = new ScriptedClient(scripts);
  const manager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    logger: createTestLogger(),
    idFactory: () => "00000000-0000-4000-8000-000000000999",
  });
  const agent = await manager.createAgent(
    { provider: "codex", cwd: workdir, title: "Recovery test" },
    undefined,
    { workspaceId: undefined },
  );
  return { manager, client, agent, workdir };
}

function recoveryNotices(manager: AgentManager, agentId: string): string[] {
  return manager
    .getTimeline(agentId)
    .filter(
      (item): item is Extract<AgentTimelineItem, { type: "assistant_message" }> =>
        item.type === "assistant_message" && item.text.includes("[自动续跑]"),
    )
    .map((item) => item.text);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("turn auto-recovery", () => {
  test("abnormal ending schedules an auto-continue that fires after the backoff delay", async () => {
    vi.useFakeTimers();
    const { manager, client, agent, workdir } = await setupManager([{ kind: "abnormal" }]);
    try {
      const run = manager.runAgent(agent.id, "hello");
      await vi.advanceTimersByTimeAsync(0);
      await run;

      expect(recoveryNotices(manager, agent.id).length).toBeGreaterThan(0);

      const promptsBefore = client.session?.prompts.length ?? 0;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(client.session?.prompts.length).toBe(promptsBefore + 1);
      expect(String(client.session?.prompts[promptsBefore])).toContain("请自动继续之前的任务");
    } finally {
      await manager.closeAgent(agent.id);
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test("normal completion does not schedule an auto-continue", async () => {
    vi.useFakeTimers();
    const { manager, client, agent, workdir } = await setupManager([{ kind: "normal" }]);
    try {
      const run = manager.runAgent(agent.id, "hello");
      await vi.advanceTimersByTimeAsync(0);
      await run;

      expect(recoveryNotices(manager, agent.id)).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(client.session?.prompts).toHaveLength(1);
    } finally {
      await manager.closeAgent(agent.id);
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test("user-canceled turns are never auto-continued", async () => {
    vi.useFakeTimers();
    const { manager, client, agent, workdir } = await setupManager([{ kind: "canceled" }]);
    try {
      const run = manager.runAgent(agent.id, "hello");
      await vi.advanceTimersByTimeAsync(0);
      await run;

      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(client.session?.prompts).toHaveLength(1);
    } finally {
      await manager.closeAgent(agent.id);
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test("failed turn with a transient 429 error is auto-continued", async () => {
    vi.useFakeTimers();
    const { manager, client, agent, workdir } = await setupManager([
      { kind: "failed", error: "429 too many requests (abc/session)" },
    ]);
    try {
      const run = manager.runAgent(agent.id, "hello").catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      await run;

      expect(recoveryNotices(manager, agent.id).length).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(client.session?.prompts).toHaveLength(2);
    } finally {
      await manager.closeAgent(agent.id);
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test("failed turn with a non-transient error is not auto-continued", async () => {
    vi.useFakeTimers();
    const { manager, client, agent, workdir } = await setupManager([
      { kind: "failed", error: "invalid model id" },
    ]);
    try {
      const run = manager.runAgent(agent.id, "hello").catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      await run;

      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(client.session?.prompts).toHaveLength(1);
    } finally {
      await manager.closeAgent(agent.id);
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test("a real user message cancels the pending auto-continue", async () => {
    vi.useFakeTimers();
    const { manager, client, agent, workdir } = await setupManager([
      { kind: "abnormal" },
      { kind: "normal" },
    ]);
    try {
      const first = manager.runAgent(agent.id, "hello");
      await vi.advanceTimersByTimeAsync(0);
      await first;
      expect(recoveryNotices(manager, agent.id).length).toBeGreaterThan(0);

      // User takes over with a new message before the backoff timer fires.
      const second = manager.runAgent(agent.id, "never mind");
      await vi.advanceTimersByTimeAsync(0);
      await second;

      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(client.session?.prompts).toHaveLength(2);
    } finally {
      await manager.closeAgent(agent.id);
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test("repeated abnormal endings exhaust attempts and flag requiresAttention", async () => {
    vi.useFakeTimers();
    const { manager, client, agent, workdir } = await setupManager([{ kind: "abnormal" }]);
    try {
      const run = manager.runAgent(agent.id, "hello");
      await vi.advanceTimersByTimeAsync(0);
      await run;

      // One long advance fires the whole backoff chain (15s→30s→60s→120s→240s,
      // cumulative ~465s), each continuation ending abnormally again, until
      // attempts are exhausted.
      await vi.advanceTimersByTimeAsync(600_000);

      const snapshot = manager.getAgent(agent.id);
      expect(snapshot?.attention.requiresAttention).toBe(true);
      expect(snapshot?.attention.attentionReason).toBe("error");
      expect(recoveryNotices(manager, agent.id).some((notice) => notice.includes("已达上限"))).toBe(
        true,
      );

      // No further auto-continue after exhaustion.
      const promptsAfter = client.session?.prompts.length ?? 0;
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(client.session?.prompts.length).toBe(promptsAfter);
    } finally {
      await manager.closeAgent(agent.id);
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test("recovery notices are streamed to subscribers", async () => {
    vi.useFakeTimers();
    const { manager, agent, workdir } = await setupManager([{ kind: "abnormal" }]);
    try {
      const streamed: AgentManagerEvent[] = [];
      manager.subscribe((event) => {
        streamed.push(event);
      });

      const run = manager.runAgent(agent.id, "hello");
      await vi.advanceTimersByTimeAsync(0);
      await run;

      const hasNotice = streamed.some(
        (event) =>
          event.type === "agent_stream" &&
          event.event.type === "timeline" &&
          event.event.item.type === "assistant_message" &&
          event.event.item.text.includes("[自动续跑]"),
      );
      expect(hasNotice).toBe(true);
    } finally {
      await manager.closeAgent(agent.id);
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
