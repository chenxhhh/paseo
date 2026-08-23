import type { ScheduleRun } from "@getpaseo/protocol/schedule/types";
import type { ScheduleRunsQueryResult } from "@/hooks/use-schedule-runs";

/** Drill-down state machine for the run-history sheet. */
export type ScheduleRunsSheetView = { kind: "list" } | { kind: "detail"; runId: string };

export type ScheduleRunSheetBodyState =
  | { kind: "loading" }
  | { kind: "error"; error: Error }
  | { kind: "empty" }
  | { kind: "list"; runs: ScheduleRun[] }
  | { kind: "detail"; run: ScheduleRun }
  | { kind: "detail-missing" };

/**
 * Mirror of the schedules-screen-state resolver: fold the query result and the
 * current drill-down view into a small render-ready union.
 *
 * `detail-missing` means the run being viewed disappeared from the list (deleted
 * or trimmed server-side); the sheet falls back to the list view instead of a
 * dead-end detail page.
 */
export function resolveRunSheetBodyState(input: {
  result: ScheduleRunsQueryResult;
  view: ScheduleRunsSheetView;
}): ScheduleRunSheetBodyState {
  const { result, view } = input;

  if (view.kind === "detail" && result.status === "loaded") {
    const run = result.runs.find((entry) => entry.id === view.runId);
    if (run) {
      return { kind: "detail", run };
    }
    return { kind: "detail-missing" };
  }

  if (result.status === "idle" || result.status === "connecting" || result.status === "loading") {
    return { kind: "loading" };
  }
  if (result.status === "error") {
    return { kind: "error", error: result.error };
  }
  if (result.runs.length === 0) {
    return { kind: "empty" };
  }
  return { kind: "list", runs: result.runs };
}
