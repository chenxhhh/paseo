/**
 * Quick commands: user-defined prompt presets surfaced as buttons in the chat
 * composer. Each command is either global or bound to one project, so the same
 * composer menu can offer project-specific and shared commands at once.
 */

export type QuickCommandScope = { type: "global" } | { type: "project"; projectId: string };

export interface QuickCommand {
  id: string;
  label: string;
  prompt: string;
  scope: QuickCommandScope;
}

export const MAX_QUICK_COMMANDS = 50;
export const MAX_QUICK_COMMAND_LABEL_LENGTH = 80;
export const MAX_QUICK_COMMAND_PROMPT_LENGTH = 8000;

export function createQuickCommandId(): string {
  return `qc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function clampText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return [...trimmed].slice(0, maxLength).join("");
}

function normalizeScope(value: unknown): QuickCommandScope | null {
  if (typeof value !== "object" || value === null) return null;
  const scope = value as { type?: unknown; projectId?: unknown };
  if (scope.type === "global") return { type: "global" };
  if (scope.type === "project" && typeof scope.projectId === "string" && scope.projectId !== "") {
    return { type: "project", projectId: scope.projectId };
  }
  return null;
}

/** Parses one stored entry, or null when it is unusable (dropped on load). */
export function normalizeQuickCommand(value: unknown): QuickCommand | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as { id?: unknown; label?: unknown; prompt?: unknown; scope?: unknown };
  if (typeof entry.id !== "string" || entry.id === "") return null;
  const label = clampText(entry.label, MAX_QUICK_COMMAND_LABEL_LENGTH);
  const prompt = clampText(entry.prompt, MAX_QUICK_COMMAND_PROMPT_LENGTH);
  const scope = normalizeScope(entry.scope);
  if (label === null || prompt === null || scope === null) return null;
  return { id: entry.id, label, prompt, scope };
}

/** Parses the persisted list: drops unusable entries, later duplicates of an id,
 * and anything past the cap. */
export function normalizeQuickCommands(value: unknown): QuickCommand[] {
  if (!Array.isArray(value)) return [];
  const result: QuickCommand[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (result.length >= MAX_QUICK_COMMANDS) break;
    const command = normalizeQuickCommand(entry);
    if (command === null || seen.has(command.id)) continue;
    seen.add(command.id);
    result.push(command);
  }
  return result;
}

/** A global command matches every project; a project command matches only its
 * own. `projectId === null` means the composer has no project context (draft
 * composers), where only global commands apply. */
export function quickCommandMatchesProject(
  command: QuickCommand,
  projectId: string | null,
): boolean {
  if (command.scope.type === "global") return true;
  return projectId !== null && command.scope.projectId === projectId;
}

export function upsertQuickCommand(
  commands: readonly QuickCommand[],
  command: QuickCommand,
): QuickCommand[] {
  const index = commands.findIndex((existing) => existing.id === command.id);
  if (index === -1) {
    const next = [...commands, command];
    return next.length > MAX_QUICK_COMMANDS ? next.slice(0, MAX_QUICK_COMMANDS) : next;
  }
  return commands.map((existing) => (existing.id === command.id ? command : existing));
}

export function removeQuickCommand(commands: readonly QuickCommand[], id: string): QuickCommand[] {
  return commands.filter((command) => command.id !== id);
}

export interface QuickCommandInsertionInput {
  text: string;
  prompt: string;
  cursorIndex: number;
}

/** Single-line preview of a prompt for menus and list rows. */
export function quickCommandPromptPreview(prompt: string, maxLength = 80): string {
  const firstLine =
    prompt
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ");
  return [...collapsed].slice(0, maxLength).join("") + (collapsed.length > maxLength ? "…" : "");
}

/** Builds the composer text with `prompt` spliced in at the cursor, adding a
 * separating space when the preceding character is not whitespace. */
export function buildQuickCommandInsertion(input: QuickCommandInsertionInput): {
  text: string;
  selection: { start: number; end: number };
} {
  const insertAt = Math.min(Math.max(Math.floor(input.cursorIndex), 0), input.text.length);
  const needsSpace =
    insertAt > 0 && !/\s/.test(input.text[insertAt - 1] ?? "") && !/^\s/.test(input.prompt);
  const prefix = needsSpace ? " " : "";
  const inserted = `${prefix}${input.prompt}`;
  const text = input.text.slice(0, insertAt) + inserted + input.text.slice(insertAt);
  const cursor = insertAt + inserted.length;
  return { text, selection: { start: cursor, end: cursor } };
}
