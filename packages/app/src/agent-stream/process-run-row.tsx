import { memo, useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { STREAM_METADATA_FONT_SIZE } from "@/components/message";
import type { Theme } from "@/styles/theme";
import type { ProcessRunDigest } from "./process-run-collapse";
import { formatProcessRunLabel } from "./process-run-label";

const ThemedChevronDown = withUnistyles(ChevronDown);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export interface ProcessRunRowProps {
  digest: ProcessRunDigest;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
}

export const ProcessRunRow = memo(function ProcessRunRow({
  digest,
  expanded,
  onToggle,
}: ProcessRunRowProps) {
  const { t } = useTranslation();
  const label = useMemo(() => formatProcessRunLabel(digest, t), [digest, t]);
  const toggleHint = t(expanded ? "message.turnResult.collapse" : "message.turnResult.expand");
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const handlePress = useCallback(() => {
    onToggle(!expanded);
  }, [expanded, onToggle]);

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={8}
      testID="process-run-row"
      accessibilityRole="button"
      accessibilityLabel={label ? `${label}, ${toggleHint}` : toggleHint}
      accessibilityState={accessibilityState}
    >
      <View style={styles.row}>
        {label ? (
          <Text style={styles.label} numberOfLines={1} ellipsizeMode="tail">
            {label}
          </Text>
        ) : null}
        <ThemedChevronDown
          size={14}
          uniProps={foregroundMutedColorMapping}
          style={expanded ? styles.chevronExpanded : undefined}
        />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginTop: theme.spacing[2],
    minHeight: 24,
  },
  label: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: STREAM_METADATA_FONT_SIZE,
    fontVariant: ["tabular-nums"],
  },
  chevronExpanded: {
    transform: [{ rotate: "180deg" }],
  },
}));
