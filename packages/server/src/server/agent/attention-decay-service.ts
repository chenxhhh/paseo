import type { Logger } from "pino";
import type { SessionOutboundMessage } from "../messages.js";
import { buildStoredAgentPayload } from "./agent-projections.js";
import type { AgentStorage, StoredAgentRecord } from "./agent-storage.js";
import type { AgentProvider } from "./agent-sdk-types.js";

/**
 * Finished-work attention decays after this long without a view, so a green "ready to review" dot
 * from hours ago cannot pile up on workspaces nobody opened. Errors and permission waits never
 * decay — they say something is wrong, not that work was finished and ignored.
 */
export const ATTENTION_FINISHED_DECAY_MS = 2 * 60 * 60 * 1000;

export const ATTENTION_DECAY_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** The attention slice of a live managed agent. `AttentionState` in agent-manager.ts is not exported. */
export type LiveAttention =
  | { requiresAttention: false }
  | {
      requiresAttention: true;
      attentionReason: "finished" | "error" | "permission";
      attentionTimestamp: Date;
    };

interface LiveAgentAttentionView {
  attention: LiveAttention;
  pendingPermissions: Map<string, unknown>;
}

/** The manager surface the sweep needs. Narrowed so tests can supply it without a full AgentManager. */
export interface AttentionDecayAgentAccess {
  getAgent(agentId: string): LiveAgentAttentionView | null;
  clearAgentAttention(agentId: string): Promise<void>;
}

export interface AttentionDecayServiceOptions {
  agentManager: AttentionDecayAgentAccess;
  agentStorage: Pick<AgentStorage, "list" | "upsert">;
  logger: Logger;
  /** Registered provider ids, for the same provider-availability projection sessions send. */
  registeredProviderIds: () => Iterable<AgentProvider>;
  /** Broadcasts one session message to every trusted client. */
  broadcast: (message: SessionOutboundMessage) => void;
  /** Recomputes and pushes workspace descriptors for the given workspaces. */
  emitWorkspaceUpdates: (workspaceIds: string[]) => Promise<void>;
  decayAfterMs?: number;
  sweepIntervalMs?: number;
  now?: () => Date;
}

/**
 * Periodically clears `finished` agent attention that nobody has looked at for
 * {@link ATTENTION_FINISHED_DECAY_MS}. Live agents clear through AgentManager so the usual
 * agent-update and workspace-recompute chain fires; closed agents are rewritten in storage and
 * announced with a raw agent update, the same shape `workspace.clear_attention` uses for stored
 * agents. The sweep is silent: it never fires the attention-required notification path.
 */
export class AttentionDecayService {
  private readonly agentManager: AttentionDecayAgentAccess;
  private readonly agentStorage: Pick<AgentStorage, "list" | "upsert">;
  private readonly logger: Logger;
  private readonly registeredProviderIds: () => Iterable<AgentProvider>;
  private readonly broadcast: (message: SessionOutboundMessage) => void;
  private readonly emitWorkspaceUpdates: (workspaceIds: string[]) => Promise<void>;
  private readonly decayAfterMs: number;
  private readonly sweepIntervalMs: number;
  private readonly now: () => Date;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(options: AttentionDecayServiceOptions) {
    this.agentManager = options.agentManager;
    this.agentStorage = options.agentStorage;
    this.logger = options.logger.child({ module: "attention-decay-service" });
    this.registeredProviderIds = options.registeredProviderIds;
    this.broadcast = options.broadcast;
    this.emitWorkspaceUpdates = options.emitWorkspaceUpdates;
    this.decayAfterMs = options.decayAfterMs ?? ATTENTION_FINISHED_DECAY_MS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? ATTENTION_DECAY_SWEEP_INTERVAL_MS;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.intervalHandle) {
      return;
    }
    // The first pass is the restart backfill: attention that expired while the daemon was down
    // clears before any interval tick.
    void this.runSweep().catch((error: unknown) => {
      this.logger.warn({ err: error }, "Attention decay backfill failed");
    });
    this.intervalHandle = setInterval(() => {
      void this.runSweep().catch((error: unknown) => {
        this.logger.warn({ err: error }, "Attention decay sweep failed");
      });
    }, this.sweepIntervalMs);
    this.intervalHandle.unref?.();
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async runSweep(): Promise<number> {
    const now = this.now().getTime();
    const records = await this.agentStorage.list();
    const touchedWorkspaceIds = new Set<string>();
    let decayedCount = 0;

    for (const record of records) {
      try {
        if (!isExpiredFinishedAttentionRecord(record, now, this.decayAfterMs)) {
          continue;
        }
        const live = this.agentManager.getAgent(record.id);
        if (live) {
          if (
            !live.attention.requiresAttention ||
            live.attention.attentionReason !== "finished" ||
            now - live.attention.attentionTimestamp.getTime() < this.decayAfterMs
          ) {
            continue;
          }
          // A pending permission response outranks decay — the workspace still needs input.
          if (live.pendingPermissions.size > 0) {
            continue;
          }
          await this.agentManager.clearAgentAttention(record.id);
        } else {
          const nextRecord: StoredAgentRecord = {
            ...record,
            updatedAt: new Date(now).toISOString(),
            requiresAttention: false,
            attentionReason: null,
            attentionTimestamp: null,
          };
          await this.agentStorage.upsert(nextRecord);
          this.broadcast({
            type: "agent_update",
            payload: {
              kind: "upsert",
              agent: buildStoredAgentPayload(nextRecord, this.registeredProviderIds()),
              // Placement is optional on the wire and clients refresh it from the workspace
              // descriptor this sweep also pushes.
              project: null,
            },
          });
          // The live branch's clearAgentAttention already fans the workspace recompute out through
          // the manager's own chain; only the stored rewrite needs the external push.
          if (record.workspaceId) {
            touchedWorkspaceIds.add(record.workspaceId);
          }
        }
        decayedCount++;
      } catch (error) {
        this.logger.warn({ err: error, agentId: record.id }, "Failed to decay agent attention");
      }
    }

    if (touchedWorkspaceIds.size > 0) {
      await this.emitWorkspaceUpdates([...touchedWorkspaceIds]);
    }
    if (decayedCount > 0) {
      this.logger.info({ decayedCount }, "Decayed finished agent attention");
    }
    return decayedCount;
  }
}

/**
 * Record-level gate before the live/stored split. Archived and internal agents keep whatever the
 * archive path left behind, and only `finished` attention is decay-eligible.
 */
function isExpiredFinishedAttentionRecord(
  record: StoredAgentRecord,
  nowMs: number,
  decayAfterMs: number,
): boolean {
  if (record.internal || record.archivedAt) {
    return false;
  }
  if (record.requiresAttention !== true || record.attentionReason !== "finished") {
    return false;
  }
  if (!record.attentionTimestamp) {
    return false;
  }
  const attentionAtMs = Date.parse(record.attentionTimestamp);
  if (Number.isNaN(attentionAtMs)) {
    return false;
  }
  return nowMs - attentionAtMs >= decayAfterMs;
}
