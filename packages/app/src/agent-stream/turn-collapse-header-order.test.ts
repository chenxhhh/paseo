import { describe, expect, it } from "vitest";
import { orderUserMessageCollapseHeader } from "./turn-collapse-header-order";

describe("orderUserMessageCollapseHeader", () => {
  it("places the header after the message on forward lists", () => {
    expect(orderUserMessageCollapseHeader("content-then-footer", "message", "header")).toEqual([
      "message",
      "header",
    ]);
  });

  it("places the header before the message on native inverted cells", () => {
    expect(orderUserMessageCollapseHeader("footer-then-content", "message", "header")).toEqual([
      "header",
      "message",
    ]);
  });
});
