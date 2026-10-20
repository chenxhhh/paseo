import { describe, expect, it } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { DEFAULT_WORKSPACE_STATUSES } from "@/utils/workspace-statuses";
import {
  filterBoardWorkspaces,
  groupWorkspacesByProject,
  groupWorkspacesByStatus,
} from "./board-filters";

function workspace(
  overrides: Partial<SidebarWorkspaceEntry> & Pick<SidebarWorkspaceEntry, "workspaceKey">,
): SidebarWorkspaceEntry {
  return {
    serverId: "server-1",
    workspaceId: overrides.workspaceKey,
    projectViewKey: "project-a",
    projectName: "Project A",
    projectKind: "git",
    workspaceKind: "checkout",
    name: overrides.workspaceKey,
    statusBucket: "done",
    statusEnteredAt: null,
    workspaceDirectory: "/repo/a",
    workspaceDirectoryLabel: overrides.workspaceKey,
    title: null,
    pinnedAt: null,
    labels: [],
    userStatus: null,
    currentBranch: null,
    activeAgents: [],
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    ...overrides,
  };
}

describe("filterBoardWorkspaces", () => {
  const workspaces = [
    workspace({ workspaceKey: "w1", title: "Fix login" }),
    workspace({ workspaceKey: "w2", projectName: "Billing", currentBranch: "feat/invoice" }),
  ];

  it("returns every workspace for an empty query", () => {
    expect(filterBoardWorkspaces(workspaces, "")).toBe(workspaces);
    expect(filterBoardWorkspaces(workspaces, "   ")).toBe(workspaces);
  });

  it("matches the title case-insensitively", () => {
    expect(filterBoardWorkspaces(workspaces, "LOGIN").map((w) => w.workspaceKey)).toEqual(["w1"]);
  });

  it("matches the project name and branch", () => {
    expect(filterBoardWorkspaces(workspaces, "billing").map((w) => w.workspaceKey)).toEqual(["w2"]);
    expect(filterBoardWorkspaces(workspaces, "invoice").map((w) => w.workspaceKey)).toEqual(["w2"]);
  });

  it("returns nothing when no field matches", () => {
    expect(filterBoardWorkspaces(workspaces, "zzz")).toEqual([]);
  });
});

describe("groupWorkspacesByProject", () => {
  it("buckets by project and follows the given project order", () => {
    const workspaces = [
      workspace({ workspaceKey: "w1", projectViewKey: "p-b", projectName: "Bee" }),
      workspace({ workspaceKey: "w2", projectViewKey: "p-a", projectName: "Ant" }),
      workspace({ workspaceKey: "w3", projectViewKey: "p-a", projectName: "Ant" }),
    ];
    const groups = groupWorkspacesByProject(workspaces, ["p-a", "p-b"]);
    expect(groups.map((group) => group.key)).toEqual(["p-a", "p-b"]);
    expect(groups[0]?.workspaces.map((w) => w.workspaceKey)).toEqual(["w2", "w3"]);
    expect(groups[0]?.label).toBe("Ant");
  });

  it("never emits an empty project column", () => {
    const groups = groupWorkspacesByProject(
      [workspace({ workspaceKey: "w1", projectViewKey: "p-a" })],
      ["p-a", "p-empty"],
    );
    expect(groups.map((group) => group.key)).toEqual(["p-a"]);
  });

  it("puts projects missing from the order last", () => {
    const workspaces = [
      workspace({ workspaceKey: "w1", projectViewKey: "p-unknown" }),
      workspace({ workspaceKey: "w2", projectViewKey: "p-known" }),
    ];
    const groups = groupWorkspacesByProject(workspaces, ["p-known"]);
    expect(groups.map((group) => group.key)).toEqual(["p-known", "p-unknown"]);
  });
});

describe("groupWorkspacesByStatus", () => {
  const statuses = [...DEFAULT_WORKSPACE_STATUSES];

  it("orders sections by the status catalog, not by the cards", () => {
    const workspaces = [
      workspace({ workspaceKey: "w1", userStatus: "done" }),
      workspace({ workspaceKey: "w2", userStatus: "todo" }),
    ];
    const groups = groupWorkspacesByStatus(workspaces, statuses);
    expect(groups.map((group) => group.status?.id)).toEqual(["todo", "done"]);
  });

  it("drops statuses that have no cards in this lane", () => {
    const groups = groupWorkspacesByStatus(
      [workspace({ workspaceKey: "w1", userStatus: "todo" })],
      statuses,
    );
    expect(groups.map((group) => group.status?.id)).toEqual(["todo"]);
    expect(groups[0]?.workspaces.map((w) => w.workspaceKey)).toEqual(["w1"]);
  });

  it("falls back to the default lane for unset or retired statuses", () => {
    const groups = groupWorkspacesByStatus(
      [
        workspace({ workspaceKey: "w1", userStatus: null }),
        workspace({ workspaceKey: "w2", userStatus: "deleted-status" }),
      ],
      statuses,
    );
    expect(groups.map((group) => group.status?.id)).toEqual(["in-progress"]);
    expect(groups[0]?.workspaces.map((w) => w.workspaceKey)).toEqual(["w1", "w2"]);
  });

  it("returns nothing for an empty lane", () => {
    expect(groupWorkspacesByStatus([], statuses)).toEqual([]);
  });
});
