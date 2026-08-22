import { memo, useCallback, useRef, type ReactNode } from "react";
import { ScrollView } from "react-native";
import { Wrench } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { ExpandableBadge } from "@/components/message";

interface ToolCallGroupBadgeProps {
  testID: string;
  label: string;
  isLoading: boolean;
  isExpanded: boolean;
  isLastInSequence: boolean;
  onExpandedChange: (groupId: string, expanded: boolean) => void;
  groupId: string;
  children: ReactNode;
}

export const TOOL_CALL_GROUP_MAX_HEIGHT = 400;

export const ToolCallGroupBadge = memo(function ToolCallGroupBadge({
  testID,
  label,
  isLoading,
  isExpanded,
  isLastInSequence,
  onExpandedChange,
  groupId,
  children,
}: ToolCallGroupBadgeProps) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollToLatest = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);
  const toggle = useCallback(() => {
    onExpandedChange(groupId, !isExpanded);
  }, [groupId, isExpanded, onExpandedChange]);
  const renderDetails = useCallback(
    () => (
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        onContentSizeChange={scrollToLatest}
      >
        {children}
      </ScrollView>
    ),
    [children, scrollToLatest],
  );

  return (
    <ExpandableBadge
      testID={testID}
      label={label}
      icon={Wrench}
      isLoading={isLoading}
      isExpanded={isExpanded}
      isLastInSequence={isLastInSequence}
      onToggle={toggle}
      renderDetails={renderDetails}
      borderlessWhenExpanded
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  scroll: {
    maxHeight: TOOL_CALL_GROUP_MAX_HEIGHT,
  },
  content: {
    paddingTop: theme.spacing[1],
    paddingHorizontal: 13,
  },
}));
