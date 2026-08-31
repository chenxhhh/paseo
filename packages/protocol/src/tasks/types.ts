import { z } from "zod";

export const TaskStatusSchema = z.enum(["pending", "in_progress", "completed", "failed"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskGateStatusSchema = z.enum(["pending", "resolved"]);
export type TaskGateStatus = z.infer<typeof TaskGateStatusSchema>;

export const TaskGateSchema = z.object({
  question: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).min(1).max(8).nullable().optional(),
  status: TaskGateStatusSchema,
  resolution: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
});
export type TaskGate = z.infer<typeof TaskGateSchema>;

export const StoredTaskSchema = z.object({
  id: z.string().min(1),
  ownerAgentId: z.string().min(1),
  title: z.string().trim().min(1),
  spec: z.string().nullable(),
  deps: z.array(z.string().min(1)),
  assigneeAgentId: z.string().min(1).nullable(),
  status: TaskStatusSchema,
  result: z.string().nullable(),
  failureReason: z.string().nullable(),
  gate: TaskGateSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type StoredTask = z.infer<typeof StoredTaskSchema>;

/**
 * Read-side view of a task. `ready` and `blocked` are derived from the task's
 * dependency closure at read time and are never persisted: a pending task is
 * ready when every dependency is completed and its gate (if any) is resolved,
 * and blocked when any dependency in its closure is failed or blocked.
 */
export const TaskViewSchema = StoredTaskSchema.extend({
  ready: z.boolean(),
  blocked: z.boolean(),
  blockingDeps: z.array(z.string().min(1)),
});
export type TaskView = z.infer<typeof TaskViewSchema>;

export const TaskQuestionStatusSchema = z.enum(["pending", "answered", "closed"]);
export type TaskQuestionStatus = z.infer<typeof TaskQuestionStatusSchema>;

export const StoredTaskQuestionSchema = z.object({
  id: z.string().min(1),
  askerAgentId: z.string().min(1),
  parentAgentId: z.string().min(1),
  taskId: z.string().min(1).nullable(),
  question: z.string().trim().min(1),
  status: TaskQuestionStatusSchema,
  answer: z.string().nullable(),
  createdAt: z.string(),
  answeredAt: z.string().nullable(),
});
export type StoredTaskQuestion = z.infer<typeof StoredTaskQuestionSchema>;

export const TaskQuestionViewSchema = StoredTaskQuestionSchema;
export type TaskQuestionView = StoredTaskQuestion;
