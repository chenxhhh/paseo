import type { ProcessRunDigest } from "./process-run-collapse";

const LABEL_PARTS: readonly {
  countOf: (digest: ProcessRunDigest) => number;
  keyRoot: string;
}[] = [
  { countOf: (digest) => digest.thoughtCount, keyRoot: "toolCallGroup.thoughts" },
  { countOf: (digest) => digest.todoCount, keyRoot: "toolCallGroup.todos" },
  { countOf: (digest) => digest.toolCountsByCategory.read, keyRoot: "toolCallGroup.readFiles" },
  { countOf: (digest) => digest.toolCountsByCategory.search, keyRoot: "toolCallGroup.searches" },
  { countOf: (digest) => digest.toolCountsByCategory.edit, keyRoot: "toolCallGroup.editedFiles" },
  { countOf: (digest) => digest.toolCountsByCategory.shell, keyRoot: "toolCallGroup.commands" },
  { countOf: (digest) => digest.toolCountsByCategory.fetch, keyRoot: "toolCallGroup.fetches" },
  { countOf: (digest) => digest.toolCountsByCategory.other, keyRoot: "toolCallGroup.otherTools" },
];

export function formatProcessRunLabel(
  digest: ProcessRunDigest,
  t: (key: string, options: { count: number }) => string,
): string {
  const parts: string[] = [];
  for (const part of LABEL_PARTS) {
    const count = part.countOf(digest);
    if (count > 0) {
      parts.push(t(`${part.keyRoot}.${count === 1 ? "one" : "other"}`, { count }));
    }
  }
  return parts.join(" · ");
}
