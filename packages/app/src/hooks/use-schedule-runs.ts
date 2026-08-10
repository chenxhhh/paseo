import type { ScheduleRun } from "@getpaseo/protocol/schedule/types";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { schedulesQueryBaseKey } from "@/schedules/aggregated-schedules";

/**
 * Runs are fetched on demand per schedule and nested under the schedules query
 * base key. The existing `invalidateQueries(["schedules"])` prefix match in
 * use-schedule-mutations therefore automatically refreshes an open run-history
 * sheet whenever any schedule mutation settles (e.g. "Run now" after starting
 * a new run).
 *
 * Known limitation: there is no server-side push when a run flips
 * running → succeeded, so the sheet refreshes on open (`refetchOnMount`) and
 * on mutation settle. Polling to watch a run finish is intentionally out of
 * scope for now.
 */
export function scheduleRunsQueryKey(serverId: string, scheduleId: string) {
  return [...schedulesQueryBaseKey, "runs", serverId, scheduleId] as const;
}

const SCHEDULE_RUNS_STALE_TIME_MS = 10_000;

export interface UseScheduleRunsOptions {
  serverId: string;
  scheduleId: string;
  /** Pass the sheet's `visible` so a closed sheet never fetches. */
  enabled?: boolean;
}

export type ScheduleRunsQueryResult =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "loaded"; runs: ScheduleRun[] };

interface ResolveScheduleRunsQueryResultInput {
  enabled: boolean;
  canFetch: boolean;
  data: ScheduleRun[] | undefined;
  isPlaceholderData: boolean;
  error: Error | null;
}

/**
 * Mirror of the use-commits-query resolver: translate raw react-query state
 * into a small UI-facing union. There is no `unsupported` state here — the
 * schedule/logs RPC has no capability gate (see docs/handoff).
 */
export function resolveScheduleRunsQueryResult({
  enabled,
  canFetch,
  data,
  isPlaceholderData,
  error,
}: ResolveScheduleRunsQueryResultInput): ScheduleRunsQueryResult {
  if (data && !isPlaceholderData) {
    return { status: "loaded", runs: data };
  }
  if (!enabled) {
    return { status: "idle" };
  }
  if (!canFetch) {
    return { status: "connecting" };
  }
  if (error) {
    return { status: "error", error };
  }
  return { status: "loading" };
}

export interface UseScheduleRunsResult {
  result: ScheduleRunsQueryResult;
  refetch: () => void;
  isRefetching: boolean;
}

export function useScheduleRuns({
  serverId,
  scheduleId,
  enabled = true,
}: UseScheduleRunsOptions): UseScheduleRunsResult {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const canFetch = Boolean(client) && isConnected;
  const queryEnabled = enabled && canFetch;

  const query = useFetchQuery<ScheduleRun[]>({
    queryKey: scheduleRunsQueryKey(serverId, scheduleId),
    queryFn: async () => {
      if (!client) {
        throw new Error("Host disconnected");
      }
      const payload = await client.scheduleLogs({ id: scheduleId });
      // `error` is a payload field, not a thrown exception; surface it as a
      // query error so the sheet can offer retry.
      if (payload.error) {
        throw new Error(payload.error);
      }
      // The server stores runs ascending by startedAt; flip so the newest run
      // is at the top of the list.
      return payload.runs.toReversed();
    },
    enabled: queryEnabled,
    staleTimeMs: SCHEDULE_RUNS_STALE_TIME_MS,
    dataShape: "list",
  });

  return {
    result: resolveScheduleRunsQueryResult({
      enabled,
      canFetch,
      data: query.data,
      isPlaceholderData: query.isPlaceholderData,
      error: query.error,
    }),
    refetch: () => {
      void query.refetch();
    },
    isRefetching: query.isRefetching,
  };
}
