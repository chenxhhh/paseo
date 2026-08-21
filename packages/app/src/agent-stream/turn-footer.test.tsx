/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: {
    OS: "web",
    select: (options: { web?: unknown; default?: unknown }) => options.web ?? options.default,
  },
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (theme: Record<string, unknown>) => unknown)({
            spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24 },
            colors: {
              foregroundMuted: "#aaa",
              palette: { amber: { 500: "#f0b429", 700: "#b7791f" } },
            },
          })
        : factory,
  },
  useUnistyles: () => ({ rt: { breakpoint: "md" } }),
  withUnistyles: <T,>(component: T) => component,
}));

vi.mock("@/components/message", () => ({
  AssistantTurnFooter: ({
    expanded,
    onToggleExpanded,
    resultSummary,
  }: {
    expanded?: boolean;
    onToggleExpanded?: () => void;
    resultSummary?: string;
  }) => (
    <div
      data-testid="assistant-turn-footer"
      data-expanded={expanded ? "true" : "false"}
      data-has-toggle={onToggleExpanded ? "true" : "false"}
      data-result-summary={resultSummary ?? ""}
    />
  ),
  LiveElapsed: () => <span data-testid="running-turn-timestamp" />,
  STREAM_METADATA_FONT_SIZE: 11,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

vi.mock("@/components/assistant-fork-menu", () => ({
  AssistantForkMenu: () => <button data-testid="running-turn-fork" type="button" />,
}));

vi.mock("@/components/synced-loader", () => ({
  SyncedLoader: () => <span data-testid="running-turn-loader" />,
}));

vi.mock("./turn-result-cards", () => ({
  TurnResultCardsRow: () => <div data-testid="turn-result-cards" />,
}));

vi.mock("@/components/retained-panel", () => ({
  useRetainedPanelActive: () => true,
}));

import { CompletedTurnFooterRow, TurnFooter } from "./turn-footer";
import type { TurnCollapsePresenter } from "./turn-footer";

const unusedRunningTurnStrategy = null as unknown as React.ComponentProps<
  typeof TurnFooter
>["strategy"];

const completedFooterItems = [
  {
    kind: "assistant_message" as const,
    id: "a1",
    text: "done",
    timestamp: new Date("2026-08-01T10:00:00.000Z"),
  },
];

const collapsePresenter: TurnCollapsePresenter = {
  summary: {
    anchorItemId: "a1",
    hiddenItemCount: 3,
    editedFileCount: 2,
    commandCount: 1,
    files: [],
    webPages: [],
  },
  expanded: false,
  onToggle: () => undefined,
};

describe("TurnFooter", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("places the running-turn fork between the loader and timestamp", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <TurnFooter
          isRunning
          inFlightTurnStartedAt={new Date("2026-08-01T10:00:00.000Z")}
          host={null}
          strategy={unusedRunningTurnStrategy}
          supportsTimelineCursor
          onForkInFlightTurn={vi.fn()}
        />,
      );
    });

    const footer = container.querySelector('[data-testid="turn-working-indicator"]');
    const controls = Array.from(footer?.querySelectorAll("[data-testid]") ?? []).map((node) =>
      node.getAttribute("data-testid"),
    );

    expect(controls).toEqual([
      "running-turn-loader",
      "running-turn-fork",
      "running-turn-timestamp",
    ]);
  });

  it("renders the collapse toggle when a turnCollapse presenter is provided", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <CompletedTurnFooterRow
          strategy={unusedRunningTurnStrategy}
          items={completedFooterItems}
          startIndex={0}
          supportsTimelineCursor
          turnCollapse={collapsePresenter}
        />,
      );
    });

    const footer = container.querySelector('[data-testid="assistant-turn-footer"]');
    expect(footer?.getAttribute("data-has-toggle")).toBe("true");
    expect(footer?.getAttribute("data-expanded")).toBe("false");
    expect(footer?.getAttribute("data-result-summary")).toBe(
      "toolCallGroup.editedFiles.other:2 · toolCallGroup.commands.one:1",
    );
  });

  it("renders the plain duration footer when turnCollapse is absent", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <CompletedTurnFooterRow
          strategy={unusedRunningTurnStrategy}
          items={completedFooterItems}
          startIndex={0}
          supportsTimelineCursor
        />,
      );
    });

    const footer = container.querySelector('[data-testid="assistant-turn-footer"]');
    expect(footer?.getAttribute("data-has-toggle")).toBe("false");
    expect(footer?.getAttribute("data-result-summary")).toBe("");
  });
});
