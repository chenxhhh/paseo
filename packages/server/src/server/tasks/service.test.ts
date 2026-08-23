import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { TaskService } from "./service.js";

const OWNER = "11111111-1111-1111-1111-111111111111";
const CHILD = "33333333-3333-3333-3333-333333333333";
const STRANGER = "44444444-4444-4444-4444-444444444444";
const OTHER_OWNER = "55555555-5555-5555-5555-555555555555";

interface TestAgentRecord {
  labels: Record<string, unknown> | null;
  title?: string;
  archivedAt?: string | null;
}

// Module-level so doubly-nested test callbacks stay under the repo's
// max-nested-callbacks budget.
function idsOf(items: Array<{ id: string }>): string[] {
  return items.map((item) => item.id);
}

function titlesOf(items: Array<{ title: string }>): string[] {
  return items.map((item) => item.title);
}

function notificationFor(
  notifications: Array<{ agentId: string; body: string }>,
  agentId: string,
): { agentId: string; body: string } | undefined {
  return notifications.find((entry) => entry.agentId === agentId);
}

interface Harness {
  service: TaskService;
  notifications: Array<{ agentId: string; body: string }>;
  agents: Map<string, TestAgentRecord>;
}

function buildHarness(paseoHome: string): Harness {
  const notifications: Array<{ agentId: string; body: string }> = [];
  const agents = new Map<string, TestAgentRecord>([
    [OWNER, { labels: null, title: "Coordinator" }],
    [CHILD, { labels: { [PARENT_AGENT_ID_LABEL]: OWNER }, title: "Worker" }],
    [STRANGER, { labels: null, title: "Stranger" }],
    [OTHER_OWNER, { labels: null, title: "Other" }],
  ]);
  const agentStorage = {
    get: async (agentId: string) => {
      const record = agents.get(agentId);
      return record
        ? {
            title: record.title ?? agentId,
            labels: record.labels,
            archivedAt: record.archivedAt ?? null,
          }
        : null;
    },
  } as unknown as AgentStorage;
  const agentManager = {
    getAgent: (agentId: string) => (agents.has(agentId) ? { id: agentId } : null),
  } as unknown as AgentManager;
  const logger = {
    child: () => logger,
    error: () => undefined,
    warn: () => undefined,
  } as unknown as Logger;

  const service = new TaskService({
    paseoHome,
    logger,
    agentManager,
    agentStorage,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    sendNotification: async (agentId, body) => {
      notifications.push({ agentId, body });
    },
  });
  return { service, notifications, agents };
}

describe("TaskService", () => {
  let tempDir: string;
  let harness: Harness;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "task-service-test-"));
    harness = buildHarness(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("createTask and readiness derivation", () => {
    test("a task with no deps and no gate is ready", async () => {
      const task = await harness.service.createTask({ ownerAgentId: OWNER, title: "T1" });
      expect(task.ready).toBe(true);
      expect(task.blocked).toBe(false);
      expect(task.status).toBe("pending");
    });

    test("dependent task is not ready until deps complete, then becomes ready", async () => {
      const service = harness.service;
      const first = await service.createTask({ ownerAgentId: OWNER, title: "First" });
      const second = await service.createTask({
        ownerAgentId: OWNER,
        title: "Second",
        deps: [first.id],
      });
      expect(second.ready).toBe(false);

      await service.completeTask({ taskId: first.id, callerAgentId: OWNER, result: "done" });
      const refreshed = await service.inspectTask(second.id);
      expect(refreshed?.ready).toBe(true);
    });

    test("failure blocks dependents transitively", async () => {
      const service = harness.service;
      const a = await service.createTask({ ownerAgentId: OWNER, title: "A" });
      const b = await service.createTask({ ownerAgentId: OWNER, title: "B", deps: [a.id] });
      const c = await service.createTask({ ownerAgentId: OWNER, title: "C", deps: [b.id] });

      await service.failTask({ taskId: a.id, callerAgentId: OWNER, reason: "boom" });

      const bView = await service.inspectTask(b.id);
      const cView = await service.inspectTask(c.id);
      expect(bView?.blocked).toBe(true);
      expect(bView?.blockingDeps).toEqual([a.id]);
      expect(cView?.blocked).toBe(true);
      expect(cView?.blockingDeps).toEqual([b.id]);
    });

    test("rejects missing deps and cross-owner deps", async () => {
      const service = harness.service;
      await expect(
        service.createTask({ ownerAgentId: OWNER, title: "Bad", deps: ["nope"] }),
      ).rejects.toThrow(/dependency not found/i);

      const foreign = await service.createTask({ ownerAgentId: OTHER_OWNER, title: "Foreign" });
      await expect(
        service.createTask({ ownerAgentId: OWNER, title: "Mixed", deps: [foreign.id] }),
      ).rejects.toThrow(/another owner/i);
    });

    test("rejects unknown assignee", async () => {
      await expect(
        harness.service.createTask({
          ownerAgentId: OWNER,
          title: "T",
          assigneeAgentId: "99999999-9999-9999-9999-999999999999",
        }),
      ).rejects.toThrow(/assignee agent not found/i);
    });
  });

  describe("decision gates", () => {
    test("pending gate keeps a task not ready and blocks completion", async () => {
      const service = harness.service;
      const task = await service.createTask({
        ownerAgentId: OWNER,
        title: "Risky",
        gate: { question: "Deploy to prod?", options: ["yes", "no"] },
      });
      expect(task.ready).toBe(false);

      await expect(service.completeTask({ taskId: task.id, callerAgentId: OWNER })).rejects.toThrow(
        /unresolved decision gate/i,
      );
      await expect(service.startTask({ taskId: task.id, callerAgentId: OWNER })).rejects.toThrow(
        /not ready/i,
      );
    });

    test("resolution must match declared options", async () => {
      const service = harness.service;
      const task = await service.createTask({
        ownerAgentId: OWNER,
        title: "Risky",
        gate: { question: "Deploy?", options: ["yes", "no"] },
      });
      await expect(
        service.resolveGate({ taskId: task.id, callerAgentId: OWNER, resolution: "maybe" }),
      ).rejects.toThrow(/must be one of/i);

      const resolved = await service.resolveGate({
        taskId: task.id,
        callerAgentId: OWNER,
        resolution: "yes",
      });
      expect(resolved.ready).toBe(true);
      expect(resolved.gate?.resolution).toBe("yes");
      expect(resolved.gate?.resolvedBy).toBe(OWNER);
    });

    test("humans can resolve gates without an owner id", async () => {
      const service = harness.service;
      const task = await service.createTask({
        ownerAgentId: OWNER,
        title: "Gated",
        gate: { question: "Proceed?" },
      });
      const resolved = await service.resolveGate({
        taskId: task.id,
        resolution: "proceed",
      });
      expect(resolved.gate?.resolvedBy).toBe("human");
    });

    test("strangers cannot resolve gates", async () => {
      const service = harness.service;
      const task = await service.createTask({
        ownerAgentId: OWNER,
        title: "Gated",
        gate: { question: "Proceed?" },
      });
      await expect(
        service.resolveGate({ taskId: task.id, callerAgentId: STRANGER, resolution: "yes" }),
      ).rejects.toThrow(/may not mutate/i);
    });
  });

  describe("mutation permissions and lifecycle", () => {
    test("strangers cannot start, complete, or fail tasks", async () => {
      const service = harness.service;
      const task = await service.createTask({ ownerAgentId: OWNER, title: "T" });
      await expect(service.startTask({ taskId: task.id, callerAgentId: STRANGER })).rejects.toThrow(
        /may not mutate/i,
      );
      await expect(
        service.completeTask({ taskId: task.id, callerAgentId: STRANGER }),
      ).rejects.toThrow(/may not mutate/i);
    });

    test("assignee can start and complete; owner sees the result", async () => {
      const service = harness.service;
      const task = await service.createTask({
        ownerAgentId: OWNER,
        title: "T",
        assigneeAgentId: CHILD,
      });
      await service.startTask({ taskId: task.id, callerAgentId: CHILD });
      const completed = await service.completeTask({
        taskId: task.id,
        callerAgentId: CHILD,
        result: "shipped",
      });
      expect(completed.status).toBe("completed");
      expect(completed.result).toBe("shipped");
      expect(completed.startedAt).toBe("2026-01-01T00:00:00.000Z");
    });

    test("completing a completed task fails; failing a completed task fails", async () => {
      const service = harness.service;
      const task = await service.createTask({ ownerAgentId: OWNER, title: "T" });
      await service.completeTask({ taskId: task.id, callerAgentId: OWNER });
      await expect(service.completeTask({ taskId: task.id, callerAgentId: OWNER })).rejects.toThrow(
        /already completed/i,
      );
      await expect(service.failTask({ taskId: task.id, callerAgentId: OWNER })).rejects.toThrow(
        /cannot be marked failed/i,
      );
    });

    test("not-ready start errors explain what is missing", async () => {
      const service = harness.service;
      const first = await service.createTask({ ownerAgentId: OWNER, title: "First" });
      const second = await service.createTask({
        ownerAgentId: OWNER,
        title: "Second",
        deps: [first.id],
      });
      await expect(service.startTask({ taskId: second.id, callerAgentId: OWNER })).rejects.toThrow(
        /dependencies not completed/i,
      );
    });
  });

  describe("ask_parent / answer_question", () => {
    test("agents without a parent label are rejected with guidance", async () => {
      await expect(
        harness.service.askParent({ askerAgentId: STRANGER, question: "Help?" }),
      ).rejects.toThrow(/no parent label/i);
    });

    test("asking persists a question and steers the parent", async () => {
      const service = harness.service;
      const question = await service.askParent({
        askerAgentId: CHILD,
        question: "Which branch should I target?",
      });
      expect(question.status).toBe("pending");
      expect(question.parentAgentId).toBe(OWNER);

      await service.flushNotifications();
      expect(harness.notifications).toHaveLength(1);
      expect(harness.notifications[0]?.agentId).toBe(OWNER);
      expect(harness.notifications[0]?.body).toContain(question.id);
      expect(harness.notifications[0]?.body).toContain("Which branch should I target?");
      expect(harness.notifications[0]?.body).toContain("answer_question");
    });

    test("question taskId must belong to the asker", async () => {
      const service = harness.service;
      const foreign = await service.createTask({ ownerAgentId: OTHER_OWNER, title: "F" });
      await expect(
        service.askParent({ askerAgentId: CHILD, question: "Q?", taskId: foreign.id }),
      ).rejects.toThrow(/not owned or assigned/i);
    });

    test("only the parent can answer; the asker is notified with the answer", async () => {
      const service = harness.service;
      const question = await service.askParent({ askerAgentId: CHILD, question: "Q?" });

      await expect(
        service.answerQuestion({
          questionId: question.id,
          callerAgentId: STRANGER,
          answer: "no",
        }),
      ).rejects.toThrow(/may not answer/i);

      const answered = await service.answerQuestion({
        questionId: question.id,
        callerAgentId: OWNER,
        answer: "Use main",
      });
      expect(answered.status).toBe("answered");
      expect(answered.answer).toBe("Use main");

      await expect(
        service.answerQuestion({ questionId: question.id, callerAgentId: OWNER, answer: "again" }),
      ).rejects.toThrow(/already answered/i);

      await service.flushNotifications();
      const answerNotification = notificationFor(harness.notifications, CHILD);
      expect(answerNotification?.body).toContain("Use main");
    });

    test("humans can answer via the unscoped path", async () => {
      const service = harness.service;
      const question = await service.askParent({ askerAgentId: CHILD, question: "Q?" });
      const answered = await service.answerQuestion({
        questionId: question.id,
        answer: "Human says yes",
      });
      expect(answered.status).toBe("answered");
    });

    test("archived parents are not notified but the question persists", async () => {
      const service = harness.service;
      harness.agents.set(OWNER, { labels: null, title: "Coordinator", archivedAt: "2026-01-02" });
      const question = await service.askParent({ askerAgentId: CHILD, question: "Still there?" });
      await service.flushNotifications();
      expect(harness.notifications).toHaveLength(0);

      const pending = await service.listQuestionsForAgent(OWNER, "pending");
      expect(idsOf(pending.toAnswer)).toEqual([question.id]);
    });

    test("listQuestionsForAgent splits toAnswer and asked", async () => {
      const service = harness.service;
      await service.askParent({ askerAgentId: CHILD, question: "Q1" });
      const views = await service.listQuestionsForAgent(CHILD);
      expect(views.toAnswer).toHaveLength(0);
      expect(views.asked).toHaveLength(1);
    });
  });

  describe("listTasks", () => {
    test("owner scoping filters other owners' tasks", async () => {
      const service = harness.service;
      await service.createTask({ ownerAgentId: OWNER, title: "Mine" });
      await service.createTask({ ownerAgentId: OTHER_OWNER, title: "Theirs" });

      const mine = await service.listTasks({ ownerAgentId: OWNER });
      expect(titlesOf(mine)).toEqual(["Mine"]);

      const all = await service.listTasks();
      expect(all).toHaveLength(2);
    });
  });
});
