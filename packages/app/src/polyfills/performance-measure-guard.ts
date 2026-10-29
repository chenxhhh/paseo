// React 19's development build logs every component render and effect via
// performance.measure("\u200b" + ComponentName, { detail: { devtools: ... } }).
// In long-running streaming sessions, React serializes and structured-clones
// large prop diffs into Chromium's performance entry buffer thousands of times
// per minute without ever clearing them, eventually exhausting renderer memory
// ("DataCloneError: Failed to execute 'measure' on 'Performance': Data cannot
// be cloned, out of memory") and crashing the Electron renderer (black screen).

const CLEAR_MEASURES_INTERVAL = 200;

export function polyfillPerformanceMeasureGuard(): void {
  if (typeof performance === "undefined" || typeof performance.measure !== "function") {
    return;
  }

  const originalMeasure = performance.measure.bind(performance);
  const clearMeasures =
    typeof performance.clearMeasures === "function"
      ? performance.clearMeasures.bind(performance)
      : null;
  let measureCount = 0;

  try {
    performance.measure = function guardedPerformanceMeasure(
      measureName: string,
      startOrMeasureOptions?: string | PerformanceMeasureOptions,
      endMark?: string,
    ): PerformanceMeasure {
      // React 19 dev prefixes component render/effect measures with U+200B (zero-width space)
      // and attaches a potentially huge `detail.devtools.properties` diff array.
      if (typeof measureName === "string" && measureName.charCodeAt(0) === 0x200b) {
        if (clearMeasures && ++measureCount >= CLEAR_MEASURES_INTERVAL) {
          measureCount = 0;
          try {
            clearMeasures();
          } catch {
            // Ignore errors while clearing performance buffer.
          }
        }
        try {
          if (
            startOrMeasureOptions !== null &&
            typeof startOrMeasureOptions === "object" &&
            "detail" in startOrMeasureOptions
          ) {
            return originalMeasure(measureName, {
              start: startOrMeasureOptions.start,
              end: startOrMeasureOptions.end,
            });
          }
          return originalMeasure(
            measureName,
            startOrMeasureOptions as PerformanceMeasureOptions,
            endMark,
          );
        } catch {
          return undefined as unknown as PerformanceMeasure;
        }
      }

      try {
        return originalMeasure(
          measureName,
          startOrMeasureOptions as PerformanceMeasureOptions,
          endMark,
        );
      } catch {
        return undefined as unknown as PerformanceMeasure;
      }
    };
  } catch {
    // Ignore if performance.measure is read-only in this environment.
  }
}
