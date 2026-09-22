import type { ScheduleRun } from "@getpaseo/protocol/schedule/types";
import { formatDuration, formatMessageTimestamp, formatTimeAgo } from "@/utils/time";

/** Status filter for the run list; "running" runs only appear under "All". */
export type ScheduleRunStatusFilter = "all" | "failed" | "succeeded";

export const RUN_STATUS_FILTER_OPTIONS: {
  value: ScheduleRunStatusFilter;
  label: string;
  testID: string;
}[] = [
  { value: "all", label: "All", testID: "schedule-runs-filter-all" },
  { value: "failed", label: "Failed", testID: "schedule-runs-filter-failed" },
  { value: "succeeded", label: "Succeeded", testID: "schedule-runs-filter-succeeded" },
];

/** Empty-state copy when a status filter hides every run. */
export function resolveFilteredEmptyLabel(filter: ScheduleRunStatusFilter): string {
  switch (filter) {
    case "failed":
      return "No failed runs";
    case "succeeded":
      return "No successful runs";
    case "all":
      return "No runs";
  }
}

/** Render-ready model for one run row in the list. */
export interface ScheduleRunRowModel {
  run: ScheduleRun;
  /** Absolute started-at time — "22:11" today, "Wednesday 22:11" this week, "14 May, 22:11" older. */
  title: string;
  /** "1m 12s" for finished runs; "Running · 45s" live elapsed otherwise. */
  durationLabel: string;
  isRunning: boolean;
  /** Single-line preview; the error message wins over output when present. */
  preview: string;
  /** True when `preview` came from run.error, so the row can render it red. */
  previewIsError: boolean;
}

export function buildScheduleRunRowModel(run: ScheduleRun, now: number): ScheduleRunRowModel {
  const startedMs = Date.parse(run.startedAt);
  const isRunning = run.status === "running";
  const durationLabel = run.endedAt
    ? formatDuration(Date.parse(run.endedAt) - startedMs)
    : `Running · ${formatDuration(now - startedMs)}`;
  const errorText = run.error != null && run.error.trim().length > 0 ? run.error : null;
  const previewSource = errorText ?? run.output ?? "";

  return {
    run,
    title: formatMessageTimestamp(new Date(startedMs), new Date(now)),
    durationLabel,
    isRunning,
    preview: previewSource.replace(/\s+/g, " ").trim(),
    previewIsError: errorText != null,
  };
}

export function filterScheduleRuns(
  runs: ScheduleRun[],
  filter: ScheduleRunStatusFilter,
): ScheduleRun[] {
  if (filter === "all") {
    return runs;
  }
  return runs.filter((run) => run.status === filter);
}

/** One calendar-day bucket of run rows, labelled for a section header. */
export interface ScheduleRunDayGroup {
  label: string;
  runs: ScheduleRun[];
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayGroupLabel(day: Date, now: Date): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (localDayKey(day) === localDayKey(now)) {
    return "Today";
  }
  if (localDayKey(day) === localDayKey(yesterday)) {
    return "Yesterday";
  }
  const sameYear = day.getFullYear() === now.getFullYear();
  return day.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? null : { year: "numeric" }),
  });
}

/**
 * Bucket newest-first runs into calendar-day groups, preserving order. Runs are
 * expected pre-sorted (newest first) from useScheduleRuns.
 */
export function groupScheduleRunsByDay(runs: ScheduleRun[], now: number): ScheduleRunDayGroup[] {
  const nowDate = new Date(now);
  const groups: ScheduleRunDayGroup[] = [];
  const groupsByDay = new Map<string, ScheduleRunDayGroup>();

  for (const run of runs) {
    const started = new Date(Date.parse(run.startedAt));
    const key = localDayKey(started);
    let group = groupsByDay.get(key);
    if (!group) {
      group = { label: dayGroupLabel(started, nowDate), runs: [] };
      groupsByDay.set(key, group);
      groups.push(group);
    }
    group.runs.push(run);
  }

  return groups;
}

/** Metadata block rendered at the top of a run's detail view. */
export interface ScheduleRunDetailMeta {
  isRunning: boolean;
  /** Absolute started-at time, same shape as the row title. */
  startedLabel: string;
  startedAgoLabel: string;
  /** Total duration, or live elapsed while running. */
  durationLabel: string;
  /** Present only when the run started >1 minute after its scheduled time. */
  lateLabel: string | null;
}

const LATE_THRESHOLD_MS = 60_000;

export function buildScheduleRunDetailMeta(run: ScheduleRun, now: number): ScheduleRunDetailMeta {
  const startedMs = Date.parse(run.startedAt);
  const scheduledMs = Date.parse(run.scheduledFor);
  const isRunning = run.status === "running";
  const lateMs = startedMs - scheduledMs;

  return {
    isRunning,
    startedLabel: formatMessageTimestamp(new Date(startedMs), new Date(now)),
    startedAgoLabel: formatTimeAgo(new Date(startedMs), new Date(now)),
    durationLabel: run.endedAt
      ? formatDuration(Date.parse(run.endedAt) - startedMs)
      : `Running · ${formatDuration(now - startedMs)}`,
    lateLabel: lateMs > LATE_THRESHOLD_MS ? `Started ${formatDuration(lateMs)} late` : null,
  };
}

/** Header subtitle for the list view: "12 runs · latest 5m ago". */
export function resolveRunsHeaderLabel(runs: ScheduleRun[], now: number): string {
  const countLabel = runs.length === 1 ? "1 run" : `${runs.length} runs`;
  const latestStarted = runs.reduce(
    (latest, run) => Math.max(latest, Date.parse(run.startedAt)),
    Number.NEGATIVE_INFINITY,
  );
  return `${countLabel} · latest ${formatTimeAgo(new Date(latestStarted), new Date(now))}`;
}
