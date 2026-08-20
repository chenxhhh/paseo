import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function joinSummaryParts(parts: string[], conjunction: string): string {
  if (parts.length === 0) {
    return "";
  }
  let joined = parts[0] ?? "";
  if (parts.length === 2) {
    joined = `${parts[0]} ${conjunction} ${parts[1]}`;
  } else if (parts.length > 2) {
    joined = `${parts.slice(0, -1).join(", ")}, ${conjunction} ${parts.at(-1)}`;
  }
  const firstCharacter = joined[0];
  return firstCharacter ? `${firstCharacter.toLocaleUpperCase()}${joined.slice(1)}` : joined;
}

export interface SummaryCountEntry {
  count: number;
  keyRoot: string; // e.g. { count: 3, keyRoot: "toolCallGroup.readFiles" }
}

export function useToolCallSummarySentence(entries: readonly SummaryCountEntry[]): string {
  const { t } = useTranslation();
  return useMemo(() => {
    const parts: string[] = [];
    for (const entry of entries) {
      if (entry.count > 0) {
        parts.push(
          t(`${entry.keyRoot}.${entry.count === 1 ? "one" : "other"}`, { count: entry.count }),
        );
      }
    }
    return joinSummaryParts(parts, t("toolCallGroup.and"));
  }, [entries, t]);
}
