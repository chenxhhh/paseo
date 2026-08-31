import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import { taskQuestionSchema, type TaskQuestionRow } from "./schema.js";
import { connectTaskClient, toTaskCommandError, type TaskCommandOptions } from "./shared.js";

export async function runQuestionsCommand(
  options: TaskCommandOptions & { pending?: boolean },
  _command: Command,
): Promise<ListResult<TaskQuestionRow>> {
  const { client } = await connectTaskClient(options.host);
  try {
    const payload = await client.taskQuestions(
      options.pending ? { status: "pending" as const } : undefined,
    );
    if (payload.error) {
      throw new Error(payload.error);
    }
    return {
      type: "list",
      data: payload.questions.map((question) => ({
        id: question.id,
        status: question.status,
        asker: question.askerAgentId.slice(0, 8),
        parent: question.parentAgentId.slice(0, 8),
        task: question.taskId ?? "-",
        question: question.question,
        answer: question.answer ?? "-",
      })),
      schema: taskQuestionSchema,
    };
  } catch (error) {
    throw toTaskCommandError("TASK_QUESTIONS_FAILED", "list questions", error);
  } finally {
    await client.close().catch(() => {});
  }
}
