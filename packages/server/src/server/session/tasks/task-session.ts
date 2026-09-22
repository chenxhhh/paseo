import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { TaskService } from "../../tasks/service.js";

export interface TaskSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface TaskSessionOptions {
  host: TaskSessionHost;
  taskService: TaskService | undefined;
  logger: pino.Logger;
}

type TaskRequestType =
  | "task/list"
  | "task/inspect"
  | "task/resolve-gate"
  | "task/answer-question"
  | "task/questions";

/**
 * Human-facing RPC surface for the coordination layer: inspect task state,
 * resolve decision gates, and answer pending agent questions from the CLI.
 * Agent-facing mutations go through the tool catalog instead.
 */
export class TaskSession {
  private readonly host: TaskSessionHost;
  private readonly taskService: TaskService | undefined;
  private readonly logger: pino.Logger;

  constructor(options: TaskSessionOptions) {
    this.host = options.host;
    this.taskService = options.taskService;
    this.logger = options.logger;
  }

  private requireService(): TaskService {
    if (!this.taskService) {
      throw new Error("Task service is not configured");
    }
    return this.taskService;
  }

  private emitTaskRpcError(
    request: Extract<SessionInboundMessage, { type: TaskRequestType }>,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error({ err: error, requestType: request.type }, "Task request failed");
    this.host.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        error: message,
        code: "task_request_failed",
      },
    });
  }

  async handleTaskListRequest(
    request: Extract<SessionInboundMessage, { type: "task/list" }>,
  ): Promise<void> {
    try {
      const service = this.requireService();
      const tasks = await service.listTasks(
        request.ownerAgentId !== undefined ? { ownerAgentId: request.ownerAgentId } : undefined,
      );
      this.host.emit({
        type: "task/list/response",
        payload: { requestId: request.requestId, tasks, error: null },
      });
    } catch (error) {
      this.emitTaskRpcError(request, error);
    }
  }

  async handleTaskInspectRequest(
    request: Extract<SessionInboundMessage, { type: "task/inspect" }>,
  ): Promise<void> {
    try {
      const task = await this.requireService().inspectTask(request.taskId);
      if (!task) {
        throw new Error(`Task not found: ${request.taskId}`);
      }
      this.host.emit({
        type: "task/inspect/response",
        payload: { requestId: request.requestId, task, error: null },
      });
    } catch (error) {
      this.emitTaskRpcError(request, error);
    }
  }

  async handleTaskResolveGateRequest(
    request: Extract<SessionInboundMessage, { type: "task/resolve-gate" }>,
  ): Promise<void> {
    try {
      const task = await this.requireService().resolveGate({
        taskId: request.taskId,
        resolution: request.resolution,
      });
      this.host.emit({
        type: "task/resolve-gate/response",
        payload: { requestId: request.requestId, task, error: null },
      });
    } catch (error) {
      this.emitTaskRpcError(request, error);
    }
  }

  async handleTaskAnswerQuestionRequest(
    request: Extract<SessionInboundMessage, { type: "task/answer-question" }>,
  ): Promise<void> {
    try {
      const question = await this.requireService().answerQuestion({
        questionId: request.questionId,
        answer: request.answer,
      });
      this.host.emit({
        type: "task/answer-question/response",
        payload: { requestId: request.requestId, question, error: null },
      });
    } catch (error) {
      this.emitTaskRpcError(request, error);
    }
  }

  async handleTaskQuestionsRequest(
    request: Extract<SessionInboundMessage, { type: "task/questions" }>,
  ): Promise<void> {
    try {
      const questions = await this.requireService().listAllQuestions(request.status);
      this.host.emit({
        type: "task/questions/response",
        payload: { requestId: request.requestId, questions, error: null },
      });
    } catch (error) {
      this.emitTaskRpcError(request, error);
    }
  }
}
