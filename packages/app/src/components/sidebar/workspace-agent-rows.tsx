import { memo, useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { StatusRing } from "@/components/status-ring";
import { formatCompactTimeAgo } from "@/utils/time";
import type { WorkspaceAgentRowSummary } from "@/utils/workspace-agent-rows";

/**
 * The inline agent activity under a workspace row — the piece the sidebar's single status
 * dot cannot say: which agents are doing something, and what they last touched.
 *
 * The rows sit under the workspace's own content, indented to the title's rail, at a smaller
 * text size so the workspace above stays the subject.
 */
export const WorkspaceAgentRows = memo(function WorkspaceAgentRows({
  agents,
  onAgentPress,
}: {
  agents: readonly WorkspaceAgentRowSummary[];
  /** Activating a row goes where the workspace's agent list lives. */
  onAgentPress?: (agent: WorkspaceAgentRowSummary) => void;
}) {
  if (agents.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} testID="sidebar-workspace-agent-rows">
      {agents.map((agent) => (
        <AgentActivityRow key={agent.agentId} agent={agent} onPress={onAgentPress} />
      ))}
    </View>
  );
});

function AgentActivityRow({
  agent,
  onPress,
}: {
  agent: WorkspaceAgentRowSummary;
  onPress?: (agent: WorkspaceAgentRowSummary) => void;
}) {
  const label = agent.title ?? "Agent";
  const time = formatCompactTimeAgo(agent.activityAt);
  // Declared before any conditional return so the hook order never varies.
  const handlePress = useCallback(() => {
    onPress?.(agent);
  }, [agent, onPress]);

  const body = (
    <View style={styles.row}>
      <View style={styles.dotSlot}>
        {agent.bucket === "running" ? (
          <StatusRing />
        ) : (
          <View style={[styles.dot, activityDotStyle(agent.bucket)]} />
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.time}>{time}</Text>
    </View>
  );

  if (!onPress) {
    return body;
  }

  return (
    <Pressable
      onPress={handlePress}
      testID={`sidebar-workspace-agent-row-${agent.agentId}`}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {body}
    </Pressable>
  );
}

// Per-bucket dot colors, prebuilt — `useUnistyles` is a restricted import, so the
// theme read happens once here rather than in every row.
const themedDots = StyleSheet.create((theme) => ({
  needsInput: { backgroundColor: theme.colors.statusDotWarning },
  failed: { backgroundColor: theme.colors.statusDotDanger },
  attention: { backgroundColor: theme.colors.statusDotSuccess },
}));

function activityDotStyle(bucket: WorkspaceAgentRowSummary["bucket"]) {
  switch (bucket) {
    case "needs_input":
      return themedDots.needsInput;
    case "failed":
      return themedDots.failed;
    case "attention":
      return themedDots.attention;
    default:
      return null;
  }
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: 1,
    // The workspace row's content starts after its leading status slot; aligning the agent
    // rows to that rail keeps them reading as belongings of the row above, not peers of it.
    paddingLeft: 28,
    paddingRight: theme.spacing[2],
    paddingTop: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minHeight: 20,
  },
  dotSlot: {
    width: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
    minWidth: 0,
  },
  time: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    opacity: 0.7,
    flexShrink: 0,
  },
}));
