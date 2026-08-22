import { isPaseoToolName } from "@getpaseo/protocol/tool-name-normalization";
import { type ToolCallDescriptor } from "./grouping";

export const DIRECT_PASEO_TOOL_PREFIX = "paseo_";
export const DIRECT_SEARCH_TOOL_SUFFIX_PATTERN = /(?:^|[_.:/])(?:web_search|llm_context)$/;

export type ToolCallSummaryCategory =
  | "paseo"
  | "edit"
  | "shell"
  | "read"
  | "search"
  | "fetch"
  | "other";

function isPaseoCall(name: string, normalizedName: string): boolean {
  return isPaseoToolName(name) || normalizedName.startsWith(DIRECT_PASEO_TOOL_PREFIX);
}

function isSearchCall(name: string): boolean {
  return DIRECT_SEARCH_TOOL_SUFFIX_PATTERN.test(name);
}

export function classifyToolCallCategory(descriptor: ToolCallDescriptor): ToolCallSummaryCategory {
  const normalizedName = descriptor.name.trim().toLowerCase();
  if (isPaseoCall(descriptor.name, normalizedName)) {
    return "paseo";
  }
  if (descriptor.detail.type === "edit" || descriptor.detail.type === "write") {
    return "edit";
  }
  if (descriptor.detail.type === "shell") {
    return "shell";
  }
  if (descriptor.detail.type === "read") {
    return "read";
  }
  if (descriptor.detail.type === "search" || isSearchCall(normalizedName)) {
    return "search";
  }
  if (descriptor.detail.type === "fetch") {
    return "fetch";
  }
  return "other";
}
