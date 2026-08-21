import { describe, expect, it } from "vitest";
import { TOOL_CALL_DETAIL_LEVEL_ORDER, getNextToolCallDetailLevel } from "./levels";

describe("tool call detail level cycle", () => {
  it("orders the levels detailed → auto → overview", () => {
    expect(TOOL_CALL_DETAIL_LEVEL_ORDER).toEqual(["detailed", "auto", "overview"]);
  });

  it("cycles detailed → auto → overview → detailed", () => {
    expect(getNextToolCallDetailLevel("detailed")).toBe("auto");
    expect(getNextToolCallDetailLevel("auto")).toBe("overview");
    expect(getNextToolCallDetailLevel("overview")).toBe("detailed");
  });
});
