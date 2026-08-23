import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandError, CommandOptions } from "../../output/index.js";
import type {
  TaskAnswerQuestionResponse,
  TaskInspectResponse,
  TaskListResponse,
  TaskQuestionsResponse,
  TaskResolveGateResponse,
} from "@getpaseo/protocol/messages";
import type { TaskQuestionStatus, TaskView } from "@getpaseo/protocol/tasks/types";

export interface TaskCommandOptions extends CommandOptions {
  host?: string;
}

export interface TaskDaemonClient {
  taskList(options?: { ownerAgentId?: string }): Promise<TaskListResponse["payload"]>;
  taskInspect(options: { id: string }): Promise<TaskInspectResponse["payload"]>;
  taskResolveGate(options: {
    id: string;
    resolution: string;
  }): Promise<TaskResolveGateResponse["payload"]>;
  taskAnswerQuestion(options: {
    questionId: string;
    answer: string;
  }): Promise<TaskAnswerQuestionResponse["payload"]>;
  taskQuestions(options?: {
    status?: TaskQuestionStatus;
  }): Promise<TaskQuestionsResponse["payload"]>;
  close(): Promise<void>;
}

export async function connectTaskClient(
  host: string | undefined,
): Promise<{ client: TaskDaemonClient; host: string }> {
  const resolvedHost = getDaemonHost({ host });
  try {
    const client = (await connectToDaemon({ host })) as unknown as TaskDaemonClient;
    return { client, host: resolvedHost };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${resolvedHost}: ${message}`,
      details: "Start the daemon with: paseo daemon start",
    } satisfies CommandError;
  }
}

export function toTaskCommandError(code: string, action: string, error: unknown): CommandError {
  if (error && typeof error === "object" && "code" in error) {
    return error as CommandError;
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code,
    message: `Failed to ${action}: ${message}`,
  };
}

/** Effective status: derived readiness is shown for pending tasks. */
export function effectiveTaskStatus(task: TaskView): string {
  if (task.status === "pending") {
    if (task.ready) {
      return "ready";
    }
    if (task.blocked) {
      return "blocked";
    }
    if (task.gate?.status === "pending") {
      return "gated";
    }
  }
  return task.status;
}
