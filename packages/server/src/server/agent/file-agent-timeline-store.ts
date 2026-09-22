import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Logger } from "pino";
import { z } from "zod";

import { AgentTimelineItemPayloadSchema } from "@getpaseo/protocol/messages";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { TimelineProjection, selectProjectedTimelinePage } from "./timeline-projection.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
} from "./agent-timeline-store-types.js";

const DEFAULT_TIMELINE_FETCH_LIMIT = 200;

const TimelineRowSchema: z.ZodType<AgentTimelineRow, unknown> = z.object({
  seq: z.number().int().positive(),
  timestamp: z.string(),
  item: AgentTimelineItemPayloadSchema,
  turnId: z.string().optional(),
  providerMessageId: z.string().optional(),
});

export interface FileAgentTimelineStoreOptions {
  logger?: Logger;
}

function cloneRow(row: AgentTimelineRow): AgentTimelineRow {
  return { ...row, item: structuredClone(row.item) };
}

function encodeRow(row: AgentTimelineRow): string {
  return JSON.stringify({
    seq: row.seq,
    timestamp: row.timestamp,
    item: row.item,
    ...(row.turnId !== undefined ? { turnId: row.turnId } : {}),
    ...(row.providerMessageId !== undefined ? { providerMessageId: row.providerMessageId } : {}),
  });
}

function parseRow(line: string): AgentTimelineRow | null {
  try {
    return TimelineRowSchema.parse(JSON.parse(line));
  } catch {
    return null;
  }
}

function fileNameForAgent(agentId: string): string {
  return `agent-${Buffer.from(agentId, "utf8").toString("base64url")}.jsonl`;
}

/**
 * Durable timeline rows, one append-only JSONL file per agent.
 *
 * The previous file-backed store (#3647) rewrote the whole transcript on every
 * buffered update; appends here only write the new rows. A crash can tear the
 * final line, so loads skip unparsable lines instead of failing the agent.
 * Mutations per agent are serialized through a promise tail so concurrent
 * fire-and-forget appends cannot interleave or lose updates.
 */
export class FileAgentTimelineStore implements AgentTimelineStore {
  private readonly rowsByAgent = new Map<string, AgentTimelineRow[]>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly mutationTails = new Map<string, Promise<void>>();
  private readonly epochs = new Map<string, string>();
  private ready: Promise<void> | null = null;

  constructor(
    private readonly directory: string,
    private readonly options?: FileAgentTimelineStoreOptions,
  ) {}

  async appendCommitted(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string; turnId?: string },
  ): Promise<AgentTimelineRow> {
    let row!: AgentTimelineRow;
    await this.runMutation(agentId, async () => {
      const current = await this.load(agentId);
      row = {
        seq: (current.at(-1)?.seq ?? 0) + 1,
        timestamp: options?.timestamp ?? new Date().toISOString(),
        item: structuredClone(item),
        ...(options?.turnId ? { turnId: options.turnId } : {}),
      };
      await this.appendRows(agentId, current, [TimelineRowSchema.parse(row)]);
    });
    return row;
  }

  async bulkInsert(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void> {
    if (rows.length === 0) return;
    const parsed = rows.map((row) => TimelineRowSchema.parse(row));
    await this.runMutation(agentId, async () => {
      const current = await this.load(agentId);
      if (rowsAreContiguousAfter(current, parsed)) {
        await this.appendRows(agentId, current, parsed);
        return;
      }
      await this.rewriteRows(agentId, mergeRows(current, parsed));
    });
  }

  async fetchCommitted(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult> {
    const rows = await this.getCommittedRows(agentId);
    const projection = new TimelineProjection();
    for (const row of rows) projection.append(row);
    const projected = projection.getRows();
    const nextSeq = (rows.at(-1)?.seq ?? 0) + 1;
    const minSeq = projected[0]?.seqStart ?? nextSeq;
    const epoch = this.epochFor(agentId);
    const direction = options?.direction ?? "tail";
    const cursor = options?.cursor;
    const staleCursor = cursor !== undefined && cursor.epoch !== epoch;
    const gap =
      !staleCursor &&
      direction === "after" &&
      cursor !== undefined &&
      projected.length > 0 &&
      cursor.seq < minSeq - 1;
    const reset = staleCursor || gap;
    const page = selectProjectedTimelinePage({
      rows: projected,
      bounds: { minSeq, maxSeq: nextSeq - 1 },
      direction: reset ? "tail" : direction,
      cursorSeq: cursor?.seq,
      limit: options?.limit ?? DEFAULT_TIMELINE_FETCH_LIMIT,
    });
    return {
      epoch,
      direction,
      reset,
      staleCursor,
      gap,
      window: { minSeq, maxSeq: nextSeq - 1, nextSeq },
      hasOlder: page.hasOlder,
      hasNewer: page.hasNewer,
      startSeq: page.startSeq,
      endSeq: page.endSeq,
      rows: page.entries.map((entry) => Object.assign({ seq: entry.seqEnd }, entry)),
    };
  }

  async getLatestCommittedSeq(agentId: string): Promise<number> {
    const rows = await this.load(agentId);
    return rows.at(-1)?.seq ?? 0;
  }

  async getCommittedRows(agentId: string): Promise<AgentTimelineRow[]> {
    const rows = await this.load(agentId);
    return rows.map(cloneRow);
  }

  async getLastItem(agentId: string): Promise<AgentTimelineRow["item"] | null> {
    const rows = await this.load(agentId);
    const item = rows.at(-1)?.item;
    return item ? structuredClone(item) : null;
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    const rows = await this.load(agentId);
    const chunks: string[] = [];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const item = rows[index]!.item;
      if (item.type !== "assistant_message") {
        if (chunks.length > 0) break;
        continue;
      }
      chunks.push(item.text);
    }
    return chunks.length > 0 ? chunks.toReversed().join("") : null;
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.runMutation(agentId, async () => {
      await rm(this.filePath(agentId), { force: true });
      this.rowsByAgent.delete(agentId);
      this.epochs.delete(agentId);
    });
  }

  async updateCommittedRow(agentId: string, row: AgentTimelineRow): Promise<void> {
    const parsed = TimelineRowSchema.parse(row);
    await this.runMutation(agentId, async () => {
      const current = await this.load(agentId);
      const index = current.findIndex((candidate) => candidate.seq === parsed.seq);
      if (index < 0) {
        throw new Error(`Cannot update missing timeline row sequence ${parsed.seq}`);
      }
      const next = [...current];
      next[index] = cloneRow(parsed);
      await this.rewriteRows(agentId, next);
    });
  }

  private epochFor(agentId: string): string {
    let epoch = this.epochs.get(agentId);
    if (!epoch) {
      epoch = randomUUID();
      this.epochs.set(agentId, epoch);
    }
    return epoch;
  }

  private async appendRows(
    agentId: string,
    current: AgentTimelineRow[],
    rows: readonly AgentTimelineRow[],
  ): Promise<void> {
    await this.ensureReady();
    const payload = `${rows.map(encodeRow).join("\n")}\n`;
    await appendFile(this.filePath(agentId), payload, "utf8");
    current.push(...rows.map(cloneRow));
  }

  private async rewriteRows(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void> {
    await this.ensureReady();
    const file = this.filePath(agentId);
    const temp = `${file}.tmp`;
    await writeFile(temp, rows.map(encodeRow).join("\n") + (rows.length > 0 ? "\n" : ""), "utf8");
    await rename(temp, file);
    this.rowsByAgent.set(agentId, rows.map(cloneRow));
  }

  private async load(agentId: string): Promise<AgentTimelineRow[]> {
    const cached = this.rowsByAgent.get(agentId);
    if (cached) return cached;
    let pending = this.loading.get(agentId);
    if (!pending) {
      pending = this.loadFromDisk(agentId);
      this.loading.set(agentId, pending);
    }
    try {
      await pending;
    } finally {
      if (this.loading.get(agentId) === pending) this.loading.delete(agentId);
    }
    return this.rowsByAgent.get(agentId) ?? [];
  }

  private async loadFromDisk(agentId: string): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.filePath(agentId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.rowsByAgent.set(agentId, []);
        return;
      }
      throw error;
    }
    const rows: AgentTimelineRow[] = [];
    let skipped = 0;
    for (const line of text.split("\n")) {
      if (line.length === 0) continue;
      const row = parseRow(line);
      if (row) rows.push(row);
      else skipped += 1;
    }
    if (skipped > 0) {
      this.options?.logger?.warn(
        { agentId, skippedLineCount: skipped },
        "Skipped unparsable durable timeline lines",
      );
    }
    this.rowsByAgent.set(agentId, rows);
  }

  private async runMutation<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(agentId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.mutationTails.set(agentId, tail);
    void tail.finally(() => {
      if (this.mutationTails.get(agentId) === tail) this.mutationTails.delete(agentId);
    });
    return result;
  }

  private async ensureReady(): Promise<void> {
    this.ready ??= mkdir(this.directory, { recursive: true }).then(() => undefined);
    await this.ready;
  }

  private filePath(agentId: string): string {
    return path.join(this.directory, fileNameForAgent(agentId));
  }
}

function rowsAreContiguousAfter(
  current: readonly AgentTimelineRow[],
  incoming: readonly AgentTimelineRow[],
): boolean {
  let expected = current.at(-1)?.seq ?? 0;
  for (const row of incoming) {
    if (row.seq <= expected) return false;
    expected = row.seq;
  }
  return true;
}

function mergeRows(
  current: readonly AgentTimelineRow[],
  incoming: readonly AgentTimelineRow[],
): AgentTimelineRow[] {
  const bySeq = new Map(current.map((row) => [row.seq, row]));
  for (const row of incoming) {
    const existing = bySeq.get(row.seq);
    if (existing) {
      if (!isDeepStrictEqual(stripReadonly(existing), stripReadonly(row))) {
        throw new Error(`Conflicting timeline row sequence ${row.seq}`);
      }
      continue;
    }
    bySeq.set(row.seq, row);
  }
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

function stripReadonly(row: AgentTimelineRow): Record<string, unknown> {
  return {
    seq: row.seq,
    timestamp: row.timestamp,
    item: row.item,
    ...(row.turnId !== undefined ? { turnId: row.turnId } : {}),
    ...(row.providerMessageId !== undefined ? { providerMessageId: row.providerMessageId } : {}),
  };
}
