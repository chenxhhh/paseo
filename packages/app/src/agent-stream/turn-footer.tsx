import React, { memo, useCallback, useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { SPACING, type Theme } from "@/styles/theme";
import type { TurnTiming } from "@/timeline/turn-time";
import type { StreamItem } from "@/types/stream";
import {
  collectAssistantResponseContentForStreamRenderStrategy,
  type StreamStrategy,
} from "./strategy";
import { resolveAssistantTurnForkBoundary, type AssistantTurnForkBoundary } from "./turn-boundary";
import {
  AssistantTurnFooter,
  LiveElapsed,
  STREAM_METADATA_FONT_SIZE,
  type AssistantForkTarget,
} from "@/components/message";
import type { TurnFooterHost } from "./layout";
import { AssistantForkMenu } from "@/components/assistant-fork-menu";
import { SyncedLoader } from "@/components/synced-loader";
import { useRetainedPanelActive } from "@/components/retained-panel";
import type { TurnCollapseSummary } from "./turn-collapse";
import { TurnResultCardsRow } from "./turn-result-cards";

const ThemedSyncedLoader = withUnistyles(SyncedLoader);
const workingIndicatorColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
export const TURN_FOOTER_BOTTOM_SPACING = SPACING[6];

export type TurnContentStrategy = StreamStrategy;
export type AssistantTurnForkHandler = (input: {
  target: AssistantForkTarget;
  boundary: AssistantTurnForkBoundary;
}) => Promise<void> | void;
/**
 * Fork handler for the turn that is still streaming. It deliberately takes no
 * boundary: `selectForkContextRows` projects the entire timeline when neither
 * boundary field is given, which is what captures the partially streamed text
 * the user is watching. Pinning a boundary here would silently drop the live
 * response — the opposite of what a fork button next to the loader promises.
 *
 * Kept separate from `AssistantTurnForkHandler` (whose `boundary` stays
 * required) so the compiler keeps enforcing that completed turns always pin one.
 */
export type InFlightTurnForkHandler = (target: AssistantForkTarget) => Promise<void> | void;

export interface TurnCollapsePresenter {
  summary: TurnCollapseSummary;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  onOpenFile?: (path: string) => void;
  onOpenChanges?: () => void;
  onOpenWebUrl?: (url: string) => void;
}

function useTurnCollapseResultSummary(summary: TurnCollapseSummary | undefined): string {
  const { t } = useTranslation();
  return useMemo(() => {
    if (!summary) {
      return "";
    }
    const parts: string[] = [];
    if (summary.editedFileCount > 0) {
      parts.push(
        t(`toolCallGroup.editedFiles.${summary.editedFileCount === 1 ? "one" : "other"}`, {
          count: summary.editedFileCount,
        }),
      );
    }
    if (summary.commandCount > 0) {
      parts.push(
        t(`toolCallGroup.commands.${summary.commandCount === 1 ? "one" : "other"}`, {
          count: summary.commandCount,
        }),
      );
    }
    return parts.join(" · ");
  }, [summary, t]);
}

export const TurnFooter = memo(function TurnFooter({
  isRunning,
  inFlightTurnStartedAt,
  host,
  strategy,
  supportsTimelineCursor,
  onForkAssistantTurn,
  onForkInFlightTurn,
  turnCollapse,
}: {
  isRunning: boolean;
  inFlightTurnStartedAt: Date | null;
  host: TurnFooterHost | null;
  strategy: TurnContentStrategy;
  supportsTimelineCursor: boolean;
  onForkAssistantTurn?: AssistantTurnForkHandler;
  onForkInFlightTurn?: InFlightTurnForkHandler;
  turnCollapse?: TurnCollapsePresenter;
}) {
  if (isRunning) {
    return (
      <TurnFooterRow>
        <RunningTurnFooter
          inFlightTurnStartedAt={inFlightTurnStartedAt}
          onForkInFlightTurn={onForkInFlightTurn}
        />
      </TurnFooterRow>
    );
  }
  if (!host) {
    return null;
  }
  return (
    <CompletedTurnFooterRow
      strategy={strategy}
      items={host.items}
      timing={host.timing}
      startIndex={host.startIndex}
      supportsTimelineCursor={supportsTimelineCursor}
      onForkAssistantTurn={onForkAssistantTurn}
      turnCollapse={turnCollapse}
    />
  );
});

function noopPath(_path: string): void {}
function noopUrl(_url: string): void {}
function noop(): void {}

export const CompletedTurnFooterRow = memo(function CompletedTurnFooterRow({
  strategy,
  items,
  timing,
  startIndex,
  supportsTimelineCursor,
  onForkAssistantTurn,
  turnCollapse,
}: {
  strategy: TurnContentStrategy;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
  supportsTimelineCursor: boolean;
  onForkAssistantTurn?: AssistantTurnForkHandler;
  turnCollapse?: TurnCollapsePresenter;
}) {
  const hasResultCards =
    turnCollapse !== undefined &&
    (turnCollapse.summary.files.length > 0 || turnCollapse.summary.webPages.length > 0);
  return (
    <TurnFooterRow>
      {hasResultCards && turnCollapse ? (
        <TurnResultCardsRow
          files={turnCollapse.summary.files}
          webPages={turnCollapse.summary.webPages}
          onOpenFile={turnCollapse.onOpenFile ?? noopPath}
          onOpenChanges={turnCollapse.onOpenChanges ?? noop}
          onOpenWebUrl={turnCollapse.onOpenWebUrl ?? noopUrl}
        />
      ) : null}
      <CompletedTurnFooter
        strategy={strategy}
        items={items}
        timing={timing}
        startIndex={startIndex}
        supportsTimelineCursor={supportsTimelineCursor}
        onForkAssistantTurn={onForkAssistantTurn}
        turnCollapse={turnCollapse}
      />
    </TurnFooterRow>
  );
});

const WorkingIndicator = memo(function WorkingIndicator({
  inFlightTurnStartedAt = null,
  onForkInFlightTurn,
}: {
  inFlightTurnStartedAt?: Date | null;
  onForkInFlightTurn?: InFlightTurnForkHandler;
}) {
  const active = useRetainedPanelActive();
  return (
    <View style={stylesheet.turnFooterContent}>
      <View style={stylesheet.workingLoader}>
        <ThemedSyncedLoader size={14} uniProps={workingIndicatorColorMapping} />
      </View>
      {/* Match the completed-turn footer: actions precede timing metadata. */}
      {onForkInFlightTurn ? <AssistantForkMenu onFork={onForkInFlightTurn} /> : null}
      {inFlightTurnStartedAt ? (
        <LiveElapsed
          startedAt={inFlightTurnStartedAt}
          active={active}
          style={stylesheet.workingElapsed}
          testID="turn-working-elapsed"
        />
      ) : null}
    </View>
  );
});

function RunningTurnFooter({
  inFlightTurnStartedAt,
  onForkInFlightTurn,
}: {
  inFlightTurnStartedAt: Date | null;
  onForkInFlightTurn?: InFlightTurnForkHandler;
}) {
  return (
    <View style={stylesheet.turnFooterSlot} testID="turn-working-indicator">
      <WorkingIndicator
        inFlightTurnStartedAt={inFlightTurnStartedAt}
        onForkInFlightTurn={onForkInFlightTurn}
      />
    </View>
  );
}

function CompletedTurnFooter({
  strategy,
  items,
  timing,
  startIndex,
  supportsTimelineCursor,
  onForkAssistantTurn,
  turnCollapse,
}: {
  strategy: TurnContentStrategy;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
  supportsTimelineCursor: boolean;
  onForkAssistantTurn?: AssistantTurnForkHandler;
  turnCollapse?: TurnCollapsePresenter;
}) {
  const resultSummary = useTurnCollapseResultSummary(turnCollapse?.summary);
  const getContent = useCallback(
    () =>
      collectAssistantResponseContentForStreamRenderStrategy({
        strategy,
        items,
        startIndex,
      }),
    [strategy, items, startIndex],
  );
  const boundary = resolveAssistantTurnForkBoundary({
    items,
    startIndex,
    supportsTimelineCursor,
  });
  const handleFork = useCallback(
    (target: AssistantForkTarget) => {
      if (!boundary) {
        return;
      }
      return onForkAssistantTurn?.({ target, boundary });
    },
    [boundary, onForkAssistantTurn],
  );
  const handleToggleExpanded = useCallback(() => {
    if (!turnCollapse) {
      return;
    }
    turnCollapse.onToggle(!turnCollapse.expanded);
  }, [turnCollapse]);
  return (
    <View style={stylesheet.turnFooterSlot}>
      <AssistantTurnFooter
        getContent={getContent}
        completedAt={timing?.completedAt}
        durationMs={timing?.durationMs}
        onFork={boundary && onForkAssistantTurn ? handleFork : undefined}
        expanded={turnCollapse?.expanded}
        onToggleExpanded={turnCollapse ? handleToggleExpanded : undefined}
        resultSummary={turnCollapse ? resultSummary : undefined}
      />
    </View>
  );
}

function TurnFooterRow({ children }: { children: ReactNode }) {
  const rowStyle = useMemo(() => [stylesheet.streamItemWrapper, stylesheet.turnFooterRow], []);
  return <View style={rowStyle}>{children}</View>;
}

const stylesheet = StyleSheet.create((theme) => ({
  streamItemWrapper: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
  turnFooterRow: {
    marginTop: theme.spacing[4],
    gap: theme.spacing[2],
  },
  turnFooterSlot: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    minHeight: 24,
    paddingBottom: TURN_FOOTER_BOTTOM_SPACING,
  },
  turnFooterContent: {
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: theme.spacing[3],
  },
  workingElapsed: {
    color: theme.colors.foregroundMuted,
    fontSize: STREAM_METADATA_FONT_SIZE,
    fontVariant: ["tabular-nums"],
  },
  workingLoader: {
    marginLeft: -2,
  },
}));
