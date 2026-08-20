import { memo, type ReactNode } from "react";
import { type BalancedSummary, type BalancedToolCallGroup } from "./model";
import { ToolCallGroupBadge } from "../tool-call-group-badge";
import { useToolCallSummarySentence } from "../summary-text";

interface BalancedGroupProps {
  group: BalancedToolCallGroup;
  expanded: boolean;
  isLastInSequence: boolean;
  onExpandedChange: (groupId: string, expanded: boolean) => void;
  children: ReactNode;
}

function useBalancedSummary(summary: BalancedSummary): string {
  return useToolCallSummarySentence([
    { count: summary.readFileCount, keyRoot: "toolCallGroup.readFiles" },
    { count: summary.searchCount, keyRoot: "toolCallGroup.searches" },
    { count: summary.fetchCount, keyRoot: "toolCallGroup.fetches" },
    { count: summary.otherToolCount, keyRoot: "toolCallGroup.otherTools" },
    { count: summary.paseoCallCount, keyRoot: "toolCallGroup.paseoCalls" },
  ]);
}

export const BalancedToolCallGroupView = memo(function BalancedToolCallGroupView({
  group,
  expanded,
  isLastInSequence,
  onExpandedChange,
  children,
}: BalancedGroupProps) {
  const aggregateSummary = useBalancedSummary(group.summary);

  return (
    <ToolCallGroupBadge
      testID="balanced-tool-call-group"
      label={aggregateSummary}
      isLoading={group.isLoading}
      isExpanded={expanded}
      isLastInSequence={isLastInSequence}
      onExpandedChange={onExpandedChange}
      groupId={group.run.id}
    >
      {children}
    </ToolCallGroupBadge>
  );
});
