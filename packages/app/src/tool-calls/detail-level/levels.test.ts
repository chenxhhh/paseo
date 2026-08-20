import { describe, expect, it } from "vitest";
import { TOOL_CALL_DETAIL_LEVEL_ORDER, getNextToolCallDetailLevel } from "./levels";

describe("tool call detail level cycle", () => {
  it("orders the levels detailed → balanced → overview", () => {
    expect(TOOL_CALL_DETAIL_LEVEL_ORDER).toEqual(["detailed", "balanced", "overview"]);
  });

  it("cycles detailed → balanced → overview → detailed", () => {
    expect(getNextToolCallDetailLevel("detailed")).toBe("balanced");
    expect(getNextToolCallDetailLevel("balanced")).toBe("overview");
    expect(getNextToolCallDetailLevel("overview")).toBe("detailed");
  });
});
