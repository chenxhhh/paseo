import { describe, expect, it } from "vitest";
import type { ScheduleRun } from "@getpaseo/protocol/schedule/types";
import { resolveScheduleRunsQueryResult } from "./use-schedule-runs";

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

describe("resolveScheduleRunsQueryResult", () => {
  it("stays idle while the sheet has never been opened", () => {
    expect(
      resolveScheduleRunsQueryResult({
        enabled: false,
        canFetch: true,
        data: undefined,
        isPlaceholderData: false,
        error: null,
      }),
    ).toEqual({ status: "idle" });
  });

  it("reports connecting while the host is unavailable", () => {
    expect(
      resolveScheduleRunsQueryResult({
        enabled: true,
        canFetch: false,
        data: undefined,
        isPlaceholderData: false,
        error: null,
      }),
    ).toEqual({ status: "connecting" });
  });

  it("reports loading while the first request is pending", () => {
    expect(
      resolveScheduleRunsQueryResult({
        enabled: true,
        canFetch: true,
        data: undefined,
        isPlaceholderData: false,
        error: null,
      }),
    ).toEqual({ status: "loading" });
  });

  it("types an empty run list as loaded data", () => {
    expect(
      resolveScheduleRunsQueryResult({
        enabled: true,
        canFetch: true,
        data: [],
        isPlaceholderData: false,
        error: null,
      }),
    ).toEqual({ status: "loaded", runs: [] });
  });

  it("types a non-empty run list as loaded data", () => {
    expect(
      resolveScheduleRunsQueryResult({
        enabled: true,
        canFetch: true,
        data: RUNS,
        isPlaceholderData: false,
        error: null,
      }),
    ).toEqual({ status: "loaded", runs: RUNS });
  });

  it("surfaces a cold-load error", () => {
    const error = new Error("schedule/logs failed");
    expect(
      resolveScheduleRunsQueryResult({
        enabled: true,
        canFetch: true,
        data: undefined,
        isPlaceholderData: false,
        error,
      }),
    ).toEqual({ status: "error", error });
  });

  it("keeps cached runs available while the sheet is closed", () => {
    expect(
      resolveScheduleRunsQueryResult({
        enabled: false,
        canFetch: true,
        data: RUNS,
        isPlaceholderData: false,
        error: null,
      }),
    ).toEqual({ status: "loaded", runs: RUNS });
  });

  it("keeps previous runs in connecting state when the host drops", () => {
    expect(
      resolveScheduleRunsQueryResult({
        enabled: true,
        canFetch: false,
        data: RUNS,
        isPlaceholderData: true,
        error: null,
      }),
    ).toEqual({ status: "connecting" });
  });

  it("keeps previous runs in loading state during a refetch", () => {
    expect(
      resolveScheduleRunsQueryResult({
        enabled: true,
        canFetch: true,
        data: RUNS,
        isPlaceholderData: true,
        error: null,
      }),
    ).toEqual({ status: "loading" });
  });
});
