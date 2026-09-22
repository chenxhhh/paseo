import { describe, expect, it } from "vitest";
import { partitionProjectColumns, type BoardColumn } from "./board-canvas.shared";

function column(key: string, collapsed: boolean): BoardColumn {
  return {
    key,
    label: `Column ${key}`,
    workspaces: [],
    status: null,
    assignable: false,
    groups: null,
    collapsed,
    onToggleCollapsed: () => {},
  };
}

describe("partitionProjectColumns", () => {
  it("parks every collapsed lane at the end, in project order", () => {
    const columns = [column("a", false), column("b", true), column("c", false), column("d", true)];
    const { openColumns, collapsedColumns } = partitionProjectColumns(columns);
    expect(openColumns.map((c) => c.key)).toEqual(["a", "c"]);
    expect(collapsedColumns.map((c) => c.key)).toEqual(["b", "d"]);
  });

  it("keeps each side's own order so an expanded lane returns to its place", () => {
    // "b" collapses while it sits between "a" and "c"; expanding it later must
    // put it back in the middle, not at the end.
    const columns = [column("a", false), column("b", true), column("c", false)];
    const { collapsedColumns } = partitionProjectColumns(columns);
    expect(collapsedColumns.map((c) => c.key)).toEqual(["b"]);
    const reopened = [column("a", false), column("b", false), column("c", false)];
    expect(partitionProjectColumns(reopened).openColumns.map((c) => c.key)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("handles all-open and all-collapsed boards", () => {
    const allOpen = [column("a", false), column("b", false)];
    expect(partitionProjectColumns(allOpen).collapsedColumns).toEqual([]);

    const allCollapsed = [column("a", true), column("b", true)];
    const partitioned = partitionProjectColumns(allCollapsed);
    expect(partitioned.openColumns).toEqual([]);
    expect(partitioned.collapsedColumns.map((c) => c.key)).toEqual(["a", "b"]);
  });

  it("returns empty halves for no columns", () => {
    expect(partitionProjectColumns([])).toEqual({ openColumns: [], collapsedColumns: [] });
  });
});
