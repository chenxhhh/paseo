/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfilePickerRow } from "@/agent-profiles";
import { ModelBrowser, type ModelBrowserState } from "./model-browser";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      Object.entries(options ?? {}).reduce(
        (label, [name, value]) => label.replaceAll(`{{${name}}}`, String(value)),
        key,
      ),
  }),
}));

vi.mock("react-native-gesture-handler", () => {
  const chain = () => {
    const stub: Record<string, () => unknown> = {};
    for (const method of [
      "maxDistance",
      "shouldCancelWhenOutside",
      "runOnJS",
      "onBegin",
      "onEnd",
      "onFinalize",
      "hitSlop",
      "simultaneousWithExternalGesture",
      "shouldActivateOnStart",
      "disallowInterruption",
    ]) {
      stub[method] = () => stub;
    }
    return stub;
  };
  return {
    Gesture: { Tap: chain, Native: chain },
    GestureDetector: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", null, children),
  };
});

// The barrel re-exports the profile editor, whose modal chain bottoms out in
// @floating-ui/react-native — unparseable under vitest (pre-existing). Only
// AgentProfileGlyph is used at runtime by ModelBrowser; types are erased.
vi.mock("@/agent-profiles", () => ({
  AgentProfileGlyph: () => React.createElement("span", { "data-testid": "profile-glyph-stub" }),
}));

const MODEL_ID = "glm-5.3-flash[1m]";

const modelRow = {
  favoriteKey: `glm:${MODEL_ID}`,
  provider: "glm",
  providerLabel: "GLM",
  modelId: MODEL_ID,
  modelLabel: "GLM-5.3-Flash 1M",
  description: "Fast",
};

const providers = [
  {
    id: "glm",
    label: "GLM",
    modelSelection: { kind: "models" as const, rows: [modelRow] },
  },
];

const profileRow: AgentProfilePickerRow = {
  id: "profile-1",
  provider: "glm",
  modelId: MODEL_ID,
  icon: "",
  color: "#000000",
  name: "Daily driver",
  summary: "GLM · 5.3 Flash",
};

function buildState(view: ModelBrowserState["view"]): ModelBrowserState {
  return {
    serverId: null,
    providers,
    selectedProvider: "glm",
    selectedModel: MODEL_ID,
    profiles: { rows: [profileRow], applyProfile: () => {} },
    view,
    searchQuery: "",
    isSearchFocused: false,
    header: undefined as unknown as ModelBrowserState["header"],
    selectedModelLabel: "GLM-5.3-Flash 1M",
    triggerLabel: "GLM-5.3-Flash 1M",
    desktopFixedHeight: undefined,
    isProviderView: view.kind === "provider",
    prepareToOpen: () => {},
    showAll: () => {},
    reset: () => {},
    drillDown: () => {},
  };
}

const noop = () => {};

describe("ModelBrowser row DOM (web)", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders a selectable model row as role=option, not a native button, so its inline profile action is not a nested <button>", () => {
    act(() => {
      root.render(
        <ModelBrowser
          state={buildState({ kind: "provider", providerId: "glm", providerLabel: "GLM" })}
          onSelect={noop}
          onEditProfile={noop}
          scrolling="independent"
        />,
      );
    });

    const row = container.querySelector(`[data-testid="model-row-glm-${MODEL_ID}"]`);
    expect(row).not.toBeNull();
    // The row itself must not be a native <button>: its inline actions are
    // real buttons, and <button> cannot contain <button> (breaks hydration).
    expect(row?.tagName).toBe("DIV");
    expect(row?.getAttribute("role")).toBe("option");
    expect(row?.getAttribute("aria-selected")).toBe("true");

    // The inline profile edit action stays a real <button>, now legally nested.
    const edit = container.querySelector(`[data-testid="model-edit-profile-glm-${MODEL_ID}"]`);
    expect(edit).not.toBeNull();
    expect(edit?.tagName).toBe("BUTTON");
    expect(row?.contains(edit ?? container)).toBe(true);

    // The exact condition React complained about: no <button> inside a <button>.
    expect(container.querySelectorAll("button button")).toHaveLength(0);
  });

  it("still activates a model row with the Enter key", () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(
        <ModelBrowser
          state={buildState({ kind: "provider", providerId: "glm", providerLabel: "GLM" })}
          onSelect={onSelect}
          scrolling="independent"
        />,
      );
    });

    const row = container.querySelector<HTMLDivElement>(
      `[data-testid="model-row-glm-${MODEL_ID}"]`,
    );
    expect(row).not.toBeNull();
    act(() => {
      row?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      row?.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith("glm", MODEL_ID);
  });

  it("keeps non-selectable rows (provider drill-down) as native buttons", () => {
    act(() => {
      root.render(
        <ModelBrowser
          state={buildState({ kind: "all" })}
          onSelect={noop}
          scrolling="independent"
        />,
      );
    });

    const providerRow = container.querySelector('[data-testid="model-provider-glm"]');
    expect(providerRow).not.toBeNull();
    expect(providerRow?.tagName).toBe("BUTTON");
    expect(providerRow?.getAttribute("role")).toBe("button");
  });
});
