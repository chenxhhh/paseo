import { describe, expect, it } from "vitest";
import {
  MAX_QUICK_COMMANDS,
  buildQuickCommandInsertion,
  normalizeQuickCommand,
  normalizeQuickCommands,
  quickCommandMatchesProject,
  removeQuickCommand,
  upsertQuickCommand,
  type QuickCommand,
} from "./model";

function command(overrides: Partial<QuickCommand> = {}): QuickCommand {
  return {
    id: "id-1",
    label: "Explain diff",
    prompt: "Explain the changes in this diff",
    scope: { type: "global" },
    ...overrides,
  };
}

describe("normalizeQuickCommand", () => {
  it("keeps a well-formed entry", () => {
    expect(normalizeQuickCommand(command())).toEqual(command());
  });

  it("trims and clamps label and prompt", () => {
    const parsed = normalizeQuickCommand({
      id: "id-2",
      label: `  ${"a".repeat(100)}  `,
      prompt: `  ${"p".repeat(9000)}  `,
      scope: { type: "global" },
    });
    expect(parsed?.label).toHaveLength(80);
    expect(parsed?.prompt).toHaveLength(8000);
  });

  it("rejects entries missing required fields", () => {
    expect(normalizeQuickCommand(null)).toBeNull();
    expect(
      normalizeQuickCommand({ id: "x", label: "", prompt: "p", scope: { type: "global" } }),
    ).toBeNull();
    expect(
      normalizeQuickCommand({ id: "x", label: "l", prompt: "", scope: { type: "global" } }),
    ).toBeNull();
    expect(
      normalizeQuickCommand({ id: "x", label: "l", prompt: "p", scope: { type: "nope" } }),
    ).toBeNull();
    expect(
      normalizeQuickCommand({ id: "x", label: "l", prompt: "p", scope: { type: "project" } }),
    ).toBeNull();
  });
});

describe("normalizeQuickCommands", () => {
  it("returns empty for non-array values", () => {
    expect(normalizeQuickCommands(undefined)).toEqual([]);
    expect(normalizeQuickCommands({})).toEqual([]);
  });

  it("drops invalid entries and duplicate ids", () => {
    const kept = command();
    const parsed = normalizeQuickCommands([
      kept,
      { id: "bad", label: "no prompt", prompt: "", scope: { type: "global" } },
      { ...kept, label: "Duplicate id" },
    ]);
    expect(parsed).toEqual([kept]);
  });

  it("caps the list size", () => {
    const many = Array.from({ length: MAX_QUICK_COMMANDS + 10 }, (_, index) =>
      command({ id: `id-${index}` }),
    );
    expect(normalizeQuickCommands(many)).toHaveLength(MAX_QUICK_COMMANDS);
  });
});

describe("quickCommandMatchesProject", () => {
  const global = command({ id: "g", scope: { type: "global" } });
  const project = command({ id: "p", scope: { type: "project", projectId: "proj-1" } });

  it("global commands match everywhere, even without project context", () => {
    expect(quickCommandMatchesProject(global, "proj-1")).toBe(true);
    expect(quickCommandMatchesProject(global, null)).toBe(true);
  });

  it("project commands match only their own project", () => {
    expect(quickCommandMatchesProject(project, "proj-1")).toBe(true);
    expect(quickCommandMatchesProject(project, "proj-2")).toBe(false);
    expect(quickCommandMatchesProject(project, null)).toBe(false);
  });
});

describe("upsertQuickCommand", () => {
  it("appends a new command", () => {
    const next = upsertQuickCommand([command({ id: "a" })], command({ id: "b" }));
    expect(next.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("replaces an existing command in place", () => {
    const next = upsertQuickCommand(
      [command({ id: "a" }), command({ id: "b" })],
      command({ id: "a", label: "Updated" }),
    );
    expect(next).toHaveLength(2);
    expect(next[0].label).toBe("Updated");
  });

  it("never grows past the cap", () => {
    const full = Array.from({ length: MAX_QUICK_COMMANDS }, (_, index) =>
      command({ id: `id-${index}` }),
    );
    const next = upsertQuickCommand(full, command({ id: "extra" }));
    expect(next).toHaveLength(MAX_QUICK_COMMANDS);
    expect(next.some((entry) => entry.id === "extra")).toBe(false);
  });
});

describe("removeQuickCommand", () => {
  it("removes only the targeted id", () => {
    const next = removeQuickCommand([command({ id: "a" }), command({ id: "b" })], "a");
    expect(next.map((entry) => entry.id)).toEqual(["b"]);
  });
});

describe("buildQuickCommandInsertion", () => {
  it("inserts into an empty input", () => {
    expect(buildQuickCommandInsertion({ text: "", prompt: "hello", cursorIndex: 0 })).toEqual({
      text: "hello",
      selection: { start: 5, end: 5 },
    });
  });

  it("inserts at the cursor with a separating space", () => {
    expect(
      buildQuickCommandInsertion({ text: "fix the bug", prompt: "now", cursorIndex: 11 }),
    ).toEqual({ text: "fix the bug now", selection: { start: 15, end: 15 } });
  });

  it("does not double the space when one is already present", () => {
    expect(buildQuickCommandInsertion({ text: "fix ", prompt: "now", cursorIndex: 4 }).text).toBe(
      "fix now",
    );
  });

  it("does not add a space when the prompt starts with whitespace", () => {
    expect(
      buildQuickCommandInsertion({ text: "fix", prompt: " the bug", cursorIndex: 3 }).text,
    ).toBe("fix the bug");
  });

  it("inserts before trailing text with a separating space", () => {
    expect(buildQuickCommandInsertion({ text: "ab", prompt: "X", cursorIndex: 1 })).toEqual({
      text: "a Xb",
      selection: { start: 3, end: 3 },
    });
  });

  it("clamps an out-of-range cursor", () => {
    expect(buildQuickCommandInsertion({ text: "ab", prompt: "X", cursorIndex: 99 }).text).toBe(
      "ab X",
    );
    expect(buildQuickCommandInsertion({ text: "ab", prompt: "X", cursorIndex: -3 }).text).toBe(
      "Xab",
    );
  });
});
