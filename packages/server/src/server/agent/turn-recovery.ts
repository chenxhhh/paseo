import type { AgentTimelineItem } from "./agent-sdk-types.js";

/**
 * Turn auto-recovery policy.
 *
 * Some providers (e.g. codebuddy-code with kimi) end a turn abruptly when the
 * model API rate-limits or the stream dies mid-loop: the provider resolves the
 * prompt as a *normal* completion and the CLI writes the error only into its
 * local session file — paseo sees a turn that just stopped with no final
 * assistant message. The only robust signal on paseo's side is the *shape* of
 * the turn ending: a healthy turn closes with an assistant message, an
 * interrupted one typically ends on a tool call / reasoning item.
 *
 * The recovery loop mirrors the user's manual "继续" nudge: after a detected
 * abnormal ending, schedule a system-injected continuation prompt with
 * linear backoff so the agent survives transient 429/5xx/network failures
 * unattended.
 */

/** Maximum consecutive auto-continue attempts before we give up and flag the agent. */
export const MAX_AUTO_CONTINUE_ATTEMPTS = 10;

/** Base delay before the first retry; each retry adds the base (5s, 10s, 15s, ...). */
export const AUTO_CONTINUE_BASE_DELAY_MS = 5_000;

export type TurnRecoveryReason = "rate_limit" | "server_error" | "network_error" | "abnormal_end";

export interface TurnRecoveryDecision {
  retryable: boolean;
  reason?: TurnRecoveryReason;
  detail?: string;
}

export interface ClassifyTurnEndingInput {
  outcome: "completed" | "failed" | "canceled";
  /** Error text for `outcome === "failed"`. */
  error?: string;
  /** Last timeline item recorded for the agent when the turn settled. */
  lastTimelineItem: AgentTimelineItem | null;
  /** Whether the agent's timeline contains any tool activity at all. */
  hadToolActivity: boolean;
}

const RATE_LIMIT_PATTERN = /429|too many requests|rate\s*limit/i;
const SERVER_ERROR_PATTERN =
  /\b5\d\d\b|internal server error|bad gateway|service unavailable|temporarily unavailable/i;
const NETWORK_ERROR_PATTERN =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network error|fetch failed|getaddrinfo|broken pipe/i;
// Gateway/proxy returning HTTP 200 with an empty or malformed body — a common
// transient failure of the kimi/copilot gateway that is safe to retry.
const MALFORMED_RESPONSE_PATTERN =
  /empty or malformed response|malformed response|empty response|unexpected end of|premature close|invalid chunk|EOF when reading|api\s+(?:call\s+)?returned\s+(?:an\s+)?(?:empty|malformed)/i;

interface RetryableErrorMatch {
  reason: TurnRecoveryReason;
}

function matchRetryableErrorText(text: string): RetryableErrorMatch | null {
  if (RATE_LIMIT_PATTERN.test(text)) {
    return { reason: "rate_limit" };
  }
  if (SERVER_ERROR_PATTERN.test(text)) {
    return { reason: "server_error" };
  }
  if (MALFORMED_RESPONSE_PATTERN.test(text)) {
    return { reason: "network_error" };
  }
  if (NETWORK_ERROR_PATTERN.test(text)) {
    return { reason: "network_error" };
  }
  return null;
}

/**
 * Decide whether a just-finished foreground turn warrants an automatic
 * continuation prompt.
 *
 * Rules:
 * - canceled turns are never resumed (the user explicitly stopped).
 * - failed turns are retryable only for transient errors (429 / 5xx / network
 *   / empty-or-malformed gateway responses).
 * - completed turns are retryable when they ended without a closing assistant
 *   message: last item is a tool call, reasoning, or nothing at all. A healthy
 *   turn ends with the model's final message, so "no final message" is the
 *   abnormal-ending signature we observed from rate-limited kimi sessions.
 * - a completed turn whose final assistant message *is* a transient API error
 *   (some CLIs surface failures as the last message instead of failing the
 *   turn) is also retryable.
 */
export function classifyTurnEnding(input: ClassifyTurnEndingInput): TurnRecoveryDecision {
  const { outcome, error, lastTimelineItem, hadToolActivity } = input;

  if (outcome === "canceled") {
    return { retryable: false };
  }

  if (outcome === "failed") {
    const match = matchRetryableErrorText(error ?? "");
    if (match) {
      return { retryable: true, reason: match.reason, detail: error };
    }
    return { retryable: false };
  }

  // completed
  if (lastTimelineItem?.type === "assistant_message") {
    // Some CLIs surface transient API errors as the final assistant message
    // instead of failing the turn. Treat those as retryable too.
    const match = matchRetryableErrorText(lastTimelineItem.text);
    if (match) {
      return { retryable: true, reason: match.reason, detail: lastTimelineItem.text };
    }
    return { retryable: false };
  }
  if (lastTimelineItem?.type === "user_message" || lastTimelineItem?.type === "error") {
    return { retryable: false };
  }
  if (isIntentionalManualCompactionEnd(lastTimelineItem)) {
    return { retryable: false };
  }
  if (lastTimelineItem?.type === "tool_call") {
    if (
      lastTimelineItem.status === "running" ||
      lastTimelineItem.status === "failed" ||
      lastTimelineItem.status === "canceled"
    ) {
      return {
        retryable: true,
        reason: "abnormal_end",
        detail: `tool ${lastTimelineItem.name} did not complete`,
      };
    }
    // A completed tool call as the very last item: only suspicious when the
    // session is agentic (the model normally closes such turns with a message).
    if (hadToolActivity) {
      return {
        retryable: true,
        reason: "abnormal_end",
        detail: `turn ended right after tool ${lastTimelineItem.name}`,
      };
    }
    return { retryable: false };
  }
  // reasoning / todo / null / an unfinished (loading) or auto-triggered
  // compaction → the model never got to speak after its last action. Retry.
  return { retryable: true, reason: "abnormal_end" };
}

/**
 * A manual /compact that finished cleanly is an intentional user action, not
 * an abnormal ending — never auto-continue after it. A compaction left in
 * "loading" (or an auto-triggered one interrupted mid-flight) still falls
 * through to the abnormal-end retry.
 */
function isIntentionalManualCompactionEnd(lastTimelineItem: AgentTimelineItem | null): boolean {
  return (
    lastTimelineItem?.type === "compaction" &&
    lastTimelineItem.status === "completed" &&
    lastTimelineItem.trigger === "manual"
  );
}

/** Linear backoff: first retry waits 5s, each retry adds 5s (5s, 10s, 15s, ...). */
export function autoContinueDelayMs(attempt: number): number {
  return AUTO_CONTINUE_BASE_DELAY_MS * (attempt + 1);
}

const REASON_LABELS: Record<TurnRecoveryReason, string> = {
  rate_limit: "模型限流",
  server_error: "服务端错误",
  network_error: "网络中断",
  abnormal_end: "异常中断",
};

export function formatRecoveryReason(decision: TurnRecoveryDecision): string {
  if (!decision.reason) {
    return "异常中断";
  }
  return REASON_LABELS[decision.reason];
}
