import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import { taskQuestionSchema, type TaskQuestionRow } from "./schema.js";
import { connectTaskClient, toTaskCommandError, type TaskCommandOptions } from "./shared.js";

export async function runAnswerCommand(
  questionId: string,
  answer: string,
  options: TaskCommandOptions,
  _command: Command,
): Promise<ListResult<TaskQuestionRow>> {
  const { client } = await connectTaskClient(options.host);
  try {
    const payload = await client.taskAnswerQuestion({ questionId, answer });
    if (payload.error || !payload.question) {
      throw new Error(payload.error ?? `Question not found: ${questionId}`);
    }
    const question = payload.question;
    return {
      type: "list",
      data: [
        {
          id: question.id,
          status: question.status,
          asker: question.askerAgentId.slice(0, 8),
          parent: question.parentAgentId.slice(0, 8),
          task: question.taskId ?? "-",
          question: question.question,
          answer: question.answer ?? "-",
        },
      ],
      schema: taskQuestionSchema,
    };
  } catch (error) {
    throw toTaskCommandError("TASK_ANSWER_FAILED", "answer question", error);
  } finally {
    await client.close().catch(() => {});
  }
}
