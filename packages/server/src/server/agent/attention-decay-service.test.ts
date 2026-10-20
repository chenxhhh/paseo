import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentStorage, type StoredAgentRecord } from "./agent-storage.js";
import {
  AttentionDecayService,
  type AttentionDecayAgentAccess,
  type LiveAttention,
} from "./attention-decay-service.js";

const logger = createTestLogger();

const NOW = new Date("2026-08-24T03:00:00.000Z");
const EXPIRED_AT = new Date("2026-08-24T00:00:00.000Z");

function storedRecord(overrides: Partial<StoredAgentRecord> = {}): StoredAgentRecord {
  return {
    id: "agent-1",
    provider: "codex",
    cwd: "/tmp/repo",
    workspaceId: "ws-1",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    labels: {},
    lastStatus: "idle",
    config: null,
    requiresAttention: true,
    attentionReason: "finished",
    attentionTimestamp: EXPIRED_AT.toISOString(),
    ...overrides,
  };
}

async function makeStorage(records: StoredAgentRecord[]): Promise<AgentStorage> {
  const dir = mkdtempSync(join(tmpdir(), "attention-decay-"));
  const storage = new AgentStorage(join(dir, "agents"), logger);
  await storage.initialize();
  for (const record of records) {
    await storage.upsert(record);
  }
  return storage;
}

interface LiveAgentFixture {
  attention: LiveAttention;
  pendingPermissions?: Map<string, unknown>;
}

function fakeAgentAccess(
  live: Record<string, LiveAgentFixture>,
): AttentionDecayAgentAccess & { cleared: string[] } {
  const cleared: string[] = [];
  return {
    cleared,
    getAgent: (agentId: string) => {
      const fixture = live[agentId];
      return fixture
        ? {
            attention: fixture.attention,
            pendingPermissions: fixture.pendingPermissions ?? new Map(),
          }
        : null;
    },
    clearAgentAttention: async (agentId: string) => {
      cleared.push(agentId);
    },
  };
}

function makeService(options: {
  storage: AgentStorage;
  live?: Record<string, LiveAgentFixture>;
  now?: Date;
  decayAfterMs?: number;
}): {
  service: AttentionDecayService;
  access: ReturnType<typeof fakeAgentAccess>;
  broadcasts: unknown[];
  workspaceUpdates: string[][];
} {
  const access = fakeAgentAccess(options.live ?? {});
  const broadcasts: unknown[] = [];
  const workspaceUpdates: string[][] = [];
  const service = new AttentionDecayService({
    agentManager: access,
    agentStorage: options.storage,
    logger,
    registeredProviderIds: () => ["codex"],
    broadcast: (message) => broadcasts.push(message),
    emitWorkspaceUpdates: async (workspaceIds) => {
      workspaceUpdates.push(workspaceIds);
    },
    now: () => options.now ?? NOW,
    ...(options.decayAfterMs === undefined ? {} : { decayAfterMs: options.decayAfterMs }),
  });
  return { service, access, broadcasts, workspaceUpdates };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AttentionDecayService.runSweep", () => {
  it("clears expired finished attention on a stored agent and announces it", async () => {
    const storage = await makeStorage([storedRecord()]);
    const { service, broadcasts, workspaceUpdates } = makeService({ storage });

    const decayed = await service.runSweep();

    expect(decayed).toBe(1);
    const record = await storage.get("agent-1");
    expect(record?.requiresAttention).toBe(false);
    expect(record?.attentionReason).toBeNull();
    expect(record?.attentionTimestamp).toBeNull();

    expect(broadcasts).toHaveLength(1);
    const broadcast = broadcasts[0] as {
      type: string;
      payload: {
        kind: string;
        agent: { id: string; requiresAttention: boolean | undefined };
        project: unknown;
      };
    };
    expect(broadcast.type).toBe("agent_update");
    expect(broadcast.payload.kind).toBe("upsert");
    expect(broadcast.payload.agent.id).toBe("agent-1");
    expect(broadcast.payload.agent.requiresAttention).toBe(false);
    expect(broadcast.payload.project).toBeNull();
    expect(workspaceUpdates).toEqual([["ws-1"]]);
  });

  it("clears a live agent through the manager instead of rewriting storage", async () => {
    const storage = await makeStorage([storedRecord()]);
    const { service, access, broadcasts, workspaceUpdates } = makeService({
      storage,
      live: {
        "agent-1": {
          attention: {
            requiresAttention: true,
            attentionReason: "finished",
            attentionTimestamp: EXPIRED_AT,
          },
        },
      },
    });

    const decayed = await service.runSweep();

    expect(decayed).toBe(1);
    expect(access.cleared).toEqual(["agent-1"]);
    expect(broadcasts).toHaveLength(0);
    expect(workspaceUpdates).toHaveLength(0);
  });

  it("never decays error attention", async () => {
    const storage = await makeStorage([
      storedRecord({ id: "agent-error", attentionReason: "error" }),
    ]);
    const { service } = makeService({ storage });

    expect(await service.runSweep()).toBe(0);
    const record = await storage.get("agent-error");
    expect(record?.requiresAttention).toBe(true);
  });

  it("never decays permission attention", async () => {
    const storage = await makeStorage([
      storedRecord({ id: "agent-permission", attentionReason: "permission" }),
    ]);
    const { service } = makeService({ storage });

    expect(await service.runSweep()).toBe(0);
    expect((await storage.get("agent-permission"))?.requiresAttention).toBe(true);
  });

  it("keeps attention that has not reached the threshold, and decays at exactly it", async () => {
    const storage = await makeStorage([
      storedRecord({
        id: "agent-almost",
        attentionTimestamp: new Date(NOW.getTime() - 999).toISOString(),
      }),
      storedRecord({
        id: "agent-exact",
        attentionTimestamp: new Date(NOW.getTime() - 1000).toISOString(),
      }),
    ]);
    const { service } = makeService({ storage, decayAfterMs: 1000 });

    expect(await service.runSweep()).toBe(1);
    expect((await storage.get("agent-almost"))?.requiresAttention).toBe(true);
    expect((await storage.get("agent-exact"))?.requiresAttention).toBe(false);
  });

  it("skips archived agents", async () => {
    const storage = await makeStorage([
      storedRecord({ id: "agent-archived", archivedAt: "2026-08-24T01:00:00.000Z" }),
    ]);
    const { service } = makeService({ storage });

    expect(await service.runSweep()).toBe(0);
    expect((await storage.get("agent-archived"))?.requiresAttention).toBe(true);
  });

  it("skips a live agent that is waiting on a permission response", async () => {
    const storage = await makeStorage([storedRecord()]);
    const { service, access } = makeService({
      storage,
      live: {
        "agent-1": {
          attention: {
            requiresAttention: true,
            attentionReason: "finished",
            attentionTimestamp: EXPIRED_AT,
          },
          pendingPermissions: new Map([["perm-1", { kind: "mcp" }]]),
        },
      },
    });

    expect(await service.runSweep()).toBe(0);
    expect(access.cleared).toEqual([]);
  });

  it("re-checks the live attention so a stale stored record cannot decay fresh work", async () => {
    const storage = await makeStorage([storedRecord()]);
    const freshFinish = new Date(NOW.getTime() - 60_000);
    const { service, access } = makeService({
      storage,
      live: {
        "agent-1": {
          attention: {
            requiresAttention: true,
            attentionReason: "finished",
            attentionTimestamp: freshFinish,
          },
        },
      },
    });

    expect(await service.runSweep()).toBe(0);
    expect(access.cleared).toEqual([]);
  });
});

describe("AttentionDecayService.start", () => {
  it("runs the backfill sweep immediately and stops cleanly", async () => {
    const storage = await makeStorage([storedRecord()]);
    const { service } = makeService({ storage });

    service.start();
    await vi.waitFor(async () => {
      expect((await storage.get("agent-1"))?.requiresAttention).toBe(false);
    });
    service.stop();
  });
});
