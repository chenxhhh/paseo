import type { ToolCallItem } from "@/types/stream";
import {
  createRun,
  describeToolCall,
  type ToolCallDescriptor,
  type ToolCallHostPlacement,
  type ToolCallRun,
} from "../grouping";
import { classifyToolCallCategory } from "../classify";

export interface BalancedSummary {
  readFileCount: number;
  searchCount: number;
  fetchCount: number;
  otherToolCount: number;
  paseoCallCount: number;
}

export interface BalancedToolCallGroup {
  mode: "balanced";
  run: ToolCallRun;
  summary: BalancedSummary;
  isLoading: boolean;
}

/** True when a call should surface as its own row rather than fold into a noise badge. */
export function isBalancedSignalCall(descriptor: ToolCallDescriptor): boolean {
  const category = classifyToolCallCategory(descriptor);
  if (category === "edit" || category === "shell") {
    return true;
  }
  // Thinking emitted as a tool_call named "thinking" with unknown detail stays a
  // signal row, mirroring buildUnknownDetailOverride.
  return (
    descriptor.name.trim().toLowerCase() === "thinking" && descriptor.detail.type === "unknown"
  );
}

export function buildBalancedHosts(
  run: ToolCallRun,
): readonly ToolCallHostPlacement<BalancedToolCallGroup>[] {
  const placements: ToolCallHostPlacement<BalancedToolCallGroup>[] = [];
  let noise: ToolCallItem[] = [];
  let noiseLastIndex = -1;

  const flushNoise = () => {
    if (noise.length === 0) {
      return;
    }
    const segmentRun = createRun(noise, run.isSealed);
    const host =
      segmentRun.calls.length === 1
        ? segmentRun.latest
        : { ...segmentRun.latest, id: segmentRun.id };
    placements.push({
      host,
      lastIndex: noiseLastIndex,
      group: buildBalancedGroup(segmentRun),
    });
    noise = [];
  };

  for (let i = 0; i < run.calls.length; i += 1) {
    const call = run.calls[i];
    if (isBalancedSignalCall(describeToolCall(call))) {
      flushNoise();
      placements.push({ host: call, lastIndex: i });
    } else {
      noise.push(call);
      noiseLastIndex = i;
    }
  }
  flushNoise();
  return placements;
}

function buildBalancedGroup(run: ToolCallRun): BalancedToolCallGroup {
  const readFiles = new Set<string>();
  let searchCount = 0;
  let fetchCount = 0;
  let otherToolCount = 0;
  let paseoCallCount = 0;
  let isLoading = false;

  for (const call of run.calls) {
    const descriptor = describeToolCall(call);
    isLoading ||= descriptor.status === "running" || descriptor.status === "executing";
    const category = classifyToolCallCategory(descriptor);
    if (category === "paseo") {
      paseoCallCount += 1;
    } else if (category === "read") {
      if (descriptor.detail.type === "read") {
        readFiles.add(descriptor.detail.filePath);
      }
    } else if (category === "search") {
      searchCount += 1;
    } else if (category === "fetch") {
      fetchCount += 1;
    } else {
      otherToolCount += 1;
    }
  }

  return {
    mode: "balanced",
    run,
    summary: {
      readFileCount: readFiles.size,
      searchCount,
      fetchCount,
      otherToolCount,
      paseoCallCount,
    },
    isLoading,
  };
}
