import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";

const workdirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "file-agent-timeline-store-"));
  workdirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(workdirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function row(seq: number, text: string, extra?: Partial<AgentTimelineRow>): AgentTimelineRow {
  return {
    seq,
    timestamp: `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    item: { type: "assistant_message", text, messageId: `m-${seq}` },
    ...extra,
  };
}

describe("FileAgentTimelineStore", () => {
  it("restores committed rows across store instances", async () => {
    const dir = await makeDir();
    const first = new FileAgentTimelineStore(dir);
    await first.bulkInsert("11111111-1111-4111-8111-111111111111", [row(1, "one"), row(2, "two")]);

    const second = new FileAgentTimelineStore(dir);
    await expect(second.getCommittedRows("11111111-1111-4111-8111-111111111111")).resolves.toEqual([
      row(1, "one"),
      row(2, "two"),
    ]);
    await expect(
      second.getLatestCommittedSeq("11111111-1111-4111-8111-111111111111"),
    ).resolves.toBe(2);
    await expect(second.getLastItem("11111111-1111-4111-8111-111111111111")).resolves.toEqual(
      row(2, "two").item,
    );
  });

  it("appends only new rows without rewriting committed lines", async () => {
    const dir = await makeDir();
    const agentId = "22222222-2222-4222-8222-222222222222";
    const store = new FileAgentTimelineStore(dir);
    await store.bulkInsert(agentId, [row(1, "one")]);
    const file = join(dir, "agent-MjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIy.jsonl");
    const afterFirst = await readFile(file, "utf8");
    expect(afterFirst.split("\n").filter(Boolean)).toHaveLength(1);

    await store.bulkInsert(agentId, [row(2, "two")]);
    const afterSecond = await readFile(file, "utf8");
    expect(afterSecond.startsWith(afterFirst)).toBe(true);
    expect(afterSecond.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("ignores duplicate sequences and rejects conflicting rows", async () => {
    const dir = await makeDir();
    const agentId = "33333333-3333-4333-8333-333333333333";
    const store = new FileAgentTimelineStore(dir);
    await store.bulkInsert(agentId, [row(1, "one")]);

    await expect(store.bulkInsert(agentId, [row(1, "one")])).resolves.toBeUndefined();
    await expect(store.getLatestCommittedSeq(agentId)).resolves.toBe(1);

    await expect(store.bulkInsert(agentId, [row(1, "changed")])).rejects.toThrow(
      /conflicting timeline row sequence 1/i,
    );
  });

  it("skips torn lines instead of failing the agent", async () => {
    const dir = await makeDir();
    const agentId = "44444444-4444-4444-8444-444444444444";
    const file = join(dir, "agent-NDQ0NDQ0NDQtNDQ0NC00NDQ0LTg0NDQtNDQ0NDQ0NDQ0NDQ0.jsonl");
    await writeFile(
      file,
      `${JSON.stringify(row(1, "intact"))}\n{"seq":2,"timestamp":"torn","item":{"type":`,
      "utf8",
    );

    const store = new FileAgentTimelineStore(dir);
    await expect(store.getCommittedRows(agentId)).resolves.toEqual([row(1, "intact")]);
    await expect(store.getLatestCommittedSeq(agentId)).resolves.toBe(1);
  });

  it("updates a committed row in place and persists the rewrite", async () => {
    const dir = await makeDir();
    const agentId = "55555555-5555-4555-8555-555555555555";
    const store = new FileAgentTimelineStore(dir);
    await store.bulkInsert(agentId, [row(1, "one"), row(2, "two")]);

    await store.updateCommittedRow(agentId, row(2, "two", { providerMessageId: "pm-2" }));
    await expect(
      store.getCommittedRows(agentId).then((rows) => rows.at(-1)?.providerMessageId),
    ).resolves.toBe("pm-2");

    const reloaded = new FileAgentTimelineStore(dir);
    await expect(
      reloaded.getCommittedRows(agentId).then((rows) => rows.at(-1)?.providerMessageId),
    ).resolves.toBe("pm-2");

    await expect(store.updateCommittedRow(agentId, row(9, "missing"))).rejects.toThrow(
      /cannot update missing timeline row sequence 9/i,
    );
  });

  it("merges out-of-order inserts by sequence", async () => {
    const dir = await makeDir();
    const agentId = "66666666-6666-4666-8666-666666666666";
    const store = new FileAgentTimelineStore(dir);
    await store.bulkInsert(agentId, [row(3, "three")]);
    await store.bulkInsert(agentId, [row(1, "one")]);

    const reloaded = new FileAgentTimelineStore(dir);
    const rows = await reloaded.getCommittedRows(agentId);
    expect(rows.map((entry) => entry.seq)).toEqual([1, 3]);
  });

  it("deletes the backing file with the agent", async () => {
    const dir = await makeDir();
    const agentId = "77777777-7777-4777-8777-777777777777";
    const store = new FileAgentTimelineStore(dir);
    await store.bulkInsert(agentId, [row(1, "one")]);
    await store.deleteAgent(agentId);

    await expect(readdir(dir)).resolves.toEqual([]);
    await expect(store.getLatestCommittedSeq(agentId)).resolves.toBe(0);
    await expect(new FileAgentTimelineStore(dir).getCommittedRows(agentId)).resolves.toEqual([]);
  });

  it("serializes concurrent appends into sequence order", async () => {
    const dir = await makeDir();
    const agentId = "88888888-8888-4888-8888-888888888888";
    const store = new FileAgentTimelineStore(dir);
    await Promise.all(
      [1, 2, 3, 4, 5].map((seq) => store.bulkInsert(agentId, [row(seq, `row-${seq}`)])),
    );

    const reloaded = new FileAgentTimelineStore(dir);
    const rows = await reloaded.getCommittedRows(agentId);
    expect(rows.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("joins the trailing assistant message across chunk rows", async () => {
    const dir = await makeDir();
    const agentId = "99999999-9999-4999-8999-999999999999";
    const store = new FileAgentTimelineStore(dir);
    await store.bulkInsert(agentId, [
      row(1, "Sec"),
      row(2, "ond"),
      {
        seq: 3,
        timestamp: "2026-01-01T00:00:03.000Z",
        item: { type: "user_message", text: "next", messageId: "u-3" },
      },
    ]);

    await expect(store.getLastAssistantMessage(agentId)).resolves.toBe("Second");
  });

  it("serves a projected tail fetch after a reload", async () => {
    const dir = await makeDir();
    const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const seed = new FileAgentTimelineStore(dir);
    for (let seq = 1; seq <= 5; seq += 1) {
      await seed.bulkInsert(agentId, [row(seq, `row-${seq}`)]);
    }

    const store = new FileAgentTimelineStore(dir);
    const result = await store.fetchCommitted(agentId, { limit: 2 });
    expect(result.window).toEqual({ minSeq: 1, maxSeq: 5, nextSeq: 6 });
    expect(result.rows.map((entry) => entry.seq)).toEqual([4, 5]);
    expect(result.hasOlder).toBe(true);
    expect(result.hasNewer).toBe(false);
  });

  it("allocates the next sequence for appended items", async () => {
    const dir = await makeDir();
    const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const store = new FileAgentTimelineStore(dir);
    await store.bulkInsert(agentId, [row(1, "one")]);

    await expect(
      store.appendCommitted(agentId, { type: "assistant_message", text: "next", messageId: "m-2" }),
    ).resolves.toMatchObject({
      seq: 2,
      item: { text: "next" },
    });
    await expect(new FileAgentTimelineStore(dir).getLatestCommittedSeq(agentId)).resolves.toBe(2);
  });
});
