import { describe, expect, test } from "vitest";

import type { AgentTimelineItem } from "./agent-sdk-types.js";
import {
  AUTO_CONTINUE_PROMPT,
  MAX_AUTO_CONTINUE_ATTEMPTS,
  RECOVERY_NOTICE_PREFIX,
  autoContinueDelayMs,
  classifyTurnEnding,
  formatRecoveryExhaustedNotice,
  formatRecoveryReason,
  formatRecoveryScheduledNotice,
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

  test("completed turn ending on a finished auto-triggered compaction is not retryable", () => {
    const decision = classifyTurnEnding({
      outcome: "completed",
      lastTimelineItem: { type: "compaction", status: "completed", trigger: "auto" },
      hadToolActivity: true,
    });
    expect(decision.retryable).toBe(false);
  });

  test("completed turn ending on a finished compaction with no recorded trigger is not retryable", () => {
    // OMP/Pi only tag trigger on the completed marker and omit it elsewhere, so
    // a missing trigger must not fall through to the abnormal-end retry.
    const decision = classifyTurnEnding({
      outcome: "completed",
      lastTimelineItem: { type: "compaction", status: "completed" },
      hadToolActivity: true,
    });
    expect(decision.retryable).toBe(false);
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
    expect(formatRecoveryReason({ retryable: true, reason: "rate_limit" })).toBe("rate limited");
    expect(formatRecoveryReason({ retryable: true, reason: "abnormal_end" })).toBe("abnormal end");
  });

  test("defaults for missing reason", () => {
    expect(formatRecoveryReason({ retryable: true })).toBe("abnormal end");
  });

  test("formats scheduled and exhausted notices", () => {
    const decision = { retryable: true, reason: "abnormal_end" as const };
    expect(formatRecoveryScheduledNotice(decision, 5_000, 1)).toBe(
      "[Auto-continue] abnormal end, retrying in 5s (1/10)",
    );
    expect(formatRecoveryExhaustedNotice(decision)).toBe(
      "[Auto-continue] gave up after 10 attempts (abnormal end); check the agent",
    );
    expect(AUTO_CONTINUE_PROMPT.length).toBeGreaterThan(0);
    expect(RECOVERY_NOTICE_PREFIX).toBe("[Auto-continue]");
  });

  test("MAX_AUTO_CONTINUE_ATTEMPTS is exported for consumers", () => {
    expect(MAX_AUTO_CONTINUE_ATTEMPTS).toBe(10);
  });
});
