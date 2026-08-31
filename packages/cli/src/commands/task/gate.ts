import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import { createTaskInspectRows, taskInspectSchema, type TaskInspectRow } from "./schema.js";
import { connectTaskClient, toTaskCommandError, type TaskCommandOptions } from "./shared.js";

export async function runGateCommand(
  id: string,
  resolution: string,
  options: TaskCommandOptions,
  _command: Command,
): Promise<ListResult<TaskInspectRow>> {
  const { client } = await connectTaskClient(options.host);
  try {
    const payload = await client.taskResolveGate({ id, resolution });
    if (payload.error || !payload.task) {
      throw new Error(payload.error ?? `Task not found: ${id}`);
    }
    return {
      type: "list",
      data: createTaskInspectRows(payload.task),
      schema: taskInspectSchema,
    };
  } catch (error) {
    throw toTaskCommandError("TASK_RESOLVE_GATE_FAILED", "resolve task gate", error);
  } finally {
    await client.close().catch(() => {});
  }
}
