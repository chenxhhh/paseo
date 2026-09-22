import { JSDOM } from "jsdom";
import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTabIcon, type WorkspaceTabPresentation } from "./workspace-tab-presentation";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8 },
    fontSize: { base: 15 },
    borderRadius: { full: 9999 },
    colors: {
      surface0: "#000000",
      foreground: "#ffffff",
      foregroundMuted: "#aaaaaa",
      statusDotWarning: "#f0c000",
      statusDotDanger: "#e04040",
      statusDotRunning: "#4060e0",
      statusDotSuccess: "#6cb17b",
      statusSuccess: "#6cb17b",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  // The themed wrappers are pass-throughs: the lucide stubs below ignore `uniProps`, and the test
  // reads the glyph shape, not the theme mapping.
  withUnistyles: (Component: unknown) => Component,
}));

vi.mock("lucide-react-native", async () => {
  const ReactModule = await import("react");
  const stub =
    (name: string) =>
    ({ size }: { size?: number }): ReactElement =>
      ReactModule.createElement("div", { "data-icon": name, "data-size": size });
  return {
    Check: stub("check"),
    CircleAlert: stub("circle-alert"),
    CircleCheck: stub("circle-check"),
  };
});

vi.mock("@/components/status-ring", async () => {
  const ReactModule = await import("react");
  return {
    StatusRing: (): ReactElement =>
      ReactModule.createElement("div", { "data-icon": "status-ring" }),
  };
});

// The module pulls the whole panel registry in for the resolver; WorkspaceTabIcon needs none of it,
// and the registry's style creation would demand a complete theme.
vi.mock("@/panels/register-panels", () => ({ ensurePanelsRegistered: () => undefined }));
vi.mock("@/panels/panel-registry", () => ({ getPanelRegistration: () => null }));
vi.mock("@/panels/panel-instance-attributes", () => ({
  usePanelInstanceAttributes: () => ({ modified: false }),
}));

const jsdom = new JSDOM();
const { window } = jsdom;
vi.stubGlobal("window", window);
vi.stubGlobal("document", window.document);
// App sources compile against the classic JSX runtime, which expects React on the global.
vi.stubGlobal("React", React);

const mounted: { root: Root; container: HTMLDivElement }[] = [];

function mountIcon(
  presentation: Partial<WorkspaceTabPresentation> & Pick<WorkspaceTabPresentation, "statusBucket">,
): HTMLDivElement {
  const fullPresentation: WorkspaceTabPresentation = {
    key: "tab",
    kind: "agent",
    label: "Tab",
    subtitle: "",
    tooltip: "Tab",
    modified: false,
    titleState: "ready",
    icon: () => React.createElement("div", { "data-icon": "agent" }),
    ...presentation,
  };
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(WorkspaceTabIcon, {
        presentation: fullPresentation,
        backdrop: "surface1",
      }),
    );
  });
  mounted.push({ root, container });
  return container;
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

describe("WorkspaceTabIcon status marks", () => {
  it("marks a done agent with the success check", () => {
    const container = mountIcon({ statusBucket: "done" });
    expect(container.querySelector('[data-icon="circle-check"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="status-ring"]')).toBeNull();
    expect(container.querySelector('[data-icon="circle-alert"]')).toBeNull();
  });

  it("keeps a canceled provider child unmarked instead of claiming success", () => {
    const container = mountIcon({ statusBucket: "done", terminalStatus: "canceled" });
    expect(container.querySelector('[data-icon="circle-check"]')).toBeNull();
    expect(container.querySelector('[data-icon="status-ring"]')).toBeNull();
    expect(container.querySelector('[data-icon="circle-alert"]')).toBeNull();
  });

  it("marks a completed provider child with the same success check", () => {
    const container = mountIcon({ statusBucket: "done", terminalStatus: "completed" });
    expect(container.querySelector('[data-icon="circle-check"]')).not.toBeNull();
  });

  it("renders the ring for a running agent and no done check", () => {
    const container = mountIcon({ statusBucket: "running" });
    expect(container.querySelector('[data-icon="status-ring"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="circle-check"]')).toBeNull();
  });

  it("renders the alert badge for an agent that needs input", () => {
    const container = mountIcon({ statusBucket: "needs_input" });
    expect(container.querySelector('[data-icon="circle-alert"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="circle-check"]')).toBeNull();
  });

  it("does not give an attention agent the done check", () => {
    const container = mountIcon({ statusBucket: "attention" });
    expect(container.querySelector('[data-icon="circle-check"]')).toBeNull();
    expect(container.querySelector('[data-icon="status-ring"]')).toBeNull();
    expect(container.querySelector('[data-icon="circle-alert"]')).toBeNull();
  });

  it("does not give a failed agent the done check", () => {
    const container = mountIcon({ statusBucket: "failed" });
    expect(container.querySelector('[data-icon="circle-check"]')).toBeNull();
    expect(container.querySelector('[data-icon="status-ring"]')).toBeNull();
    expect(container.querySelector('[data-icon="circle-alert"]')).toBeNull();
  });

  it("renders no mark without a bucket", () => {
    const container = mountIcon({ statusBucket: null });
    expect(container.querySelector('[data-icon="circle-check"]')).toBeNull();
    expect(container.querySelector('[data-icon="status-ring"]')).toBeNull();
    expect(container.querySelector('[data-icon="circle-alert"]')).toBeNull();
  });
});
