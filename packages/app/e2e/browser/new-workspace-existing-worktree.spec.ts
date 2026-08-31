import { existsSync } from "node:fs";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  archiveWorkspaceFromDaemon,
  archiveLocalWorkspaceFromDaemon,
  assertNewWorkspaceSidebarAndHeader,
  connectNewWorkspaceDaemonClient,
  createWorktreeViaDaemon,
  expectWorkspaceIsolationSelected,
  openNewWorkspaceComposer,
  openProjectViaDaemon,
  openExistingWorktreePicker,
  selectExistingWorktreeInPicker,
  selectWorkspaceIsolation,
  submitNewWorkspaceEmpty,
} from "../support/helpers/new-workspace";
import { getServerId } from "../support/helpers/server-id";
import {
  archiveWorkspaceFromSidebar,
  expectWorkspaceAbsentFromSidebar,
} from "../support/helpers/sidebar";
import { createTempGitRepo } from "../support/helpers/workspace";
import {
  waitForSidebarHydration,
  waitForWorkspaceInSidebar,
} from "../support/helpers/workspace-ui";

test.describe("New workspace existing worktree adoption", () => {
  let client: Awaited<ReturnType<typeof connectNewWorkspaceDaemonClient>>;
  const localWorkspaceIds = new Set<string>();
  const createdWorktreeDirectories = new Set<string>();

  test.describe.configure({ retries: 1, timeout: 180_000 });

  test.beforeEach(async () => {
    client = await connectNewWorkspaceDaemonClient();
  });

  test.afterEach(async () => {
    if (client) {
      for (const workspaceDirectory of createdWorktreeDirectories) {
        await archiveWorkspaceFromDaemon(client, workspaceDirectory).catch(() => undefined);
      }
      for (const workspaceId of localWorkspaceIds) {
        await archiveLocalWorkspaceFromDaemon(client, workspaceId).catch(() => undefined);
      }
    }
    createdWorktreeDirectories.clear();
    localWorkspaceIds.clear();
    await client?.close().catch(() => undefined);
  });

  test("adopts an in-use existing worktree as a second workspace", async ({ page }) => {
    const serverId = getServerId();
    const tempRepo = await createTempGitRepo("existing-wt-");

    try {
      const openedProject = await openProjectViaDaemon(client, tempRepo.path);
      localWorkspaceIds.add(openedProject.workspaceId);

      const worktree = await createWorktreeViaDaemon(client, {
        cwd: tempRepo.path,
        slug: `adopt-${Date.now()}`,
      });
      createdWorktreeDirectories.add(worktree.workspaceDirectory);
      expect(existsSync(worktree.workspaceDirectory)).toBe(true);

      const listed = await client.getPaseoWorktreeList({ cwd: tempRepo.path });
      const listedWorktree = listed.worktrees.find(
        (entry) => entry.worktreePath === worktree.workspaceDirectory,
      );
      const worktreeLabel = listedWorktree?.branchName ?? worktree.workspaceName;

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await waitForWorkspaceInSidebar(page, { serverId, workspaceId: worktree.workspaceId });

      await openNewWorkspaceComposer(page, {
        projectKey: openedProject.projectKey,
        projectDisplayName: openedProject.projectDisplayName,
      });
      await selectWorkspaceIsolation(page, "existing-worktree");
      await expectWorkspaceIsolationSelected(page, "existing-worktree");
      await expect(page.getByTestId("new-workspace-ref-picker-trigger")).toHaveCount(0);

      await openExistingWorktreePicker(page);
      await selectExistingWorktreeInPicker(page, { label: worktreeLabel, inUse: true });
      await submitNewWorkspaceEmpty(page);

      const adopted = await assertNewWorkspaceSidebarAndHeader(page, {
        serverId,
        client,
        previousWorkspaceId: worktree.workspaceId,
        projectDisplayName: openedProject.projectDisplayName,
      });
      expect(adopted.workspaceDirectory).toBe(worktree.workspaceDirectory);
      expect(adopted.workspaceId).not.toBe(worktree.workspaceId);

      await waitForWorkspaceInSidebar(page, { serverId, workspaceId: worktree.workspaceId });
      await waitForWorkspaceInSidebar(page, { serverId, workspaceId: adopted.workspaceId });

      await archiveWorkspaceFromSidebar(page, worktree.workspaceId);
      await expectWorkspaceAbsentFromSidebar(page, worktree.workspaceId);
      expect(existsSync(worktree.workspaceDirectory)).toBe(true);
      await waitForWorkspaceInSidebar(page, { serverId, workspaceId: adopted.workspaceId });
    } finally {
      await tempRepo.cleanup();
    }
  });
});
