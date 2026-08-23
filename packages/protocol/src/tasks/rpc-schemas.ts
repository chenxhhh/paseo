import { z } from "zod";
import { TaskQuestionViewSchema, TaskViewSchema } from "./types.js";

export const TaskListRequestSchema = z.object({
  type: z.literal("task/list"),
  requestId: z.string(),
  ownerAgentId: z.string().min(1).optional(),
});
export type TaskListRequest = z.infer<typeof TaskListRequestSchema>;

export const TaskInspectRequestSchema = z.object({
  type: z.literal("task/inspect"),
  requestId: z.string(),
  taskId: z.string().min(1),
});
export type TaskInspectRequest = z.infer<typeof TaskInspectRequestSchema>;

export const TaskResolveGateRequestSchema = z.object({
  type: z.literal("task/resolve-gate"),
  requestId: z.string(),
  taskId: z.string().min(1),
  resolution: z.string().trim().min(1),
});
export type TaskResolveGateRequest = z.infer<typeof TaskResolveGateRequestSchema>;

export const TaskAnswerQuestionRequestSchema = z.object({
  type: z.literal("task/answer-question"),
  requestId: z.string(),
  questionId: z.string().min(1),
  answer: z.string().trim().min(1),
});
export type TaskAnswerQuestionRequest = z.infer<typeof TaskAnswerQuestionRequestSchema>;

export const TaskQuestionsRequestSchema = z.object({
  type: z.literal("task/questions"),
  requestId: z.string(),
  status: z.enum(["pending", "answered", "closed"]).optional(),
});
export type TaskQuestionsRequest = z.infer<typeof TaskQuestionsRequestSchema>;

export const TaskListResponseSchema = z.object({
  type: z.literal("task/list/response"),
  payload: z.object({
    requestId: z.string(),
    tasks: z.array(TaskViewSchema),
    error: z.string().nullable(),
  }),
});
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

export const TaskInspectResponseSchema = z.object({
  type: z.literal("task/inspect/response"),
  payload: z.object({
    requestId: z.string(),
    task: TaskViewSchema.nullable(),
    error: z.string().nullable(),
  }),
});
export type TaskInspectResponse = z.infer<typeof TaskInspectResponseSchema>;

export const TaskResolveGateResponseSchema = z.object({
  type: z.literal("task/resolve-gate/response"),
  payload: z.object({
    requestId: z.string(),
    task: TaskViewSchema,
    error: z.string().nullable(),
  }),
});
export type TaskResolveGateResponse = z.infer<typeof TaskResolveGateResponseSchema>;

export const TaskAnswerQuestionResponseSchema = z.object({
  type: z.literal("task/answer-question/response"),
  payload: z.object({
    requestId: z.string(),
    question: TaskQuestionViewSchema,
    error: z.string().nullable(),
  }),
});
export type TaskAnswerQuestionResponse = z.infer<typeof TaskAnswerQuestionResponseSchema>;

export const TaskQuestionsResponseSchema = z.object({
  type: z.literal("task/questions/response"),
  payload: z.object({
    requestId: z.string(),
    questions: z.array(TaskQuestionViewSchema),
    error: z.string().nullable(),
  }),
});
export type TaskQuestionsResponse = z.infer<typeof TaskQuestionsResponseSchema>;
