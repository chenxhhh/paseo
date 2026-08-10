import { describe, expect, it } from "vitest";
import type { ScheduleRun } from "@getpaseo/protocol/schedule/types";
import type { ScheduleRunsQueryResult } from "@/hooks/use-schedule-runs";
import { resolveRunSheetBodyState } from "./schedule-runs-sheet-state";

const RUN: ScheduleRun = {
  id: "run-1",
  scheduledFor: "2026-08-01T00:00:00.000Z",
  startedAt: "2026-08-01T00:00:00.000Z",
  endedAt: "2026-08-01T00:05:00.000Z",
  status: "succeeded",
  agentId: "agent-1",
  workspaceId: null,
  output: "done",
  error: null,
};

const RUNS = [RUN];

function loaded(runs: ScheduleRun[]): ScheduleRunsQueryResult {
  return { status: "loaded", runs };
}

const LOADING: ScheduleRunsQueryResult = { status: "loading" };

describe("resolveRunSheetBodyState", () => {
  it("shows loading while the first fetch is pending in list view", () => {
    expect(resolveRunSheetBodyState({ result: LOADING, view: { kind: "list" } })).toEqual({
      kind: "loading",
    });
  });

  it("shows loading while the host is reconnecting", () => {
    expect(
      resolveRunSheetBodyState({
        result: { status: "connecting" },
        view: { kind: "list" },
      }),
    ).toEqual({ kind: "loading" });
  });

  it("shows loading while idle before the first open", () => {
    expect(
      resolveRunSheetBodyState({ result: { status: "idle" }, view: { kind: "list" } }),
    ).toEqual({ kind: "loading" });
  });

  it("surfaces an error with retry in list view", () => {
    const error = new Error("schedule/logs failed");
    expect(
      resolveRunSheetBodyState({
        result: { status: "error", error },
        view: { kind: "list" },
      }),
    ).toEqual({ kind: "error", error });
  });

  it("shows an empty state when a schedule has no runs", () => {
    expect(resolveRunSheetBodyState({ result: loaded([]), view: { kind: "list" } })).toEqual({
      kind: "empty",
    });
  });

  it("renders the run list when runs exist", () => {
    expect(resolveRunSheetBodyState({ result: loaded(RUNS), view: { kind: "list" } })).toEqual({
      kind: "list",
      runs: RUNS,
    });
  });

  it("opens the detail for the selected run", () => {
    expect(
      resolveRunSheetBodyState({
        result: loaded(RUNS),
        view: { kind: "detail", runId: RUN.id },
      }),
    ).toEqual({ kind: "detail", run: RUN });
  });

  it("falls back to detail-missing when the viewed run disappears", () => {
    expect(
      resolveRunSheetBodyState({
        result: loaded(RUNS),
        view: { kind: "detail", runId: "run-gone" },
      }),
    ).toEqual({ kind: "detail-missing" });
  });

  it("keeps showing loading for a detail view while data is pending", () => {
    expect(
      resolveRunSheetBodyState({
        result: LOADING,
        view: { kind: "detail", runId: RUN.id },
      }),
    ).toEqual({ kind: "loading" });
  });
});
