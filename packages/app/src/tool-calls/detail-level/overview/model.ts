import { describeToolCall, type ToolCallRun } from "../grouping";
import { classifyToolCallCategory, type ToolCallSummaryCategory } from "../classify";

export interface OverviewSummary {
  editedFileCount: number;
  commandCount: number;
  readFileCount: number;
  searchCount: number;
  otherToolCount: number;
  paseoCallCount: number;
}

export interface OverviewToolCallGroup {
  mode: "overview";
  run: ToolCallRun;
  summary: OverviewSummary;
  isLoading: boolean;
}

export function buildOverviewGroup(run: ToolCallRun): OverviewToolCallGroup {
  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  let isLoading = false;
  let commandCount = 0;
  let searchCount = 0;
  let otherToolCount = 0;
  let paseoCallCount = 0;

  for (const call of run.calls) {
    const descriptor = describeToolCall(call);
    isLoading ||= descriptor.status === "running" || descriptor.status === "executing";
    const category: ToolCallSummaryCategory = classifyToolCallCategory(descriptor);
    if (category === "paseo") {
      paseoCallCount += 1;
    } else if (category === "edit") {
      if (descriptor.detail.type === "edit" || descriptor.detail.type === "write") {
        editedFiles.add(descriptor.detail.filePath);
      }
    } else if (category === "shell") {
      commandCount += 1;
    } else if (category === "read") {
      if (descriptor.detail.type === "read") {
        readFiles.add(descriptor.detail.filePath);
      }
    } else if (category === "search") {
      searchCount += 1;
    } else {
      // fetch folds into other tools to keep the overview sentence unchanged.
      otherToolCount += 1;
    }
  }

  const summary = {
    editedFileCount: editedFiles.size,
    commandCount,
    readFileCount: readFiles.size,
    searchCount,
    otherToolCount,
    paseoCallCount,
  };
  return {
    mode: "overview",
    run,
    isLoading,
    summary,
  };
}
