import type { OutputSchema } from "../../output/index.js";
import type { TaskView } from "@getpaseo/protocol/tasks/types";
import { effectiveTaskStatus, type TaskDaemonClient } from "./shared.js";

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  deps: string;
  assignee: string;
  gate: string;
  owner: string;
}

export const taskSchema: OutputSchema<TaskRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 10 },
    { header: "TITLE", field: "title", width: 34 },
    { header: "STATUS", field: "status", width: 12 },
    { header: "DEPS", field: "deps", width: 20 },
    { header: "ASSIGNEE", field: "assignee", width: 10 },
    { header: "GATE", field: "gate", width: 9 },
    { header: "OWNER", field: "owner", width: 10 },
  ],
};

export interface TaskQuestionRow {
  id: string;
  status: string;
  asker: string;
  parent: string;
  task: string;
  question: string;
  answer: string;
}

export const taskQuestionSchema: OutputSchema<TaskQuestionRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 10 },
    { header: "STATUS", field: "status", width: 10 },
    { header: "ASKER", field: "asker", width: 10 },
    { header: "PARENT", field: "parent", width: 10 },
    { header: "TASK", field: "task", width: 10 },
    { header: "QUESTION", field: "question", width: 40 },
    { header: "ANSWER", field: "answer", width: 40 },
  ],
};

export interface TaskInspectRow {
  key: string;
  value: string;
}

export function toTaskRow(task: TaskView): TaskRow {
  return {
    id: task.id,
    title: task.title,
    status: effectiveTaskStatus(task),
    deps: task.deps.length > 0 ? task.deps.join(",") : "-",
    assignee: task.assigneeAgentId ? task.assigneeAgentId.slice(0, 8) : "-",
    gate: task.gate ? task.gate.status : "-",
    owner: task.ownerAgentId.slice(0, 8),
  };
}

export function createTaskInspectRows(task: TaskView): TaskInspectRow[] {
  return [
    { key: "id", value: task.id },
    { key: "title", value: task.title },
    { key: "owner", value: task.ownerAgentId },
    { key: "status", value: task.status },
    { key: "effective", value: effectiveTaskStatus(task) },
    { key: "ready", value: String(task.ready) },
    { key: "blocked", value: String(task.blocked) },
    ...(task.blockingDeps.length > 0
      ? [{ key: "blockingDeps", value: task.blockingDeps.join(", ") }]
      : []),
    { key: "spec", value: task.spec ?? "-" },
    { key: "deps", value: task.deps.length > 0 ? task.deps.join(", ") : "-" },
    { key: "assignee", value: task.assigneeAgentId ?? "-" },
    ...(task.gate
      ? [
          { key: "gate.question", value: task.gate.question },
          ...(task.gate.options
            ? [{ key: "gate.options", value: task.gate.options.join(" | ") }]
            : []),
          { key: "gate.status", value: task.gate.status },
          ...(task.gate.resolution
            ? [{ key: "gate.resolution", value: task.gate.resolution }]
            : []),
        ]
      : []),
    { key: "result", value: task.result ?? "-" },
    { key: "failureReason", value: task.failureReason ?? "-" },
    { key: "createdAt", value: task.createdAt },
    { key: "updatedAt", value: task.updatedAt },
  ];
}

export const taskInspectSchema: OutputSchema<TaskInspectRow> = {
  idField: "key",
  columns: [
    { header: "KEY", field: "key", width: 18 },
    { header: "VALUE", field: "value", width: 80 },
  ],
};

export type TaskClientMethod = keyof TaskDaemonClient;
