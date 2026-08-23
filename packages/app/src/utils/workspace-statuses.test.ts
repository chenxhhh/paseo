import { describe, expect, test } from "vitest";
import {
  cloneDefaultWorkspaceStatuses,
  getDefaultWorkspaceStatusId,
  getWorkspaceStatusFromGroupKey,
  getWorkspaceStatusGroupKey,
  getWorkspaceUserStatus,
  makeWorkspaceStatusId,
  normalizeWorkspaceStatuses,
  resolveStatusRemovalReassignment,
} from "./workspace-statuses";

describe("normalizeWorkspaceStatuses", () => {
  test("returns the defaults for non-array input", () => {
    expect(normalizeWorkspaceStatuses(undefined)).toEqual(cloneDefaultWorkspaceStatuses());
    expect(normalizeWorkspaceStatuses(null)).toEqual(cloneDefaultWorkspaceStatuses());
    expect(normalizeWorkspaceStatuses({})).toEqual(cloneDefaultWorkspaceStatuses());
    expect(normalizeWorkspaceStatuses([])).toEqual(cloneDefaultWorkspaceStatuses());
  });

  test("keeps a well-formed catalog untouched", () => {
    const statuses = [
      { id: "todo", label: "Todo", color: "sky" },
      { id: "blocked", label: "Blocked", color: "red" },
    ];
    expect(normalizeWorkspaceStatuses(statuses)).toEqual(statuses);
  });

  test("trims and clamps labels, slugs ids, and drops duplicates", () => {
    const normalized = normalizeWorkspaceStatuses([
      { id: "  In Review  ", label: "  In   review ", color: "violet" },
      { id: "in-review", label: "Other", color: "nope" },
      { label: "x".repeat(50), color: "emerald" },
      "garbage",
    ]);
    expect(normalized).toHaveLength(3);
    expect(normalized[0]).toEqual({ id: "in-review", label: "In review", color: "violet" });
    // A duplicate id is re-slugged from its label rather than silently dropped;
    // its invalid color then has no default to fall back on, so it takes the
    // palette slot by index.
    expect(normalized[1]?.id).toBe("other");
    expect(normalized[1]?.color).toBe("sky");
    // Labels clamp to 32 characters; a missing id slugs from the clamped label.
    expect(normalized[2]?.label).toBe("x".repeat(32));
    expect(normalized[2]?.id).toBe("x".repeat(32));
  });

  test("maps unknown colors onto the palette", () => {
    const normalized = normalizeWorkspaceStatuses([{ id: "custom", label: "Custom", color: 7 }]);
    expect(typeof normalized[0]?.color).toBe("string");
  });
});

describe("makeWorkspaceStatusId", () => {
  test("suffixes -2, -3… until the id is free", () => {
    const existing: import("./workspace-statuses").WorkspaceStatusDefinition[] = [
      { id: "todo", label: "Todo", color: "sky" },
      { id: "todo-2", label: "Todo 2", color: "sky" },
    ];
    expect(makeWorkspaceStatusId("Todo", existing)).toBe("todo-3");
    expect(makeWorkspaceStatusId("Fresh", existing)).toBe("fresh");
    expect(makeWorkspaceStatusId("???!!", existing)).toBe("status");
  });
});

describe("lane resolution", () => {
  const statuses = cloneDefaultWorkspaceStatuses();

  test("getWorkspaceUserStatus keeps valid assignments and falls back to the default", () => {
    expect(getWorkspaceUserStatus({ userStatus: "todo", statuses })).toBe("todo");
    expect(getWorkspaceUserStatus({ userStatus: null, statuses })).toBe("in-progress");
    expect(getWorkspaceUserStatus({ userStatus: undefined, statuses })).toBe("in-progress");
    expect(getWorkspaceUserStatus({ userStatus: "deleted", statuses })).toBe("in-progress");
  });

  test("the default falls back to the first status when in-progress is gone", () => {
    const withoutDefault = statuses.filter((status) => status.id !== "in-progress");
    expect(getDefaultWorkspaceStatusId(withoutDefault)).toBe("todo");
  });
});

describe("status removal", () => {
  test("reassigns to the neighbor that takes the removed lane's place", () => {
    const statuses = cloneDefaultWorkspaceStatuses();
    expect(resolveStatusRemovalReassignment({ removedStatusId: "in-progress", statuses })).toEqual({
      reassignTo: "in-review",
    });
    expect(resolveStatusRemovalReassignment({ removedStatusId: "done", statuses })).toEqual({
      reassignTo: "in-review",
    });
    expect(resolveStatusRemovalReassignment({ removedStatusId: "todo", statuses })).toEqual({
      reassignTo: "in-progress",
    });
  });
});

describe("group key codec", () => {
  test("round-trips ids, including ones the encodeURIComponent would escape", () => {
    const statuses = cloneDefaultWorkspaceStatuses();
    const key = getWorkspaceStatusGroupKey("in-progress");
    expect(getWorkspaceStatusFromGroupKey(key, statuses)).toBe("in-progress");
    expect(getWorkspaceStatusFromGroupKey("user-status:todo", statuses)).toBe("todo");
    expect(getWorkspaceStatusFromGroupKey("user-status:gone", statuses)).toBeNull();
    expect(getWorkspaceStatusFromGroupKey("needs_input", statuses)).toBeNull();
  });
});
