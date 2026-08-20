import type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";

export const TOOL_CALL_DETAIL_LEVEL_ORDER: readonly ToolCallDetailLevel[] = [
  "detailed",
  "balanced",
  "overview",
];

export function getNextToolCallDetailLevel(level: ToolCallDetailLevel): ToolCallDetailLevel {
  const index = TOOL_CALL_DETAIL_LEVEL_ORDER.indexOf(level);
  if (index === -1) {
    return TOOL_CALL_DETAIL_LEVEL_ORDER[0];
  }
  return TOOL_CALL_DETAIL_LEVEL_ORDER[(index + 1) % TOOL_CALL_DETAIL_LEVEL_ORDER.length];
}
