import { describe, expect, it } from "vitest";
import {
  buildExistingWorktreePickerData,
  collectActiveWorkspaceDirectories,
  existingWorktreeLabel,
  existingWorktreeOptionId,
  isExistingWorktreeInUse,
  workspacePathsMatch,
  type ExistingWorktreeItem,
} from "./existing-worktree-picker";

function worktree(
  input: Partial<ExistingWorktreeItem> & Pick<ExistingWorktreeItem, "worktreePath">,
): ExistingWorktreeItem {
  return {
    branchName: "branchName" in input ? input.branchName : "feature",
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    head: input.head ?? "abc123",
    worktreePath: input.worktreePath,
  };
}

describe("existingWorktreeLabel", () => {
  it("prefers the branch name when present", () => {
    expect(
      existingWorktreeLabel(
        worktree({ worktreePath: "/home/dev/.paseo/worktrees/repo/feat-abc", branchName: "feat" }),
      ),
    ).toBe("feat");
  });

  it("falls back to the worktree path basename when the branch is missing", () => {
    expect(
      existingWorktreeLabel({
        worktreePath: "/home/dev/.paseo/worktrees/repo/feat-abc",
        branchName: null,
      }),
    ).toBe("feat-abc");
  });
});

describe("workspacePathsMatch", () => {
  it("matches unix paths after stripping a trailing slash", () => {
    expect(
      workspacePathsMatch(
        "/home/dev/.paseo/worktrees/repo/feat",
        "/home/dev/.paseo/worktrees/repo/feat/",
      ),
    ).toBe(true);
  });

  it("does not match unix paths that differ only by case", () => {
    expect(workspacePathsMatch("/tmp/Foo", "/tmp/foo")).toBe(false);
  });

  it("matches win32 paths case-insensitively after separator normalization", () => {
    expect(
      workspacePathsMatch(
        "C:\\Users\\dev\\.paseo\\worktrees\\repo\\feat",
        "c:/users/dev/.paseo/worktrees/repo/feat/",
      ),
    ).toBe(true);
  });
});

describe("isExistingWorktreeInUse", () => {
  it("marks a worktree in use when an active workspace directory matches", () => {
    expect(
      isExistingWorktreeInUse("/repo/.paseo/worktrees/feat", [
        "/other",
        "/repo/.paseo/worktrees/feat/",
      ]),
    ).toBe(true);
  });

  it("leaves a worktree unmarked when no active workspace uses it", () => {
    expect(isExistingWorktreeInUse("/repo/.paseo/worktrees/feat", ["/repo"])).toBe(false);
  });
});

describe("collectActiveWorkspaceDirectories", () => {
  it("collects directories for workspace keys that belong to the selected host", () => {
    expect(
      collectActiveWorkspaceDirectories({
        serverId: "host-a",
        workspaceKeys: ["host-a:ws-1", "host-b:ws-2", "host-a:ws-3"],
        getWorkspaceDirectory: (workspaceId) =>
          workspaceId === "ws-1" ? "/repo/.paseo/worktrees/feat" : "/repo",
      }),
    ).toEqual(["/repo/.paseo/worktrees/feat", "/repo"]);
  });
});

describe("buildExistingWorktreePickerData", () => {
  it("builds options with path descriptions and in-use flags", () => {
    const data = buildExistingWorktreePickerData({
      worktrees: [
        worktree({
          worktreePath: "/home/dev/.paseo/worktrees/repo/feat-abc",
          branchName: "feat",
        }),
        worktree({
          worktreePath: "/home/dev/.paseo/worktrees/repo/other-def",
          branchName: "other",
        }),
      ],
      activeWorkspaceDirectories: ["/home/dev/.paseo/worktrees/repo/feat-abc"],
      selectedWorktreePath: "/home/dev/.paseo/worktrees/repo/feat-abc",
    });

    expect(data.selectedOptionId).toBe(
      existingWorktreeOptionId("/home/dev/.paseo/worktrees/repo/feat-abc"),
    );
    expect(data.options).toEqual([
      {
        id: existingWorktreeOptionId("/home/dev/.paseo/worktrees/repo/feat-abc"),
        label: "feat",
        description: "/home/dev/.paseo/worktrees/repo/feat-abc",
      },
      {
        id: existingWorktreeOptionId("/home/dev/.paseo/worktrees/repo/other-def"),
        label: "other",
        description: "/home/dev/.paseo/worktrees/repo/other-def",
      },
    ]);
    expect(data.itemById.get(data.options[0]?.id ?? "")).toEqual({
      worktreePath: "/home/dev/.paseo/worktrees/repo/feat-abc",
      branchName: "feat",
      label: "feat",
      inUse: true,
    });
    expect(data.itemById.get(data.options[1]?.id ?? "")?.inUse).toBe(false);
  });

  it("marks win32 worktrees in use despite path case and separators", () => {
    const worktreePath = "C:\\Users\\dev\\.paseo\\worktrees\\repo\\feat-abc";
    const data = buildExistingWorktreePickerData({
      worktrees: [worktree({ worktreePath, branchName: "feat" })],
      activeWorkspaceDirectories: ["c:/users/dev/.paseo/worktrees/repo/feat-abc"],
    });

    expect(data.itemById.get(existingWorktreeOptionId(worktreePath))?.inUse).toBe(true);
  });

  it("keeps a selected worktree visible when it is missing from the latest list", () => {
    const selectedPath = "/home/dev/.paseo/worktrees/repo/stale";
    const data = buildExistingWorktreePickerData({
      worktrees: [
        worktree({
          worktreePath: "/home/dev/.paseo/worktrees/repo/feat-abc",
          branchName: "feat",
        }),
      ],
      activeWorkspaceDirectories: [],
      selectedWorktreePath: selectedPath,
    });

    expect(data.selectedOptionId).toBe(existingWorktreeOptionId(selectedPath));
    expect(data.options[0]).toEqual({
      id: existingWorktreeOptionId(selectedPath),
      label: "stale",
      description: selectedPath,
    });
  });
});
