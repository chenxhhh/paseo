import { memo, useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { FileText } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentCapabilityFlags } from "@getpaseo/protocol/agent-types";
import { AttachmentFrame, AttachmentLabel } from "@/components/attachment-pill";
import { DiffStat } from "@/components/diff-stat";
import { STREAM_METADATA_FONT_SIZE } from "@/components/message";
import { RewindMenu } from "@/components/rewind/rewind-menu";
import { useRewindAgentMutation } from "@/components/rewind/use-rewind-agent-mutation";
import { resolveRewindMenuItems } from "@/components/rewind/use-rewind-capabilities";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { TurnArtifact, TurnArtifactsSummary } from "./turn-artifacts";

const ThemedFileText = withUnistyles(FileText);
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const artifactFileIcon = (
  <ThemedFileText size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />
);

/** Context the turn footer needs to open artifacts and rewind the turn. */
export interface TurnArtifactsMeta {
  serverId?: string;
  agentId?: string;
  client?: DaemonClient | null;
  capabilities?: AgentCapabilityFlags | null;
  onOpenFile: (filePath: string) => void;
}

function TurnRewindAction({
  meta,
  rewindTarget,
}: {
  meta: TurnArtifactsMeta;
  rewindTarget: NonNullable<TurnArtifactsSummary["rewindTarget"]>;
}) {
  const rewindMutation = useRewindAgentMutation({
    serverId: meta.serverId,
    agentId: meta.agentId,
    client: meta.client,
    messageId: rewindTarget.messageId,
  });
  const handleRewind = useCallback(
    (input: {
      mode: Parameters<typeof rewindMutation.rewindAgent>[0]["mode"];
      rewoundText: string;
    }) => {
      return rewindMutation.rewindAgent(input);
    },
    [rewindMutation],
  );
  if (!meta.capabilities) {
    return null;
  }
  return (
    <RewindMenu
      capabilities={meta.capabilities}
      rewoundText={rewindTarget.promptText}
      onRewind={handleRewind}
      isPending={rewindMutation.isPending}
    />
  );
}

const TurnArtifactChip = memo(function TurnArtifactChip({
  artifact,
  onOpenFile,
  accessibilityLabel,
}: {
  artifact: TurnArtifact;
  onOpenFile?: (filePath: string) => void;
  accessibilityLabel: string;
}) {
  const handlePress = useCallback(() => {
    onOpenFile?.(artifact.filePath);
  }, [onOpenFile, artifact.filePath]);
  return (
    <AttachmentFrame
      onPress={handlePress}
      accessibilityLabel={accessibilityLabel}
      testID="turn-artifact-chip"
    >
      <AttachmentLabel
        icon={artifactFileIcon}
        title={artifact.fileName}
        subtitle={artifact.typeLabel}
      />
    </AttachmentFrame>
  );
});

/**
 * Artifacts a completed turn produced: file chips for deliverables, the
 * write/edit change summary, and the rewind entry that reverts the turn.
 * Rendered above the standard assistant turn footer actions.
 */
export const TurnArtifactsSection = memo(function TurnArtifactsSection({
  summary,
  meta,
}: {
  summary: TurnArtifactsSummary;
  meta?: TurnArtifactsMeta;
}) {
  const { t } = useTranslation();
  const hasArtifacts = summary.artifacts.length > 0;
  const hasStats = (summary.stats?.fileCount ?? 0) > 0;
  const canRewind =
    hasStats &&
    Boolean(meta?.capabilities && summary.rewindTarget) &&
    resolveRewindMenuItems(meta?.capabilities).length > 0;

  if (!hasArtifacts && !hasStats) {
    return null;
  }

  const onOpenFile = meta?.onOpenFile;

  return (
    <View style={stylesheet.container} testID="turn-artifacts">
      {hasArtifacts ? (
        <View style={stylesheet.chips}>
          {summary.artifacts.map((artifact) => (
            <TurnArtifactChip
              key={artifact.filePath}
              artifact={artifact}
              onOpenFile={onOpenFile}
              accessibilityLabel={t("message.turn.openArtifact", { name: artifact.fileName })}
            />
          ))}
        </View>
      ) : null}
      {hasStats ? (
        <View style={stylesheet.statsRow}>
          {summary.stats ? (
            <DiffStat
              additions={summary.stats.additions}
              deletions={summary.stats.deletions}
              testID="turn-artifact-stats"
            />
          ) : null}
          <Text style={stylesheet.statsText} testID="turn-artifact-stats-label">
            {t("message.turn.filesChanged", { count: summary.stats?.fileCount ?? 0 })}
          </Text>
          {canRewind && meta && summary.rewindTarget ? (
            <TurnRewindAction meta={meta} rewindTarget={summary.rewindTarget} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const stylesheet = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    alignSelf: "stretch",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 24,
  },
  statsText: {
    fontSize: STREAM_METADATA_FONT_SIZE,
    color: theme.colors.foregroundMuted,
  },
}));
