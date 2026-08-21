/**
 * @vitest-environment jsdom
 */
import { act, fireEvent } from "@testing-library/react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceScriptPayload } from "@getpaseo/protocol/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KeyboardActionDispatcherProvider } from "@/keyboard/keyboard-action-dispatcher-context";
import { createProjectViewKey } from "@/projects/workspace-structure";
import {
  branchGroupCollapseKey,
  worktreeGroupCollapseKey,
} from "@/hooks/sidebar-workspaces-view-model";
import { SidebarWorkspaceList } from "@/components/sidebar-workspace-list";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  const ReactModule = require("react") as typeof import("react");
  (globalThis as unknown as { React: typeof import("react") }).React = ReactModule;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

const pathnameState = vi.hoisted(() => ({
  value: "/",
}));

vi.mock("expo-router", () => ({
  router: {
    dismissTo: vi.fn(),
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => pathnameState.value,
}));

vi.mock("react-native-reanimated", () => {
  class Keyframe {
    readonly frames: unknown;
    constructor(frames: unknown) {
      this.frames = frames;
    }
  }
  function Animated(props: { children?: React.ReactNode }) {
    return React.createElement("div", props);
  }
  Animated.View = "div";
  return {
    default: Animated,
    Easing: { ease: "ease", inOut: (value: unknown) => value },
    FadeIn: {},
    FadeOut: {},
    Keyframe,
    interpolateColor: (value: number, _input: number[], output: string[]) =>
      value >= 1 ? output[1] : output[0],
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useDerivedValue: (factory: () => unknown) => ({ value: factory() }),
    withTiming: (value: unknown) => value,
    ReduceMotion: { System: "system", Always: "always", Never: "never" },
  };
});

vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn(),
  getStringAsync: vi.fn(),
}));

vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

vi.mock("react-native-gesture-handler", () => ({
  Gesture: {},
  GestureDetector: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  ScrollView: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("react-native-draggable-flatlist", () => ({
  NestableScrollContainer: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@gorhom/portal", () => ({
  Portal: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@/components/sidebar/sidebar-status-list", () => ({
  SidebarStatusWorkspaceList: () => null,
}));

vi.mock("@/components/rename-modal", () => ({
  AdaptiveRenameModal: () => null,
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  AdaptiveTextInput: "input",
}));

vi.mock("@/components/sidebar/sidebar-workspace-menu", () => {
  function flattenStyle(style: unknown): Record<string, unknown> | undefined {
    if (!style) {
      return undefined;
    }
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.filter(Boolean));
    }
    if (typeof style === "object") {
      return style as Record<string, unknown>;
    }
    return undefined;
  }
  return {
    SidebarWorkspaceContextMenu: ({
      children,
      testID,
      style,
    }: {
      children?: React.ReactNode;
      testID?: string;
      style?: unknown;
    }) =>
      React.createElement("div", { "data-testid": testID, style: flattenStyle(style) }, children),
    SidebarWorkspaceMenu: () => null,
  };
});

vi.mock("@/utils/confirm-dialog", () => ({
  confirmDialog: vi.fn(async () => true),
}));

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  ContextMenuContent: () => null,
  ContextMenuItem: () => null,
  ContextMenuTrigger: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  useContextMenu: () => null,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
}));

vi.mock("@/workspace/open-in-file-manager/menu-item", () => ({
  OpenInFileManagerMenuItem: () => null,
}));

import {
  createSidebarWorkspaceEntry,
  type SidebarProjectEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspacesList } from "@/hooks/use-sidebar-workspaces-list";
import { patchWorkspaceScripts } from "@/contexts/session-workspace-scripts";
import {
  getHostRuntimeStore,
  type HostRuntimeController,
  type HostRuntimeSnapshot,
} from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { seedSessionWorkspaces } from "@/test/seed-session";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { defaultHostAppearance } from "@/hosts/appearance";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ error: vi.fn(), show: vi.fn(), copied: vi.fn() }),
}));

vi.mock("@/projects/icons", () => ({
  useProjectIcons: () => new Map(),
}));

vi.mock("@/hooks/use-sidebar-workspace-pin", () => ({
  useSidebarWorkspacePinController: () => () => {},
}));

vi.mock("@/components/workspace-hover-card", () => ({
  WorkspaceHoverCard: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@/hooks/use-settings", async () => {
  const actual =
    await vi.importActual<typeof import("@/hooks/use-settings")>("@/hooks/use-settings");
  return {
    ...actual,
    useAppSettings: () => ({
      settings: {
        sidebarRowItems: {
          branch: false,
          project: false,
          host: false,
          changeRequest: false,
          services: false,
          labels: false,
        },
      },
      isLoading: false,
      error: null,
      updateSettings: async () => {},
      resetSettings: async () => {},
    }),
  };
});

const SERVER_ID = "sidebar-render-count";

interface RenderCounts {
  frame: number;
  headers: Record<string, number>;
  rows: Record<string, number>;
  projectSelection: Record<string, number>;
  rowSelection: Record<string, number>;
}

const runningScript: WorkspaceScriptPayload = {
  scriptName: "web",
  type: "service",
  hostname: "web.paseo.localhost",
  port: 3000,
  proxyUrl: "http://web.paseo.localhost:6767",
  lifecycle: "running",
  health: "healthy",
  exitCode: null,
  terminalId: null,
};

function workspace(input: {
  id: string;
  projectId: string;
  projectDisplayName: string;
  name: string;
  status?: WorkspaceDescriptor["status"];
  scripts?: WorkspaceDescriptor["scripts"];
}): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId,
    projectDisplayName: input.projectDisplayName,
    projectRootPath: `/repo/${input.projectId}`,
    workspaceDirectory: `/repo/${input.projectId}/${input.id}`,
    projectKind: "git",
    workspaceKind: input.name === "main" ? "local_checkout" : "worktree",
    name: input.name,
    status: input.status ?? "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: input.scripts ?? [],
  };
}

function createWorkspaces(): WorkspaceDescriptor[] {
  return [
    workspace({
      id: "a-main",
      projectId: "project-a",
      projectDisplayName: "Project A",
      name: "main",
      scripts: [runningScript],
    }),
    workspace({
      id: "a-one",
      projectId: "project-a",
      projectDisplayName: "Project A",
      name: "one",
    }),
    workspace({
      id: "a-two",
      projectId: "project-a",
      projectDisplayName: "Project A",
      name: "two",
    }),
    workspace({
      id: "b-main",
      projectId: "project-b",
      projectDisplayName: "Project B",
      name: "main",
    }),
    workspace({
      id: "b-one",
      projectId: "project-b",
      projectDisplayName: "Project B",
      name: "one",
    }),
    workspace({
      id: "b-two",
      projectId: "project-b",
      projectDisplayName: "Project B",
      name: "two",
    }),
  ];
}

function makeHost(): HostProfile {
  const now = "2026-04-19T00:00:00.000Z";
  return {
    serverId: SERVER_ID,
    label: "Render Count Host",
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections: [],
    preferredConnectionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function setHostProfiles(hosts: HostProfile[]): void {
  (
    getHostRuntimeStore() as unknown as {
      setHostsAndSync: (hosts: HostProfile[]) => void;
    }
  ).setHostsAndSync(hosts);
}

function initializeSidebarState(workspaces: WorkspaceDescriptor[]): void {
  act(() => {
    setHostProfiles([makeHost()]);
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
    seedSessionWorkspaces(SERVER_ID, new Map(workspaces.map((entry) => [entry.id, entry])));
    useSessionStore.getState().setHasHydratedWorkspaces(SERVER_ID, true);
    useSidebarOrderStore.setState({
      projectOrder: ["project-a", "project-b"],
      workspaceOrderByProject: {
        ["project-a"]: [`${SERVER_ID}:a-main`, `${SERVER_ID}:a-one`, `${SERVER_ID}:a-two`],
        ["project-b"]: [`${SERVER_ID}:b-main`, `${SERVER_ID}:b-one`, `${SERVER_ID}:b-two`],
      },
    });
  });
}

function resetCounts(counts: RenderCounts): void {
  counts.frame = 0;
  counts.headers = {};
  counts.rows = {};
  counts.projectSelection = {};
  counts.rowSelection = {};
}

function incrementRecord(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function ProjectHeaderProbe({
  project,
  counts,
}: {
  project: SidebarProjectEntry;
  counts: RenderCounts;
}): null {
  incrementRecord(counts.headers, project.viewKey);
  return null;
}

function WorkspaceRowProbe({
  serverId,
  workspaceId,
  counts,
}: {
  serverId: string;
  workspaceId: string;
  counts: RenderCounts;
}): null {
  const workspaceEntry = useWorkspaceFields(serverId, workspaceId, (entry) =>
    createSidebarWorkspaceEntry({ serverId, workspace: entry }),
  );
  if (workspaceEntry) {
    incrementRecord(counts.rows, workspaceEntry.workspaceId);
  }
  return null;
}

function ProjectActiveProbe({
  serverId,
  project,
  counts,
}: {
  serverId: string;
  project: SidebarProjectEntry;
  counts: RenderCounts;
}): null {
  const activeSelection = useActiveWorkspaceSelection();
  const isActive =
    activeSelection?.serverId === serverId &&
    project.workspaces.some((entry) => entry.workspaceId === activeSelection.workspaceId);
  void isActive;
  incrementRecord(counts.projectSelection, project.viewKey);
  return null;
}

function WorkspaceSelectionProbe({
  serverId,
  workspaceId,
  counts,
}: {
  serverId: string;
  workspaceId: string;
  counts: RenderCounts;
}): null {
  const activeSelection = useActiveWorkspaceSelection();
  const selected =
    activeSelection?.serverId === serverId && activeSelection.workspaceId === workspaceId;
  void selected;
  incrementRecord(counts.rowSelection, workspaceId);
  return null;
}

function SidebarFrameProbe({ counts }: { counts: RenderCounts }): ReactElement {
  counts.frame += 1;
  const { projects } = useSidebarWorkspacesList({ hostFilters: [SERVER_ID] });

  return (
    <>
      {projects.map((project) => (
        <div key={project.viewKey}>
          <ProjectHeaderProbe project={project} counts={counts} />
          <ProjectActiveProbe serverId={SERVER_ID} project={project} counts={counts} />
          {project.workspaces.map((entry) => (
            <React.Fragment key={entry.workspaceKey}>
              <WorkspaceRowProbe
                serverId={entry.serverId}
                workspaceId={entry.workspaceId}
                counts={counts}
              />
              <WorkspaceSelectionProbe
                serverId={entry.serverId}
                workspaceId={entry.workspaceId}
                counts={counts}
              />
            </React.Fragment>
          ))}
        </div>
      ))}
    </>
  );
}

function getHostController(): HostRuntimeController {
  const controllers = (
    getHostRuntimeStore() as unknown as {
      controllers: Map<string, HostRuntimeController>;
    }
  ).controllers;
  const controller = controllers.get(SERVER_ID);
  if (!controller) {
    throw new Error("Host runtime controller was not initialized");
  }
  return controller;
}

function updateControllerSnapshot(
  patch: Partial<Omit<HostRuntimeSnapshot, "serverId" | "clientGeneration">>,
): void {
  (
    getHostController() as unknown as {
      updateSnapshot: (
        patch: Partial<Omit<HostRuntimeSnapshot, "serverId" | "clientGeneration">>,
      ) => void;
    }
  ).updateSnapshot(patch);
}

async function renderProbe(counts: RenderCounts): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    renderSidebarFrame(root, counts);
  });
  resetCounts(counts);
  return { root, container };
}

function renderSidebarFrame(root: Root, counts: RenderCounts) {
  root.render(<SidebarFrameProbe counts={counts} />);
}

describe("sidebar workspace render isolation", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    initializeSidebarState(createWorkspaces());
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    act(() => {
      pathnameState.value = "/";
      setHostProfiles([]);
      useSessionStore.getState().clearSession(SERVER_ID);
      useSidebarOrderStore.setState({
        projectOrder: [],
        workspaceOrderByProject: {},
      });
    });
  });

  it("re-renders only the changed workspace row for a status update", async () => {
    const counts: RenderCounts = {
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    };
    ({ root, container } = await renderProbe(counts));

    act(() => {
      useSessionStore.getState().mergeWorkspaces(SERVER_ID, [
        {
          ...createWorkspaces()[1],
          status: "running",
        },
      ]);
    });

    expect(counts.frame).toBe(0);
    expect(counts.headers).toEqual({});
    expect(counts.rows).toEqual({ "a-one": 1 });
  });

  it("does not re-render the sidebar for a host-runtime probe tick with no content change", async () => {
    const counts: RenderCounts = {
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    };
    ({ root, container } = await renderProbe(counts));

    act(() => {
      const probeByConnectionId = getHostController().getSnapshot().probeByConnectionId;
      updateControllerSnapshot({
        probeByConnectionId: new Map(probeByConnectionId),
      });
    });

    expect(counts).toEqual({
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    });
  });

  it("does not re-render for a deep-equal scripts patch", async () => {
    const counts: RenderCounts = {
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    };
    ({ root, container } = await renderProbe(counts));

    const applyRunningScript = (current: Parameters<typeof patchWorkspaceScripts>[0]) =>
      patchWorkspaceScripts(current, {
        workspaceId: "a-main",
        scripts: [{ ...runningScript }],
      });

    act(() => {
      useSessionStore.getState().setWorkspaces(SERVER_ID, applyRunningScript);
    });

    expect(counts).toEqual({
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    });
  });

  it("updates active selection probes from the active workspace route", async () => {
    const counts: RenderCounts = {
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    };

    act(() => {
      pathnameState.value = `/h/${SERVER_ID}/workspace/a-one`;
    });
    ({ root, container } = await renderProbe(counts));

    act(() => {
      pathnameState.value = `/h/${SERVER_ID}/workspace/b-two`;
      if (root) {
        renderSidebarFrame(root, counts);
      }
    });

    expect(counts.frame).toBe(1);
    expect(counts.projectSelection).toEqual({
      [createProjectViewKey({ kind: "equivalence", projectKey: "project-a" })]: 1,
      [createProjectViewKey({ kind: "equivalence", projectKey: "project-b" })]: 1,
    });
    expect(counts.rowSelection).toEqual({
      "a-main": 1,
      "a-one": 1,
      "a-two": 1,
      "b-main": 1,
      "b-one": 1,
      "b-two": 1,
    });
  });
});

function noopToggleProjectCollapsed(_projectViewKey: string): void {}
function noopToggleWorktreeGroupCollapsed(_workspaceGroupKey: string): void {}

describe("sidebar project worktree grouping", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;
  let queryClient: QueryClient | null = null;

  const viewKey = "project-a";
  const featureDirectory = "/worktrees/feature";
  const otherDirectory = "/worktrees/other";

  function groupingWorkspace(input: {
    id: string;
    kind: WorkspaceDescriptor["workspaceKind"];
    directory: string;
    slug?: string;
    branch?: string;
  }): WorkspaceDescriptor {
    return {
      id: input.id,
      projectId: "project-a",
      projectDisplayName: "Project A",
      projectRootPath: "/repo/project-a",
      workspaceDirectory: input.directory,
      projectKind: "git",
      workspaceKind: input.kind,
      name: input.id,
      title: null,
      status: "done",
      statusEnteredAt: null,
      archivingAt: null,
      diffStat: null,
      scripts: [],
      worktreeSlug: input.slug,
      gitRuntime: input.branch
        ? {
            currentBranch: input.branch,
            isDirty: false,
            aheadOfOrigin: 0,
          }
        : undefined,
    };
  }

  function buildGroupingList() {
    const main = groupingWorkspace({
      id: "a-main",
      kind: "local_checkout",
      directory: "/repo/project-a",
    });
    const feature = groupingWorkspace({
      id: "a-feature",
      kind: "worktree",
      directory: featureDirectory,
      slug: "feature",
      branch: "feature",
    });
    const other = groupingWorkspace({
      id: "a-other",
      kind: "worktree",
      directory: otherDirectory,
      slug: "other",
      branch: "other-branch",
    });
    const descriptors = [main, feature, other];
    const entries = descriptors.map((descriptor) =>
      createSidebarWorkspaceEntry({ serverId: SERVER_ID, workspace: descriptor }),
    );
    const project: SidebarProjectEntry = {
      viewKey,
      projectName: "Project A",
      projectKind: "git",
      iconWorkingDir: "/repo/project-a",
      hosts: [
        {
          serverId: SERVER_ID,
          projectId: "project-a",
          iconWorkingDir: "/repo/project-a",
          worktreeSupport: "supported",
        },
      ],
      workspaces: entries.map((entry) => ({
        workspaceKey: entry.workspaceKey,
        serverId: entry.serverId,
        workspaceId: entry.workspaceId,
        projectViewKey: viewKey,
        projectName: entry.projectName,
        projectRootPath: entry.projectRootPath,
        workspaceDirectory: entry.workspaceDirectory,
        projectKind: entry.projectKind,
        workspaceKind: entry.workspaceKind,
        name: entry.name,
      })),
    };
    return {
      descriptors,
      project,
      workspaceEntriesByKey: new Map(entries.map((entry) => [entry.workspaceKey, entry])),
      featureGroupKey: worktreeGroupCollapseKey(viewKey, featureDirectory),
      otherGroupKey: worktreeGroupCollapseKey(viewKey, otherDirectory),
    };
  }

  function GroupingListHarness({
    grouping,
    collapsedWorkspaceGroupKeys,
    onToggleWorktreeGroupCollapsed,
  }: {
    grouping: ReturnType<typeof buildGroupingList>;
    collapsedWorkspaceGroupKeys: ReadonlySet<string>;
    onToggleWorktreeGroupCollapsed: (key: string) => void;
  }) {
    const workspaceGroups = React.useMemo(() => [] as never[], []);
    const projectIconTargets = React.useMemo(() => [] as never[], []);
    const projects = React.useMemo(() => [grouping.project], [grouping.project]);
    const pinnedGroups = React.useMemo(
      () => ({ pinnedChats: [] as never[], unpinnedProjects: projects }),
      [projects],
    );
    const collapsedProjectKeys = React.useMemo(() => new Set<string>(), []);
    const shortcutIndexByWorkspaceKey = React.useMemo(() => new Map<string, number>(), []);

    return (
      <SidebarWorkspaceList
        workspaceGroups={workspaceGroups}
        projectIconTargets={projectIconTargets}
        pinnedGroups={pinnedGroups}
        projects={projects}
        hasProjectsBeforeLabelFilter
        workspaceEntriesByKey={grouping.workspaceEntriesByKey}
        collapsedProjectKeys={collapsedProjectKeys}
        collapsedWorkspaceGroupKeys={collapsedWorkspaceGroupKeys}
        onToggleProjectCollapsed={noopToggleProjectCollapsed}
        onToggleWorktreeGroupCollapsed={onToggleWorktreeGroupCollapsed}
        shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
        groupMode="project"
      />
    );
  }

  function renderList(
    input: {
      collapsedWorkspaceGroupKeys?: ReadonlySet<string>;
      onToggleWorktreeGroupCollapsed?: (key: string) => void;
    } = {},
  ): ReturnType<typeof buildGroupingList> {
    const grouping = buildGroupingList();
    initializeSidebarState(grouping.descriptors);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const collapsedWorkspaceGroupKeys = input.collapsedWorkspaceGroupKeys ?? new Set<string>();
    const onToggleWorktreeGroupCollapsed =
      input.onToggleWorktreeGroupCollapsed ?? noopToggleWorktreeGroupCollapsed;
    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient!}>
          <KeyboardActionDispatcherProvider>
            <GroupingListHarness
              grouping={grouping}
              collapsedWorkspaceGroupKeys={collapsedWorkspaceGroupKeys}
              onToggleWorktreeGroupCollapsed={onToggleWorktreeGroupCollapsed}
            />
          </KeyboardActionDispatcherProvider>
        </QueryClientProvider>,
      );
    });
    return grouping;
  }

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    queryClient?.clear();
    queryClient = null;
    act(() => {
      pathnameState.value = "/";
      setHostProfiles([]);
      useSessionStore.getState().clearSession(SERVER_ID);
      useSidebarOrderStore.setState({
        projectOrder: [],
        workspaceOrderByProject: {},
      });
    });
  });

  it("renders worktree group headers and keeps the main list testID", () => {
    const grouping = buildGroupingList();
    renderList();

    expect(
      container?.querySelector(`[data-testid="sidebar-workspace-list-${viewKey}"]`),
    ).not.toBeNull();
    expect(
      container?.querySelector(
        `[data-testid="sidebar-worktree-group-${grouping.featureGroupKey}"]`,
      ),
    ).not.toBeNull();
    expect(
      container?.querySelector(`[data-testid="sidebar-worktree-group-${grouping.otherGroupKey}"]`),
    ).not.toBeNull();
    expect(container?.textContent).toContain("feature");
    expect(container?.textContent).toContain("other");
    expect(
      container?.querySelector(`[data-testid="sidebar-workspace-row-${SERVER_ID}:a-main"]`),
    ).not.toBeNull();
    expect(
      container?.querySelector(`[data-testid="sidebar-workspace-row-${SERVER_ID}:a-feature"]`),
    ).not.toBeNull();
  });

  it("hides worktree rows when the group is collapsed", () => {
    const grouping = buildGroupingList();
    renderList({
      collapsedWorkspaceGroupKeys: new Set([grouping.featureGroupKey]),
    });

    expect(
      container?.querySelector(`[data-testid="sidebar-workspace-row-${SERVER_ID}:a-feature"]`),
    ).toBeNull();
    expect(
      container?.querySelector(`[data-testid="sidebar-workspace-row-${SERVER_ID}:a-other"]`),
    ).not.toBeNull();
    expect(
      container?.querySelector(`[data-testid="sidebar-workspace-row-${SERVER_ID}:a-main"]`),
    ).not.toBeNull();
  });

  it("toggles a worktree group from the header", () => {
    const grouping = buildGroupingList();
    const onToggleWorktreeGroupCollapsed = vi.fn();
    renderList({ onToggleWorktreeGroupCollapsed });

    const header = container?.querySelector(
      `[data-testid="sidebar-worktree-group-${grouping.featureGroupKey}"]`,
    );
    expect(header).not.toBeNull();
    act(() => {
      fireEvent.click(header!);
    });
    expect(onToggleWorktreeGroupCollapsed).toHaveBeenCalledWith(grouping.featureGroupKey);
  });

  it("indents worktree rows and leaves main checkout rows flush", () => {
    renderList();

    const mainRow = container?.querySelector(
      `[data-testid="sidebar-workspace-row-${SERVER_ID}:a-main"]`,
    );
    const featureRow = container?.querySelector(
      `[data-testid="sidebar-workspace-row-${SERVER_ID}:a-feature"]`,
    );
    expect(mainRow).not.toBeNull();
    expect(featureRow).not.toBeNull();

    const mainPadding = window.getComputedStyle(mainRow as Element).paddingLeft;
    const featurePadding = window.getComputedStyle(featureRow as Element).paddingLeft;
    expect(Number.parseFloat(featurePadding)).toBeGreaterThan(
      Number.parseFloat(mainPadding || "0"),
    );
  });
});

describe("sidebar project branch grouping", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;
  let queryClient: QueryClient | null = null;

  const viewKey = "project-a";
  const mainBranch = "main";

  function groupingWorkspace(input: {
    id: string;
    kind: WorkspaceDescriptor["workspaceKind"];
    directory: string;
    branch?: string;
  }): WorkspaceDescriptor {
    return {
      id: input.id,
      projectId: "project-a",
      projectDisplayName: "Project A",
      projectRootPath: "/repo/project-a",
      workspaceDirectory: input.directory,
      projectKind: "git",
      workspaceKind: input.kind,
      name: input.id,
      title: null,
      status: "done",
      statusEnteredAt: null,
      archivingAt: null,
      diffStat: null,
      scripts: [],
      gitRuntime: input.branch
        ? {
            currentBranch: input.branch,
            isDirty: false,
            aheadOfOrigin: 0,
          }
        : undefined,
    };
  }

  function buildBranchGroupingList() {
    const detached = groupingWorkspace({
      id: "a-detached",
      kind: "local_checkout",
      directory: "/repo/project-a",
    });
    const checkoutA = groupingWorkspace({
      id: "a-checkout-a",
      kind: "local_checkout",
      directory: "/repo/project-a",
      branch: mainBranch,
    });
    const checkoutB = groupingWorkspace({
      id: "a-checkout-b",
      kind: "local_checkout",
      directory: "/repo/project-a",
      branch: mainBranch,
    });
    const descriptors = [detached, checkoutA, checkoutB];
    const entries = descriptors.map((descriptor) =>
      createSidebarWorkspaceEntry({ serverId: SERVER_ID, workspace: descriptor }),
    );
    const project: SidebarProjectEntry = {
      viewKey,
      projectName: "Project A",
      projectKind: "git",
      iconWorkingDir: "/repo/project-a",
      hosts: [
        {
          serverId: SERVER_ID,
          projectId: "project-a",
          iconWorkingDir: "/repo/project-a",
          worktreeSupport: "supported",
        },
      ],
      workspaces: entries.map((entry) => ({
        workspaceKey: entry.workspaceKey,
        serverId: entry.serverId,
        workspaceId: entry.workspaceId,
        projectViewKey: viewKey,
        projectName: entry.projectName,
        projectRootPath: entry.projectRootPath,
        workspaceDirectory: entry.workspaceDirectory,
        projectKind: entry.projectKind,
        workspaceKind: entry.workspaceKind,
        name: entry.name,
      })),
    };
    return {
      descriptors,
      project,
      workspaceEntriesByKey: new Map(entries.map((entry) => [entry.workspaceKey, entry])),
      branchGroupKey: branchGroupCollapseKey(viewKey, mainBranch),
    };
  }

  function BranchGroupingListHarness({
    grouping,
    collapsedWorkspaceGroupKeys,
  }: {
    grouping: ReturnType<typeof buildBranchGroupingList>;
    collapsedWorkspaceGroupKeys: ReadonlySet<string>;
  }) {
    const workspaceGroups = React.useMemo(() => [] as never[], []);
    const projectIconTargets = React.useMemo(() => [] as never[], []);
    const projects = React.useMemo(() => [grouping.project], [grouping.project]);
    const pinnedGroups = React.useMemo(
      () => ({ pinnedChats: [] as never[], unpinnedProjects: projects }),
      [projects],
    );
    const collapsedProjectKeys = React.useMemo(() => new Set<string>(), []);
    const shortcutIndexByWorkspaceKey = React.useMemo(() => new Map<string, number>(), []);

    return (
      <SidebarWorkspaceList
        workspaceGroups={workspaceGroups}
        projectIconTargets={projectIconTargets}
        pinnedGroups={pinnedGroups}
        projects={projects}
        hasProjectsBeforeLabelFilter
        workspaceEntriesByKey={grouping.workspaceEntriesByKey}
        collapsedProjectKeys={collapsedProjectKeys}
        collapsedWorkspaceGroupKeys={collapsedWorkspaceGroupKeys}
        onToggleProjectCollapsed={noopToggleProjectCollapsed}
        onToggleWorktreeGroupCollapsed={noopToggleWorktreeGroupCollapsed}
        shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
        groupMode="project"
      />
    );
  }

  function renderList(
    input: {
      collapsedWorkspaceGroupKeys?: ReadonlySet<string>;
    } = {},
  ): ReturnType<typeof buildBranchGroupingList> {
    const grouping = buildBranchGroupingList();
    initializeSidebarState(grouping.descriptors);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const collapsedWorkspaceGroupKeys = input.collapsedWorkspaceGroupKeys ?? new Set<string>();
    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient!}>
          <KeyboardActionDispatcherProvider>
            <BranchGroupingListHarness
              grouping={grouping}
              collapsedWorkspaceGroupKeys={collapsedWorkspaceGroupKeys}
            />
          </KeyboardActionDispatcherProvider>
        </QueryClientProvider>,
      );
    });
    return grouping;
  }

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    queryClient?.clear();
    queryClient = null;
    act(() => {
      pathnameState.value = "/";
      setHostProfiles([]);
      useSessionStore.getState().clearSession(SERVER_ID);
      useSidebarOrderStore.setState({
        projectOrder: [],
        workspaceOrderByProject: {},
      });
    });
  });

  it("renders a branch group header without a muted suffix and keeps the ungrouped list testID", () => {
    const grouping = buildBranchGroupingList();
    renderList();

    expect(
      container?.querySelector(`[data-testid="sidebar-workspace-list-${viewKey}"]`),
    ).not.toBeNull();
    const header = container?.querySelector(
      `[data-testid="sidebar-worktree-group-${grouping.branchGroupKey}"]`,
    );
    expect(header).not.toBeNull();
    expect(header?.textContent).toBe(mainBranch);
    expect(
      container?.querySelector(`[data-testid="sidebar-workspace-row-${SERVER_ID}:a-detached"]`),
    ).not.toBeNull();
    expect(
      container?.querySelector(`[data-testid="sidebar-workspace-row-${SERVER_ID}:a-checkout-a"]`),
    ).not.toBeNull();
  });

  it("hides branch group rows when the group is collapsed", () => {
    const grouping = buildBranchGroupingList();
    renderList({
      collapsedWorkspaceGroupKeys: new Set([grouping.branchGroupKey]),
    });

    expect(
      container?.querySelector(`[data-testid="sidebar-workspace-row-${SERVER_ID}:a-checkout-a"]`),
    ).toBeNull();
    expect(
      container?.querySelector(`[data-testid="sidebar-workspace-row-${SERVER_ID}:a-checkout-b"]`),
    ).toBeNull();
    expect(
      container?.querySelector(`[data-testid="sidebar-workspace-row-${SERVER_ID}:a-detached"]`),
    ).not.toBeNull();
    expect(
      container?.querySelector(`[data-testid="sidebar-workspace-list-${viewKey}"]`),
    ).not.toBeNull();
  });
});
