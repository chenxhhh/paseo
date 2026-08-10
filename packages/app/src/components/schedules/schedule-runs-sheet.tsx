import { useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronRight, ExternalLink } from "lucide-react-native";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useScheduleRuns } from "@/hooks/use-schedule-runs";
import { settingsStyles } from "@/styles/settings";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { resolveScheduleTitle } from "@/utils/schedule-format";
import { formatDuration, formatTimeAgo } from "@/utils/time";
import type { Theme } from "@/styles/theme";
import type { ScheduleRun, ScheduleSummary } from "@getpaseo/protocol/schedule/types";
import {
  resolveRunSheetBodyState,
  type ScheduleRunSheetBodyState,
  type ScheduleRunsSheetView,
} from "./schedule-runs-sheet-state";

// Themed lucide wrappers — module-scope so only the icon re-renders on theme
// change (never call useUnistyles in render). See docs/unistyles.md.
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedExternalLink = withUnistyles(ExternalLink);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

// Runs have no server-side cap on output length (see docs/handoff); truncate
// before handing the text to the markdown renderer to bound render cost.
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

  // Reset the drill-down whenever the sheet closes so the next open always
  // lands on the run list.
  useEffect(() => {
    if (!visible) {
      setView({ kind: "list" });
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

  const header = useMemo<SheetHeader>(() => {
    if (view.kind === "detail") {
      return {
        title: "Run output",
        back: { onPress: handleBack, label: "Run history" },
      };
    }
    return {
      title: "Run history",
      subtitle: resolveScheduleTitle(schedule),
    };
  }, [handleBack, schedule, view.kind]);

  const reconnecting = result.status === "connecting";

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
  onOpenRun,
  onRetry,
  retrying,
}: {
  state: ScheduleRunSheetBodyState;
  reconnecting: boolean;
  serverId: string;
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
      </View>
    );
  }

  if (state.kind === "detail") {
    return <ScheduleRunDetail run={state.run} />;
  }

  return <ScheduleRunsList runs={state.runs} serverId={serverId} onOpenRun={onOpenRun} />;
}

function ScheduleRunsList({
  runs,
  serverId,
  onOpenRun,
}: {
  runs: ScheduleRun[];
  serverId: string;
  onOpenRun: (runId: string) => void;
}): ReactElement {
  return (
    <View style={settingsStyles.card}>
      {runs.map((run, index) => (
        <ScheduleRunRow
          key={run.id}
          run={run}
          serverId={serverId}
          isFirst={index === 0}
          onOpenRun={onOpenRun}
        />
      ))}
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
 * One run as a settings-style row: started-at title, a duration/preview meta
 * line, a status badge, the agent shortcut (when the run spawned one), and a
 * chevron marking the drill-down. Hover lives on the outer plain View
 * (docs/hover.md): the inner Pressable owns press, and the nested agent button
 * stops propagation so it never fights the row's drill-down.
 */
function ScheduleRunRow({
  run,
  serverId,
  isFirst,
  onOpenRun,
}: {
  run: ScheduleRun;
  serverId: string;
  isFirst: boolean;
  onOpenRun: (runId: string) => void;
}): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const badge = runBadge(run);
  const handleOpen = useCallback(() => onOpenRun(run.id), [onOpenRun, run.id]);

  const durationLabel = run.endedAt
    ? formatDuration(Date.parse(run.endedAt) - Date.parse(run.startedAt))
    : "Running…";
  const preview = (run.error ?? run.output ?? "").replace(/\s+/g, " ").trim();

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
        accessibilityLabel={`Run ${formatTimeAgo(new Date(run.startedAt))}`}
        testID={`schedule-run-${run.id}`}
      >
        <View style={styles.runMain}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {formatTimeAgo(new Date(run.startedAt))}
          </Text>
          <Text style={settingsStyles.rowHint} numberOfLines={1}>
            {durationLabel}
            {preview ? ` · ${preview}` : ""}
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

function ScheduleRunDetail({ run }: { run: ScheduleRun }): ReactElement {
  const output = run.output ?? "";
  const isTruncated = output.length > MAX_OUTPUT_CHARS;
  const displayOutput = isTruncated ? output.slice(0, MAX_OUTPUT_CHARS) : output;

  return (
    <View style={styles.detail}>
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
    fontSize: theme.fontSize.xs,
    textAlign: "center",
  },
  detailError: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
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
  detail: {
    gap: theme.spacing[3],
  },
}));
