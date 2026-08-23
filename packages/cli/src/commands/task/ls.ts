import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import { taskSchema, toTaskRow, type TaskRow } from "./schema.js";
import { connectTaskClient, toTaskCommandError, type TaskCommandOptions } from "./shared.js";

export async function runLsCommand(
  options: TaskCommandOptions & { owner?: string },
  _command: Command,
): Promise<ListResult<TaskRow>> {
  const { client } = await connectTaskClient(options.host);
  try {
    const payload = await client.taskList(
      options.owner ? { ownerAgentId: options.owner } : undefined,
    );
    if (payload.error) {
      throw new Error(payload.error);
    }
    return {
      type: "list",
      data: payload.tasks.map(toTaskRow),
      schema: taskSchema,
    };
  } catch (error) {
    throw toTaskCommandError("TASK_LIST_FAILED", "list tasks", error);
  } finally {
    await client.close().catch(() => {});
  }
}
