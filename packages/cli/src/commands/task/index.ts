import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runLsCommand } from "./ls.js";
import { runInspectCommand } from "./inspect.js";
import { runGateCommand } from "./gate.js";
import { runAnswerCommand } from "./answer.js";
import { runQuestionsCommand } from "./questions.js";

export function createTaskCommand(): Command {
  const task = new Command("task").description(
    "Inspect agent coordination tasks, resolve decision gates, and answer agent questions",
  );

  addJsonAndDaemonHostOptions(
    task
      .command("ls")
      .description("List coordination tasks")
      .option("--owner <agentId>", "Only tasks owned by this agent"),
  ).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(
    task.command("inspect <id>").description("Show one task in detail"),
  ).action(withOutput(runInspectCommand));

  addJsonAndDaemonHostOptions(
    task.command("gate <id> <resolution>").description("Resolve a pending decision gate on a task"),
  ).action(withOutput(runGateCommand));

  addJsonAndDaemonHostOptions(
    task
      .command("answer <questionId> <answer>")
      .description("Answer a pending question asked by an agent"),
  ).action(withOutput(runAnswerCommand));

  addJsonAndDaemonHostOptions(
    task
      .command("questions")
      .description("List agent questions")
      .option("--pending", "Only pending questions"),
  ).action(withOutput(runQuestionsCommand));

  return task;
}
