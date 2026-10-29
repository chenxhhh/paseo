import { describe, expect, it, vi } from "vitest";
import { polyfillPerformanceMeasureGuard } from "./performance-measure-guard";

describe("polyfillPerformanceMeasureGuard", () => {
  it("strips detail from React dev component measures and periodically clears measures", () => {
    const originalMeasure = performance.measure;
    const originalClearMeasures = performance.clearMeasures;
    const measureSpy = vi.fn(
      (_name: string, _options?: string | PerformanceMeasureOptions) => ({}) as PerformanceMeasure,
    );
    const clearSpy = vi.fn();

    performance.measure = measureSpy as unknown as typeof performance.measure;
    performance.clearMeasures = clearSpy;

    try {
      polyfillPerformanceMeasureGuard();

      performance.measure("\u200bStreamRowContent", {
        start: 10,
        end: 20,
        detail: { devtools: { properties: [["items", "[large array]"]] } },
      });

      expect(measureSpy).toHaveBeenCalledWith("\u200bStreamRowContent", {
        start: 10,
        end: 20,
      });

      performance.measure("custom-app-measure", {
        start: 5,
        end: 15,
        detail: { keep: true },
      });

      expect(measureSpy).toHaveBeenLastCalledWith(
        "custom-app-measure",
        {
          start: 5,
          end: 15,
          detail: { keep: true },
        },
        undefined,
      );

      for (let i = 0; i < 200; i += 1) {
        performance.measure("\u200bComponent", { start: 1, end: 2, detail: {} });
      }
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      performance.measure = originalMeasure;
      performance.clearMeasures = originalClearMeasures;
    }
  });
});
