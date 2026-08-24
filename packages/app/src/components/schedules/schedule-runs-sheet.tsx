import { useRouter, type Href } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight, Copy, ExternalLink } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/contexts/toast-context";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useScheduleMutations } from "@/hooks/use-schedule-mutations";
import { useScheduleRuns } from "@/hooks/use-schedule-runs";
import { settingsStyles } from "@/styles/settings";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { resolveScheduleTitle } from "@/utils/schedule-format";
import { formatTimeAgo } from "@/utils/time";
import type { Theme } from "@/styles/theme";
import type { ScheduleRun, ScheduleSummary } from "@getpaseo/protocol/schedule/types";
import {
  resolveRunSheetBodyState,
  type ScheduleRunSheetBodyState,
  type ScheduleRunsSheetView,
} from "./schedule-runs-sheet-state";
import {
  RUN_STATUS_FILTER_OPTIONS,
  buildScheduleRunDetailMeta,
  buildScheduleRunRowModel,
  filterScheduleRuns,
  groupScheduleRunsByDay,
  resolveFilteredEmptyLabel,
  resolveRunsHeaderLabel,
  type ScheduleRunStatusFilter,
} from "./schedule-runs-view-model";

// Themed lucide wrappers — module-scope so only the icon re-renders on theme
// change (never call useUnistyles in render). See docs/unistyles.md.
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedCopy = withUnistyles(Copy);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// Runs have no server-side cap on output length; truncate
// before handing the text to the markdown renderer to bound render cost.
// Copy always uses the untruncated output.
export const MAX_OUTPUT_CHARS = 50_000;

interface ScheduleRunsSheetProps {
  serverId?: string;
  schedule?: ScheduleSummary;
  visible: boolean;
  onClose: () => void;
}

export function ScheduleRunsSheet({
  serverId,
  schedule,
  visible,
  onClose,
}: ScheduleRunsSheetProps): ReactElement | null {
  // Snapshot the props of the last visible open, mirroring ScheduleFormSheet:
  // the sheet stays mounted across close so the exit animation plays, and the
  // open props survive even after the screen's state flips back to "closed".
  const [rendered, setRendered] = useState<{
    serverId: string;
    schedule: ScheduleSummary;
  } | null>(() => (visible && serverId && schedule ? { serverId, schedule } : null));

  useEffect(() => {
    if (visible && serverId && schedule) {
      setRendered({ serverId, schedule });
    }
  }, [visible, serverId, schedule]);

  if (!rendered) {
    return null;
  }

  return (
    <OpenScheduleRunsSheet
      serverId={rendered.serverId}
      schedule={rendered.schedule}
      visible={visible}
      onClose={onClose}
    />
  );
}

function OpenScheduleRunsSheet({
  serverId,
  schedule,
  visible,
  onClose,
}: {
  serverId: string;
  schedule: ScheduleSummary;
  visible: boolean;
  onClose: () => void;
}): ReactElement {
  const [view, setView] = useState<ScheduleRunsSheetView>({ kind: "list" });
  const [statusFilter, setStatusFilter] = useState<ScheduleRunStatusFilter>("all");

  // Reset the drill-down and the filter whenever the sheet closes so the next
  // open always lands on the full run list.
  useEffect(() => {
    if (!visible) {
      setView({ kind: "list" });
      setStatusFilter("all");
    }
  }, [visible]);

  const { result, refetch, isRefetching } = useScheduleRuns({
    serverId,
    scheduleId: schedule.id,
    enabled: visible,
  });

  const bodyState = useMemo(() => resolveRunSheetBodyState({ result, view }), [result, view]);

  // The run being viewed disappeared from the list (deleted or trimmed
  // server-side); fall back to the list view instead of a dead-end detail page.
  useEffect(() => {
    if (bodyState.kind === "detail-missing") {
      setView({ kind: "list" });
    }
  }, [bodyState.kind]);

  const handleOpenRun = useCallback((runId: string) => {
    setView({ kind: "detail", runId });
  }, []);
  const handleBack = useCallback(() => setView({ kind: "list" }), []);

  const toast = useToast();
  const detailRun = bodyState.kind === "detail" ? bodyState.run : null;
  const handleCopy = useCallback(() => {
    const output = detailRun?.output;
    if (!output) {
      return;
    }
    void Clipboard.setStringAsync(output)
      .then(() => toast.copied("Run output"))
      .catch(() => toast.error("Copy failed"));
  }, [detailRun, toast]);

  const copyButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.headerIconButton,
      (Boolean(hovered) || pressed) && styles.headerIconButtonHovered,
      detailRun?.output ? null : styles.headerIconButtonDisabled,
    ],
    [detailRun],
  );

  // Rerender time-dependent labels (elapsed running time, "latest X ago")
  // whenever fresh run data arrives — the query polls every 5s while a run is
  // in flight. The dep is the result identity, not a value read inside.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [result]);

  const header = useMemo<SheetHeader>(() => {
    if (view.kind === "detail") {
      return {
        title: "Run output",
        back: { onPress: handleBack, label: "Run history" },
        actions: (
          <Pressable
            onPress={handleCopy}
            disabled={!detailRun?.output}
            hitSlop={8}
            style={copyButtonStyle}
            accessibilityRole="button"
            accessibilityLabel="Copy run output"
            testID="schedule-runs-copy"
          >
            <ThemedCopy size={16} uniProps={mutedColorMapping} />
          </Pressable>
        ),
      };
    }
    const runsLabel =
      result.status === "loaded" && result.runs.length > 0
        ? resolveRunsHeaderLabel(result.runs, now)
        : null;
    return {
      title: "Run history",
      subtitle: runsLabel
        ? `${resolveScheduleTitle(schedule)} · ${runsLabel}`
        : resolveScheduleTitle(schedule),
    };
  }, [copyButtonStyle, detailRun, handleBack, handleCopy, now, result, schedule, view.kind]);

  const reconnecting = result.status === "connecting";

  // The empty state's "Run now" CTA reuses the schedules mutations; the settle
  // invalidation already refreshes this sheet's runs query (prefix match on the
  // shared "schedules" key), so the new run appears without extra wiring.
  const mutations = useScheduleMutations({ serverId });
  const [runNowPending, setRunNowPending] = useState(false);
  const canRunNow =
    schedule.status === "active" && schedule.target.type === "new-agent" && !runNowPending;
  const handleRunNow = useCallback(() => {
    setRunNowPending(true);
    mutations
      .runScheduleNow(schedule.id)
      .catch(() => {
        // The mutation rolls back its optimistic cache and refetches on error;
        // surfacing a toast here is out of scope.
      })
      .finally(() => {
        setRunNowPending(false);
      });
  }, [mutations, schedule.id]);

  // Tapping outside the sheet (or Escape) steps back one drill-down level
  // instead of always closing the whole sheet: from a run's output it returns
  // to the run list, from the list it closes. The X button and swipe-down still
  // close from anywhere.
  const handleBackdropPress = useCallback(() => {
    if (view.kind === "detail") {
      setView({ kind: "list" });
      return;
    }
    onClose();
  }, [onClose, view.kind]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      onBackdropPress={handleBackdropPress}
      // Runs carry long output and a multi-row list, so the sheet is larger
      // than the default modal.
      desktopMaxWidth={760}
      snapPoints={["70%", "94%"]}
      testID="schedule-runs-sheet"
    >
      <ScheduleRunsSheetBody
        state={bodyState}
        reconnecting={reconnecting}
        serverId={serverId}
        now={now}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        canRunNow={canRunNow}
        runNowPending={runNowPending}
        onRunNow={handleRunNow}
        onOpenRun={handleOpenRun}
        onRetry={refetch}
        retrying={isRefetching}
      />
    </AdaptiveModalSheet>
  );
}

function ScheduleRunsSheetBody({
  state,
  reconnecting,
  serverId,
  now,
  statusFilter,
  onStatusFilterChange,
  canRunNow,
  runNowPending,
  onRunNow,
  onOpenRun,
  onRetry,
  retrying,
}: {
  state: ScheduleRunSheetBodyState;
  reconnecting: boolean;
  serverId: string;
  now: number;
  statusFilter: ScheduleRunStatusFilter;
  onStatusFilterChange: (filter: ScheduleRunStatusFilter) => void;
  canRunNow: boolean;
  runNowPending: boolean;
  onRunNow: () => void;
  onOpenRun: (runId: string) => void;
  onRetry: () => void;
  retrying: boolean;
}): ReactElement {
  // detail-missing is transient: the sheet effect flips the view back to the
  // list immediately, so render the same sized container to avoid layout jump.
  if (state.kind === "loading" || state.kind === "detail-missing") {
    return (
      <View style={styles.centered}>
        <LoadingSpinner size="large" color={styles.spinner.color} />
        {reconnecting ? <Text style={styles.mutedHint}>Reconnecting…</Text> : null}
      </View>
    );
  }

  if (state.kind === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{state.error.message}</Text>
        <Button variant="ghost" onPress={onRetry} disabled={retrying} testID="schedule-runs-retry">
          Try again
        </Button>
      </View>
    );
  }

  if (state.kind === "empty") {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No runs yet</Text>
        {canRunNow ? (
          <Button
            variant="ghost"
            onPress={onRunNow}
            disabled={runNowPending}
            testID="schedule-runs-empty-run-now"
          >
            {runNowPending ? "Starting…" : "Run now"}
          </Button>
        ) : null}
      </View>
    );
  }

  if (state.kind === "detail") {
    return <ScheduleRunDetail run={state.run} now={now} serverId={serverId} />;
  }

  return (
    <ScheduleRunsList
      runs={state.runs}
      serverId={serverId}
      now={now}
      statusFilter={statusFilter}
      onStatusFilterChange={onStatusFilterChange}
      onOpenRun={onOpenRun}
    />
  );
}

function ScheduleRunsList({
  runs,
  serverId,
  now,
  statusFilter,
  onStatusFilterChange,
  onOpenRun,
}: {
  runs: ScheduleRun[];
  serverId: string;
  now: number;
  statusFilter: ScheduleRunStatusFilter;
  onStatusFilterChange: (filter: ScheduleRunStatusFilter) => void;
  onOpenRun: (runId: string) => void;
}): ReactElement {
  const filtered = useMemo(() => filterScheduleRuns(runs, statusFilter), [runs, statusFilter]);
  const groups = useMemo(() => groupScheduleRunsByDay(filtered, now), [filtered, now]);

  // The filter control always renders in the list view: an empty filtered
  // result swaps the body below it, never the control itself — otherwise a
  // filter with no matches strands the user on the empty state.
  return (
    <View style={styles.list}>
      <SegmentedControl
        size="xs"
        value={statusFilter}
        onValueChange={onStatusFilterChange}
        options={RUN_STATUS_FILTER_OPTIONS}
        testID="schedule-runs-filter"
      />
      {filtered.length === 0 ? (
        <View style={styles.filteredEmpty}>
          <Text style={styles.emptyText}>{resolveFilteredEmptyLabel(statusFilter)}</Text>
        </View>
      ) : (
        groups.map((group) => (
          <View key={group.label} style={styles.group}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            <View style={settingsStyles.card}>
              {group.runs.map((run, index) => (
                <ScheduleRunRow
                  key={run.id}
                  run={run}
                  serverId={serverId}
                  now={now}
                  isFirst={index === 0}
                  onOpenRun={onOpenRun}
                />
              ))}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function runBadge(run: ScheduleRun): {
  label: string;
  variant: "success" | "error" | "muted";
} {
  switch (run.status) {
    case "succeeded":
      return { label: "Succeeded", variant: "success" };
    case "failed":
      return { label: "Failed", variant: "error" };
    case "running":
      return { label: "Running", variant: "muted" };
  }
}

/**
 * One run as a settings-style row: absolute started-at title, a duration /
 * preview meta line (the preview renders red when it came from the run's
 * error), a status badge, the agent shortcut (when the run spawned one), and a
 * chevron marking the drill-down. Hover lives on the outer plain View
 * (docs/hover.md): the inner Pressable owns press, and the nested agent button
 * stops propagation so it never fights the row's drill-down.
 */
function ScheduleRunRow({
  run,
  serverId,
  now,
  isFirst,
  onOpenRun,
}: {
  run: ScheduleRun;
  serverId: string;
  now: number;
  isFirst: boolean;
  onOpenRun: (runId: string) => void;
}): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const model = useMemo(() => buildScheduleRunRowModel(run, now), [run, now]);
  const badge = runBadge(run);
  const handleOpen = useCallback(() => onOpenRun(run.id), [onOpenRun, run.id]);

  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      settingsStyles.row,
      styles.runRow,
      !isFirst && settingsStyles.rowBorder,
      isHovered && !isCompact && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst, isHovered, isCompact],
  );

  return (
    <View
      style={styles.runRowContainer}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        style={rowStyle}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={`Run started ${formatTimeAgo(new Date(run.startedAt), new Date(now))}`}
        testID={`schedule-run-${run.id}`}
      >
        <View style={styles.runMain}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {model.title}
          </Text>
          <Text style={settingsStyles.rowHint} numberOfLines={1}>
            {model.durationLabel}
            {model.preview ? " · " : null}
            {model.preview ? (
              <Text style={model.previewIsError ? styles.previewError : undefined}>
                {model.preview}
              </Text>
            ) : null}
          </Text>
        </View>
        <View style={styles.runTrailing}>
          <StatusBadge label={badge.label} variant={badge.variant} />
          {run.agentId ? <OpenRunAgentButton serverId={serverId} run={run} /> : null}
          <ThemedChevronRight size={16} uniProps={mutedColorMapping} />
        </View>
      </Pressable>
    </View>
  );
}

function OpenRunAgentButton({
  serverId,
  run,
}: {
  serverId: string;
  run: ScheduleRun;
}): ReactElement {
  const router = useRouter();
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      // The button sits inside the row's Pressable; stop the drill-down from
      // also firing when navigating to the agent.
      event.stopPropagation();
      if (!run.agentId) {
        return;
      }
      const route = buildHostAgentDetailRoute(serverId, run.agentId, run.workspaceId ?? undefined);
      router.push(route as Href);
    },
    [router, run.agentId, run.workspaceId, serverId],
  );
  const buttonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.agentButton,
      pressed && styles.agentButtonPressed,
    ],
    [],
  );

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={8}
      style={buttonStyle}
      accessibilityRole="button"
      accessibilityLabel="Open agent"
      testID={`schedule-run-open-agent-${run.id}`}
    >
      <ThemedExternalLink size={14} uniProps={mutedColorMapping} />
    </Pressable>
  );
}

/** The metadata card pinned above a run's output: status, timing, delay, agent. */
function RunDetailMetaCard({
  run,
  meta,
  serverId,
}: {
  run: ScheduleRun;
  meta: ReturnType<typeof buildScheduleRunDetailMeta>;
  serverId: string;
}): ReactElement {
  const router = useRouter();
  const badge = runBadge(run);
  const handleOpenAgent = useCallback(() => {
    if (!run.agentId) {
      return;
    }
    const route = buildHostAgentDetailRoute(serverId, run.agentId, run.workspaceId ?? undefined);
    router.push(route as Href);
  }, [router, run.agentId, run.workspaceId, serverId]);

  const agentRowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      settingsStyles.row,
      settingsStyles.rowBorder,
      styles.agentRow,
      pressed && styles.rowPressed,
    ],
    [],
  );

  return (
    <View style={settingsStyles.card} testID="schedule-run-detail-meta">
      <View style={[settingsStyles.row, styles.metaRow]}>
        <View style={styles.runMain}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {meta.startedLabel}
          </Text>
          <Text style={settingsStyles.rowHint} numberOfLines={1}>
            {`Started ${meta.startedAgoLabel} · ${meta.durationLabel}`}
          </Text>
        </View>
        <StatusBadge label={badge.label} variant={badge.variant} />
      </View>
      {meta.lateLabel ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <Text style={styles.detailError}>{meta.lateLabel}</Text>
        </View>
      ) : null}
      {run.agentId ? (
        <Pressable
          style={agentRowStyle}
          onPress={handleOpenAgent}
          accessibilityRole="button"
          accessibilityLabel="Open agent"
          testID="schedule-run-detail-open-agent"
        >
          <Text style={settingsStyles.rowTitle}>Open agent</Text>
          <ThemedChevronRight size={16} uniProps={mutedColorMapping} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ScheduleRunDetail({
  run,
  now,
  serverId,
}: {
  run: ScheduleRun;
  now: number;
  serverId: string;
}): ReactElement {
  const meta = useMemo(() => buildScheduleRunDetailMeta(run, now), [run, now]);
  const output = run.output ?? "";
  const isTruncated = output.length > MAX_OUTPUT_CHARS;
  const displayOutput = isTruncated ? output.slice(0, MAX_OUTPUT_CHARS) : output;

  return (
    <View style={styles.detail}>
      <RunDetailMetaCard run={run} meta={meta} serverId={serverId} />
      {/* error and output can coexist; both render, error first */}
      {run.error ? <Text style={styles.detailError}>{run.error}</Text> : null}
      {displayOutput.length > 0 ? (
        <MarkdownRenderer text={displayOutput} compact />
      ) : (
        <Text style={styles.mutedHint}>No output</Text>
      )}
      {isTruncated ? <Text style={styles.mutedHint}>…(output truncated)</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Same-sized state containers keep the body from jumping between loading /
  // empty / error / list (docs/design.md §11).
  centered: {
    flex: 1,
    minHeight: 200,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[8],
  },
  // Filtered-out body: sits under the filter control, sized like `centered`
  // so switching filters never resizes the sheet body (docs/design.md §11).
  filteredEmpty: {
    minHeight: 200,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: theme.spacing[8],
  },
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  mutedHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  detailError: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  previewError: {
    color: theme.colors.palette.red[300],
  },
  list: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  group: {
    gap: theme.spacing[2],
  },
  groupLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  runRowContainer: {
    position: "relative",
  },
  runRow: {
    gap: theme.spacing[3],
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  runMain: {
    flex: 1,
    minWidth: 0,
  },
  runTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  agentButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  agentButtonPressed: {
    backgroundColor: theme.colors.surface2,
  },
  headerIconButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  headerIconButtonDisabled: {
    opacity: 0.4,
  },
  metaRow: {
    gap: theme.spacing[3],
  },
  agentRow: {
    justifyContent: "space-between",
  },
  detail: {
    gap: theme.spacing[3],
  },
}));
