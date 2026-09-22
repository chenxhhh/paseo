import { describe, expect, it } from "vitest";
import type { ScheduleRun } from "@getpaseo/protocol/schedule/types";
import { formatMessageTimestamp } from "@/utils/time";
import {
  buildScheduleRunDetailMeta,
  buildScheduleRunRowModel,
  filterScheduleRuns,
  groupScheduleRunsByDay,
  resolveFilteredEmptyLabel,
  resolveRunsHeaderLabel,
} from "./schedule-runs-view-model";

// All dates are built with the local-time Date constructor so calendar-day
// bucketing is deterministic in any runner timezone.
const NOW = new Date(2026, 7, 23, 12, 0, 0).getTime();
const NOW_MS = NOW;

function runAt(overrides: Partial<ScheduleRun>): ScheduleRun {
  return {
    id: "run-1",
    scheduledFor: new Date(2026, 7, 23, 10, 0).toISOString(),
    startedAt: new Date(2026, 7, 23, 10, 0).toISOString(),
    endedAt: new Date(2026, 7, 23, 10, 5).toISOString(),
    status: "succeeded",
    agentId: null,
    workspaceId: null,
    output: "done",
    error: null,
    ...overrides,
  };
}

describe("buildScheduleRunRowModel", () => {
  it("builds a finished row with total duration and an output preview", () => {
    const model = buildScheduleRunRowModel(runAt({}), NOW_MS);
    expect(model.title).toBe(
      formatMessageTimestamp(new Date(Date.parse(runAt({}).startedAt)), new Date(NOW_MS)),
    );
    expect(model.durationLabel).toBe("5m");
    expect(model.isRunning).toBe(false);
    expect(model.preview).toBe("done");
    expect(model.previewIsError).toBe(false);
  });

  it("flattens whitespace in the preview to a single line", () => {
    const model = buildScheduleRunRowModel(
      runAt({ output: "# Summary\n\n- item one\n- item two" }),
      NOW_MS,
    );
    expect(model.preview).toBe("# Summary - item one - item two");
  });

  it("prefers the error text and flags it so the row renders it red", () => {
    const model = buildScheduleRunRowModel(
      runAt({ status: "failed", error: "Agent failed", output: "partial output" }),
      NOW_MS,
    );
    expect(model.preview).toBe("Agent failed");
    expect(model.previewIsError).toBe(true);
  });

  it("shows live elapsed time for a running run", () => {
    const startedAt = new Date(2026, 7, 23, 11, 59, 30).toISOString();
    const model = buildScheduleRunRowModel(
      runAt({ startedAt, endedAt: null, status: "running", output: null }),
      NOW_MS,
    );
    expect(model.isRunning).toBe(true);
    expect(model.durationLabel).toBe("Running · 30s");
  });

  it("yields an empty preview when a run has neither output nor error", () => {
    const model = buildScheduleRunRowModel(runAt({ output: null }), NOW_MS);
    expect(model.preview).toBe("");
    expect(model.previewIsError).toBe(false);
  });

  it("does not flag an empty error string as an error preview", () => {
    const model = buildScheduleRunRowModel(runAt({ error: "", output: "ok" }), NOW_MS);
    expect(model.preview).toBe("ok");
    expect(model.previewIsError).toBe(false);
  });
});

describe("filterScheduleRuns", () => {
  const succeeded = runAt({ id: "a", status: "succeeded" });
  const failed = runAt({ id: "b", status: "failed" });
  const running = runAt({ id: "c", status: "running", endedAt: null });
  const runs = [running, failed, succeeded];

  it("passes every run through under all", () => {
    expect(filterScheduleRuns(runs, "all")).toEqual(runs);
  });

  it("keeps only failed runs", () => {
    expect(filterScheduleRuns(runs, "failed")).toEqual([failed]);
  });

  it("keeps only succeeded runs", () => {
    expect(filterScheduleRuns(runs, "succeeded")).toEqual([succeeded]);
  });
});

describe("resolveFilteredEmptyLabel", () => {
  it("labels each filter's empty state", () => {
    expect(resolveFilteredEmptyLabel("all")).toBe("No runs");
    expect(resolveFilteredEmptyLabel("failed")).toBe("No failed runs");
    expect(resolveFilteredEmptyLabel("succeeded")).toBe("No successful runs");
  });
});

describe("groupScheduleRunsByDay", () => {
  it("returns no groups for an empty list", () => {
    expect(groupScheduleRunsByDay([], NOW_MS)).toEqual([]);
  });

  it("buckets runs into Today, Yesterday, and a dated group, preserving order", () => {
    const todayRun = runAt({ id: "today", startedAt: new Date(2026, 7, 23, 9, 0).toISOString() });
    const todayEarlier = runAt({
      id: "today-early",
      startedAt: new Date(2026, 7, 23, 8, 0).toISOString(),
    });
    const yesterdayRun = runAt({
      id: "yesterday",
      startedAt: new Date(2026, 7, 22, 18, 0).toISOString(),
    });
    const olderRun = runAt({
      id: "older",
      startedAt: new Date(2026, 7, 15, 10, 0).toISOString(),
    });

    const groups = groupScheduleRunsByDay([todayRun, todayEarlier, yesterdayRun, olderRun], NOW_MS);

    // The older-day label uses the runner locale; compute it the same way.
    const olderLabel = new Date(2026, 7, 15).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday", olderLabel]);
    expect(groups[0].runs).toEqual([todayRun, todayEarlier]);
    expect(groups[1].runs).toEqual([yesterdayRun]);
    expect(groups[2].runs).toEqual([olderRun]);
  });

  it("labels groups from a different year with the year", () => {
    const oldYearRun = runAt({
      id: "old-year",
      startedAt: new Date(2025, 11, 30, 10, 0).toISOString(),
    });
    const groups = groupScheduleRunsByDay([oldYearRun], NOW_MS);
    // The exact month spelling is locale-dependent; assert the shape.
    expect(groups[0].label).toMatch(/2025/);
  });

  it("keeps a run started just after midnight in the same Today bucket", () => {
    const midnightRun = runAt({
      id: "midnight",
      startedAt: new Date(2026, 7, 23, 0, 1).toISOString(),
    });
    const groups = groupScheduleRunsByDay([midnightRun], NOW_MS);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Today");
  });
});

describe("buildScheduleRunDetailMeta", () => {
  it("describes a finished, on-time run without a late label", () => {
    const meta = buildScheduleRunDetailMeta(runAt({}), NOW_MS);
    expect(meta.isRunning).toBe(false);
    expect(meta.durationLabel).toBe("5m");
    expect(meta.lateLabel).toBeNull();
    expect(meta.startedAgoLabel).toBe("2h ago");
  });

  it("reports a late start only beyond one minute of delay", () => {
    const onTime = buildScheduleRunDetailMeta(
      runAt({
        scheduledFor: new Date(2026, 7, 23, 10, 0).toISOString(),
        startedAt: new Date(2026, 7, 23, 10, 0, 30).toISOString(),
      }),
      NOW_MS,
    );
    expect(onTime.lateLabel).toBeNull();

    const late = buildScheduleRunDetailMeta(
      runAt({
        scheduledFor: new Date(2026, 7, 23, 10, 0).toISOString(),
        startedAt: new Date(2026, 7, 23, 10, 2, 30).toISOString(),
      }),
      NOW_MS,
    );
    expect(late.lateLabel).toBe("Started 2m 30s late");
  });

  it("never reports an early start as late", () => {
    const meta = buildScheduleRunDetailMeta(
      runAt({
        scheduledFor: new Date(2026, 7, 23, 10, 5).toISOString(),
        startedAt: new Date(2026, 7, 23, 10, 0).toISOString(),
      }),
      NOW_MS,
    );
    expect(meta.lateLabel).toBeNull();
  });

  it("shows live elapsed time while running", () => {
    const meta = buildScheduleRunDetailMeta(
      runAt({
        startedAt: new Date(2026, 7, 23, 11, 58).toISOString(),
        endedAt: null,
        status: "running",
      }),
      NOW_MS,
    );
    expect(meta.isRunning).toBe(true);
    expect(meta.durationLabel).toBe("Running · 2m");
  });
});

describe("resolveRunsHeaderLabel", () => {
  it("counts runs and stamps the latest with a relative time", () => {
    const runs = [
      runAt({ id: "a", startedAt: new Date(2026, 7, 23, 11, 55).toISOString() }),
      runAt({ id: "b", startedAt: new Date(2026, 7, 23, 10, 0).toISOString() }),
    ];
    expect(resolveRunsHeaderLabel(runs, NOW_MS)).toBe("2 runs · latest 5m ago");
  });

  it("uses the singular noun for a single run", () => {
    const runs = [runAt({ id: "a", startedAt: new Date(2026, 7, 23, 12, 0).toISOString() })];
    expect(resolveRunsHeaderLabel(runs, NOW_MS)).toBe("1 run · latest just now");
  });
});
