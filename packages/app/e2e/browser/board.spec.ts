import { test, expect } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";

function getBoardCardTestId(workspaceId: string): string {
  return `board-card-${getServerId()}:${workspaceId}`;
}

test.describe("workspace board", () => {
  test("shows a seeded workspace in the default lane and moves it by drag", async ({ page }) => {
    const project = await seedWorkspace({ repoPrefix: "board-drag-" });
    try {
      await gotoAppShell(page);

      await page.getByTestId("sidebar-board").click();
      await expect(page).toHaveURL(/\/board/);

      const defaultLane = page.getByTestId("board-column-in-progress");
      await expect(defaultLane).toBeVisible({ timeout: 30_000 });

      const card = page.getByTestId(getBoardCardTestId(project.workspaceId));
      await expect(card).toBeVisible({ timeout: 30_000 });

      // A fresh workspace carries no assignment, so it resolves to the default lane.
      await expect(defaultLane.getByTestId(getBoardCardTestId(project.workspaceId))).toBeVisible();

      // Create a lane through the column manager, then drop the card on it.
      await page.getByTestId("board-manage-trigger").click();
      const sheet = page.getByTestId("board-manage-sheet");
      await expect(sheet).toBeVisible();
      await page.getByTestId("board-manage-add").click();
      await page.getByTestId("board-manage-create-modal").getByRole("textbox").fill("Verified");
      await page
        .getByTestId("board-manage-create-modal")
        .getByRole("button", { name: /save|rename|submit|ok/i })
        .first()
        .click();
      await page.getByTestId("board-manage-done").click();

      const verifiedLane = page.getByTestId("board-column-verified");
      await expect(verifiedLane).toBeVisible({ timeout: 10_000 });

      const source = page.getByTestId(getBoardCardTestId(project.workspaceId));
      await source.hover();
      await page.mouse.down();
      const targetBox = await verifiedLane.boundingBox();
      const sourceBox = await source.boundingBox();
      if (!targetBox || !sourceBox) {
        throw new Error("Board drag targets were not measurable");
      }
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
        steps: 12,
      });
      await page.mouse.up();

      // The assignment round-trips through the daemon: after a reload the card
      // is still on the lane it was dropped on.
      await page.reload();
      await expect(
        page
          .getByTestId("board-column-verified")
          .getByTestId(getBoardCardTestId(project.workspaceId)),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await project.cleanup();
    }
  });

  test("offers move-to-status from the sidebar workspace menu", async ({ page }) => {
    const project = await seedWorkspace({ repoPrefix: "board-sidebar-menu-" });
    try {
      await gotoAppShell(page);

      const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${project.workspaceId}`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click({ button: "right" });

      const menu = page.getByTestId(
        `sidebar-workspace-context-menu-${getServerId()}:${project.workspaceId}`,
      );
      await expect(menu).toBeVisible();
      await menu.getByText("Move to status").click();
      await expect(page.getByTestId("workspace-status-picker-row-todo")).toBeVisible();
      await page.getByTestId("workspace-status-picker-row-todo").click();

      await page.getByTestId("sidebar-board").click();
      await expect(page).toHaveURL(/\/board/);
      await expect(
        page.getByTestId("board-column-todo").getByTestId(getBoardCardTestId(project.workspaceId)),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await project.cleanup();
    }
  });
});
