import { describe, expect, it } from "vitest";

import { hasVisibleOrderChanged, mergeSubgroupOrder, mergeWithRemainder } from "./sidebar-reorder";

describe("hasVisibleOrderChanged", () => {
  it("returns false when visible order is unchanged", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b", "c", "d"],
        reorderedVisibleKeys: ["a", "b", "c"],
      }),
    ).toBe(false);
  });

  it("returns true when visible items are reordered", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b", "c", "d"],
        reorderedVisibleKeys: ["b", "a", "c"],
      }),
    ).toBe(true);
  });

  it("returns true when a visible key is missing from current order", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b"],
        reorderedVisibleKeys: ["a", "c"],
      }),
    ).toBe(true);
  });
});

describe("mergeWithRemainder", () => {
  it("appends non-visible stored keys after reordered visible keys", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["a", "x", "b", "y"],
        reorderedVisibleKeys: ["b", "a"],
      }),
    ).toEqual(["b", "a", "x", "y"]);
  });

  it("keeps unknown current keys when no visible keys are reordered", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["stale", "hidden"],
        reorderedVisibleKeys: [],
      }),
    ).toEqual(["stale", "hidden"]);
  });
});

describe("mergeSubgroupOrder", () => {
  it("replaces subgroup keys in place and leaves the rest untouched", () => {
    expect(
      mergeSubgroupOrder({
        currentOrder: ["main", "a", "other", "b", "tail"],
        reorderedSubgroupKeys: ["b", "a"],
      }),
    ).toEqual(["main", "b", "other", "a", "tail"]);
  });

  it("appends subgroup keys that were not in the current order", () => {
    expect(
      mergeSubgroupOrder({
        currentOrder: ["main", "a", "tail"],
        reorderedSubgroupKeys: ["a", "new"],
      }),
    ).toEqual(["main", "a", "tail", "new"]);
  });

  it("is a no-op when the subgroup relative order is unchanged", () => {
    expect(
      mergeSubgroupOrder({
        currentOrder: ["main", "a", "other", "b"],
        reorderedSubgroupKeys: ["a", "b"],
      }),
    ).toEqual(["main", "a", "other", "b"]);
  });

  it("returns the current order when no subgroup keys are reordered", () => {
    expect(
      mergeSubgroupOrder({
        currentOrder: ["main", "a"],
        reorderedSubgroupKeys: [],
      }),
    ).toEqual(["main", "a"]);
  });
});
