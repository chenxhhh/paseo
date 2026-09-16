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
 * The recovery loop mirrors a manual "continue" nudge: after a detected
 * abnormal ending, schedule a system-injected continuation prompt with
 * linear backoff so the agent survives transient 429/5xx/network failures
 * unattended.
 */

/** Maximum consecutive auto-continue attempts before we give up and flag the agent. */
export const MAX_AUTO_CONTINUE_ATTEMPTS = 10;

/** Base delay before the first retry; each retry adds the base (5s, 10s, 15s, ...). */
export const AUTO_CONTINUE_BASE_DELAY_MS = 5_000;

/** Prefix the manager stamps on system-injected error timeline messages. */
export const SYSTEM_ERROR_PREFIX = "[System Error]";

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

const RATE_LIMIT_PHRASE_PATTERN = /too many requests|rate\s*limit/i;
const SERVER_ERROR_PHRASE_PATTERN =
  /internal server error|bad gateway|service unavailable|temporarily unavailable/i;
const NETWORK_ERROR_PATTERN =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network error|fetch failed|getaddrinfo|broken pipe/i;
// Gateway/proxy returning HTTP 200 with an empty or malformed body — a common
// transient failure of the kimi/copilot gateway that is safe to retry.
const MALFORMED_RESPONSE_PATTERN =
  /empty or malformed response|malformed response|empty response|unexpected end of|premature close|invalid chunk|EOF when reading|api\s+(?:call\s+)?returned\s+(?:an\s+)?(?:empty|malformed)/i;

/**
 * Heuristic ceiling for "the closing assistant message is itself a provider
 * error": CLIs that surface API failures as the final message emit a short
 * notice (one or two lines), never prose.
 */
const ASSISTANT_ERROR_NOTICE_MAX_CHARS = 300;

// A status number only counts inside an assistant message when it is
// syntactically attached to an error ("error 503", "status: 502", "503
// Service Unavailable"). Free-standing numbers are ordinary report content —
// ports, dimensions, line numbers, sample counts ("880×560",
// "index.html:519", "512 条样本") — and matching them re-prompted agents
// that had already delivered a complete answer into redoing the whole task.
const CONTEXTUAL_STATUS_NUMBER_PATTERN =
  /(?:\b(?:error|status|code|http|exit|api)\s*[:=#]?\s*)(?:429|5\d\d)\b|\b(?:429|5\d\d)\b\s+(?:error|internal|server|bad|gateway|service|unavailable|timeout|too many)/i;

interface RetryableErrorMatch {
  reason: TurnRecoveryReason;
}

/** Unambiguous multi-word failure wording, safe to match anywhere. */
function matchRetryablePhraseText(text: string): RetryableErrorMatch | null {
  if (RATE_LIMIT_PHRASE_PATTERN.test(text)) {
    return { reason: "rate_limit" };
  }
  if (SERVER_ERROR_PHRASE_PATTERN.test(text)) {
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

/** Full matcher for real provider error strings: phrases plus bare 429/5xx. */
function matchRetryableErrorText(text: string): RetryableErrorMatch | null {
  const phraseMatch = matchRetryablePhraseText(text);
  if (phraseMatch) {
    return phraseMatch;
  }
  if (/\b429\b/.test(text)) {
    return { reason: "rate_limit" };
  }
  if (/\b5\d\d\b/.test(text)) {
    return { reason: "server_error" };
  }
  return null;
}

/**
 * Strict variant for classifying the closing *assistant message* of a turn,
 * which unlike `matchRetryableErrorText` is ordinary model output and mostly
 * healthy: an error notice must be short, and a 429/5xx number only counts
 * next to an error word so numbers in a real report never re-arm the
 * recovery loop.
 */
function matchAssistantErrorMessageText(text: string): RetryableErrorMatch | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > ASSISTANT_ERROR_NOTICE_MAX_CHARS) {
    return null;
  }
  const phraseMatch = matchRetryablePhraseText(trimmed);
  if (phraseMatch) {
    return phraseMatch;
  }
  if (CONTEXTUAL_STATUS_NUMBER_PATTERN.test(trimmed)) {
    return /\b429\b/.test(trimmed) ? { reason: "rate_limit" } : { reason: "server_error" };
  }
  return null;
}

/** True for the "[System Error] …" envelope the manager records on failures. */
function isSystemErrorEnvelope(text: string): boolean {
  return text.startsWith(SYSTEM_ERROR_PREFIX);
}

/**
 * True when the turn already closed with a real assistant answer: the
 * timeline the user sees ends with that message, not with the failure, and
 * re-prompting the agent to "continue" makes it redo delivered work. The
 * system-error envelope the failure itself appends, and a short error notice
 * surfaced as the closing message, keep the retry path.
 */
function endedWithDeliveredAnswer(lastTimelineItem: AgentTimelineItem | null): boolean {
  if (lastTimelineItem?.type !== "assistant_message") {
    return false;
  }
  return (
    !isSystemErrorEnvelope(lastTimelineItem.text) &&
    !matchAssistantErrorMessageText(lastTimelineItem.text)
  );
}

/**
 * Decide whether a just-finished foreground turn warrants an automatic
 * continuation prompt.
 *
 * Rules:
 * - canceled turns are never resumed (the user explicitly stopped).
 * - failed turns are retryable only for transient errors (429 / 5xx / network
 *   / empty-or-malformed gateway responses), and only when the turn did not
 *   already close with a real assistant message: the answer was delivered, and
 *   re-prompting the agent to "continue" makes it redo finished work.
 * - completed turns are retryable when they ended without a closing assistant
 *   message: last item is a tool call, reasoning, or nothing at all. A healthy
 *   turn ends with the model's final message, so "no final message" is the
 *   abnormal-ending signature we observed from rate-limited kimi sessions.
 * - a closing assistant message counts as an error only when it *is* one: a
 *   short notice whose wording matches a transient failure (some CLIs surface
 *   failures as the last message instead of failing the turn). Numbers that
 *   merely look like status codes inside a real report do not.
 */
export function classifyTurnEnding(input: ClassifyTurnEndingInput): TurnRecoveryDecision {
  const { outcome, error, lastTimelineItem, hadToolActivity } = input;

  if (outcome === "canceled") {
    return { retryable: false };
  }

  if (outcome === "failed") {
    if (endedWithDeliveredAnswer(lastTimelineItem)) {
      return { retryable: false };
    }
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
    const match = matchAssistantErrorMessageText(lastTimelineItem.text);
    if (match) {
      return { retryable: true, reason: match.reason, detail: lastTimelineItem.text };
    }
    return { retryable: false };
  }
  if (lastTimelineItem?.type === "user_message" || lastTimelineItem?.type === "error") {
    return { retryable: false };
  }
  if (isCompletedCompactionEnd(lastTimelineItem)) {
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
  // reasoning / todo / null / an unfinished (loading) compaction → the model
  // never got to speak after its last action. Retry.
  return { retryable: true, reason: "abnormal_end" };
}

/**
 * A compaction that finished cleanly is an intentional turn ending, not an
 * abnormal one — never auto-continue after it. This holds regardless of the
 * recorded trigger: OMP/Pi only tag `trigger` on the completed marker (their
 * loading marker omits it), so keying on `trigger === "manual"` misses cases
 * where the trigger was not preserved. Only a compaction still "loading"
 * (interrupted mid-flight) falls through to the abnormal-end retry.
 */
function isCompletedCompactionEnd(lastTimelineItem: AgentTimelineItem | null): boolean {
  return lastTimelineItem?.type === "compaction" && lastTimelineItem.status === "completed";
}

/** Linear backoff: first retry waits 5s, each retry adds 5s (5s, 10s, 15s, ...). */
export function autoContinueDelayMs(attempt: number): number {
  return AUTO_CONTINUE_BASE_DELAY_MS * (attempt + 1);
}

const REASON_LABELS: Record<TurnRecoveryReason, string> = {
  rate_limit: "rate limited",
  server_error: "server error",
  network_error: "network error",
  abnormal_end: "abnormal end",
};

export const RECOVERY_NOTICE_PREFIX = "[Auto-continue]";

export const AUTO_CONTINUE_PROMPT =
  "The previous turn ended abnormally. Continue the task without asking the user.";

export function formatRecoveryReason(decision: TurnRecoveryDecision): string {
  return decision.reason ? REASON_LABELS[decision.reason] : REASON_LABELS.abnormal_end;
}

export function formatRecoveryScheduledNotice(
  decision: TurnRecoveryDecision,
  delayMs: number,
  consecutive: number,
): string {
  const seconds = Math.round(delayMs / 1000);
  return `${RECOVERY_NOTICE_PREFIX} ${formatRecoveryReason(decision)}, retrying in ${seconds}s (${consecutive}/${MAX_AUTO_CONTINUE_ATTEMPTS})`;
}

export function formatRecoveryExhaustedNotice(decision: TurnRecoveryDecision): string {
  return `${RECOVERY_NOTICE_PREFIX} gave up after ${MAX_AUTO_CONTINUE_ATTEMPTS} attempts (${formatRecoveryReason(decision)}); check the agent`;
}
