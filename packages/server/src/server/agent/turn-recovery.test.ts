import { describe, expect, test } from "vitest";

import type { AgentTimelineItem } from "./agent-sdk-types.js";
import {
  MAX_AUTO_CONTINUE_ATTEMPTS,
  autoContinueDelayMs,
  classifyTurnEnding,
  formatRecoveryReason,
} from "./turn-recovery.js";

function toolItem(
  overrides: Partial<Extract<AgentTimelineItem, { type: "tool_call" }>> = {},
): Extract<AgentTimelineItem, { type: "tool_call" }> {
  return {
    type: "tool_call",
    callId: "call-1",
    name: "Bash",
    detail: { type: "shell", command: "ls" },
    status: "completed",
    error: null,
    ...overrides,
  };
}

function assistantItem(text = "done"): Extract<AgentTimelineItem, { type: "assistant_message" }> {
  return { type: "assistant_message", text, messageId: "m1" };
}

describe("classifyTurnEnding", () => {
  test("completed turn ending with an assistant message is not retryable", () => {
    expect(
      classifyTurnEnding({
        outcome: "completed",
        lastTimelineItem: assistantItem(),
        hadToolActivity: true,
      }).retryable,
    ).toBe(false);
  });

  test("completed turn ending right after a tool call (rate-limited abort) is retryable", () => {
    const decision = classifyTurnEnding({
      outcome: "completed",
      lastTimelineItem: toolItem(),
      hadToolActivity: true,
    });
    expect(decision.retryable).toBe(true);
    expect(decision.reason).toBe("abnormal_end");
  });

  test("completed turn ending on reasoning (died mid-think) is retryable", () => {
    const decision = classifyTurnEnding({
      outcome: "completed",
      lastTimelineItem: { type: "reasoning", text: "..." },
      hadToolActivity: true,
    });
    expect(decision.retryable).toBe(true);
  });

  test("completed turn with no items is retryable", () => {
    expect(
      classifyTurnEnding({ outcome: "completed", lastTimelineItem: null, hadToolActivity: false })
        .retryable,
    ).toBe(true);
  });

  test("completed turn whose last assistant message is the rate-limit error is retryable", () => {
    const decision = classifyTurnEnding({
      outcome: "completed",
      lastTimelineItem: assistantItem("429 too many requests"),
      hadToolActivity: true,
    });
    expect(decision.retryable).toBe(true);
    expect(decision.reason).toBe("rate_limit");
  });

  test("tool call with running/failed status is retryable regardless of tool activity", () => {
    for (const status of ["running", "failed", "canceled"] as const) {
      const decision = classifyTurnEnding({
        outcome: "completed",
        lastTimelineItem: toolItem({ status }),
        hadToolActivity: false,
      });
      expect(decision.retryable).toBe(true);
    }
  });

  test("canceled turns are never retried", () => {
    expect(
      classifyTurnEnding({
        outcome: "canceled",
        lastTimelineItem: toolItem(),
        hadToolActivity: true,
      }).retryable,
    ).toBe(false);
  });

  test("failed turn with 429 is retryable", () => {
    const decision = classifyTurnEnding({
      outcome: "failed",
      error: "429 too many requests (abc/def)",
      lastTimelineItem: null,
      hadToolActivity: false,
    });
    expect(decision.retryable).toBe(true);
    expect(decision.reason).toBe("rate_limit");
  });

  test("failed turn with 5xx or network error is retryable", () => {
    for (const error of ["Request failed with status code 502", "ECONNRESET", "socket hang up"]) {
      expect(
        classifyTurnEnding({
          outcome: "failed",
          error,
          lastTimelineItem: null,
          hadToolActivity: false,
        }).retryable,
      ).toBe(true);
    }
  });

  test("failed turn with an empty or malformed gateway response is retryable", () => {
    const decision = classifyTurnEnding({
      outcome: "failed",
      error:
        "API Error: API returned an empty or malformed response (HTTP 200) — check for a proxy or gateway intercepting the request",
      lastTimelineItem: null,
      hadToolActivity: false,
    });
    expect(decision.retryable).toBe(true);
    expect(decision.reason).toBe("network_error");
  });

  test("completed turn whose final message is a malformed gateway response is retryable", () => {
    const decision = classifyTurnEnding({
      outcome: "completed",
      lastTimelineItem: assistantItem(
        "API Error: API returned an empty or malformed response (HTTP 200) — check for a proxy or gateway intercepting the request",
      ),
      hadToolActivity: true,
    });
    expect(decision.retryable).toBe(true);
    expect(decision.reason).toBe("network_error");
  });

  test("completed turn ending right after a tool call during a malformed gateway response is retryable", () => {
    const decision = classifyTurnEnding({
      outcome: "completed",
      lastTimelineItem: toolItem(),
      hadToolActivity: true,
    });
    expect(decision.retryable).toBe(true);
  });

  test("failed turn with a non-transient error is not retryable", () => {
    expect(
      classifyTurnEnding({
        outcome: "failed",
        error: "invalid model id",
        lastTimelineItem: null,
        hadToolActivity: false,
      }).retryable,
    ).toBe(false);
  });

  test("completed turn ending on a finished manual /compact is not retryable", () => {
    const decision = classifyTurnEnding({
      outcome: "completed",
      lastTimelineItem: { type: "compaction", status: "completed", trigger: "manual" },
      hadToolActivity: true,
    });
    expect(decision.retryable).toBe(false);
  });

  test("completed turn ending on a finished auto-triggered compaction is retryable", () => {
    const decision = classifyTurnEnding({
      outcome: "completed",
      lastTimelineItem: { type: "compaction", status: "completed", trigger: "auto" },
      hadToolActivity: true,
    });
    expect(decision.retryable).toBe(true);
    expect(decision.reason).toBe("abnormal_end");
  });

  test("completed turn ending on a compaction still loading is retryable regardless of trigger", () => {
    const decision = classifyTurnEnding({
      outcome: "completed",
      lastTimelineItem: { type: "compaction", status: "loading", trigger: "manual" },
      hadToolActivity: true,
    });
    expect(decision.retryable).toBe(true);
    expect(decision.reason).toBe("abnormal_end");
  });
});

describe("autoContinueDelayMs", () => {
  test("delays grow linearly from a 5s base, adding 5s per retry", () => {
    expect(autoContinueDelayMs(0)).toBe(5_000);
    expect(autoContinueDelayMs(1)).toBe(10_000);
    expect(autoContinueDelayMs(2)).toBe(15_000);
    expect(autoContinueDelayMs(9)).toBe(50_000);
  });
});

describe("formatRecoveryReason", () => {
  test("maps reasons to labels", () => {
    expect(formatRecoveryReason({ retryable: true, reason: "rate_limit" })).toBe("模型限流");
    expect(formatRecoveryReason({ retryable: true, reason: "abnormal_end" })).toBe("异常中断");
  });

  test("defaults for missing reason", () => {
    expect(formatRecoveryReason({ retryable: true })).toBe("异常中断");
  });

  test("MAX_AUTO_CONTINUE_ATTEMPTS is exported for consumers", () => {
    expect(MAX_AUTO_CONTINUE_ATTEMPTS).toBe(10);
  });
});
