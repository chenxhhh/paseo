import { test, expect } from "../support/fixtures";
import type { Locator, Page } from "@playwright/test";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

// The mock provider streams one cycle of: read → grep → (assistant boundary) →
// edit (oldString/newString + unifiedDiff) → shell → (assistant boundary).
// Auto mode keeps narration and thinking visible, hides tool/todo rows behind
// a collapse header under the user bubble, and keeps result cards on the
// completed-turn footer. Expanding the header reveals the balanced process
// rows (noise badges beside Edited/Ran) directly below it.

async function seedFinishedAndOpen(page: Page, storageValue?: string) {
  if (storageValue) {
    await page.addInitScript((value) => {
      localStorage.setItem("@paseo:app-settings", value);
    }, storageValue);
  }
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "tool-call-detail-",
    title: "Tool call detail levels",
    model: "ten-second-stream",
    initialPrompt: "Stream a mixed tool call cycle.",
  });
  try {
    await agent.client.waitForFinish(agent.agentId, 60_000);
  } catch (error) {
    await agent.cleanup();
    throw error;
  }
  await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.agentId });
  await expectComposerVisible(page);
  // Let the retained timeline tail finish mounting before asserting on row shape.
  await page.waitForTimeout(3_000);
  return agent;
}

async function expectLocatorAbove(upper: Locator, lower: Locator) {
  const upperBox = await upper.boundingBox();
  const lowerBox = await lower.boundingBox();
  expect(upperBox).not.toBeNull();
  expect(lowerBox).not.toBeNull();
  expect(upperBox!.y).toBeLessThan(lowerBox!.y);
}

test("auto level collapses a finished turn behind a summary row and file cards", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const agent = await seedFinishedAndOpen(page, JSON.stringify({ toolCallDetailLevel: "auto" }));
  try {
    const header = page.getByTestId("turn-collapse-header");
    await expect(header).toBeVisible({ timeout: 60_000 });
    await expect(header).toContainText("edited 1 file");
    await expect(header).toContainText("+5");
    await expect(header).toContainText("-2");
    await expect(header).toContainText("ran 1 command");

    const closingReply = page.getByText("The change should keep scroll-to-bottom");
    await expect(closingReply).toBeVisible();
    await expect(page.getByText("Cycle 1", { exact: true })).toBeVisible();
    await expectLocatorAbove(header, closingReply);
    await expect(page.getByTestId("balanced-tool-call-group")).toHaveCount(0);
    await expect(page.getByTestId("tool-call-badge")).toHaveCount(0);

    const fileCard = page.getByTestId("turn-result-file-card");
    await expect(fileCard).toBeVisible();
    await expect(fileCard).toContainText("use-scroll-anchor.ts");
    await expect(fileCard.getByTestId("turn-result-file-diff-stat")).toBeVisible();
    await expect(page.getByTestId("turn-result-web-card")).toHaveCount(0);

    await header.click();
    const processGroup = page.getByTestId("balanced-tool-call-group").first();
    await expect(processGroup).toBeVisible({
      timeout: 30_000,
    });
    await expectLocatorAbove(header, processGroup);
    await expect(
      page.getByTestId("tool-call-badge").filter({ hasText: "Edited" }).first(),
    ).toBeVisible({ timeout: 30_000 });

    await header.click();
    await expect(page.getByTestId("balanced-tool-call-group")).toHaveCount(0);
    await expect(page.getByTestId("tool-call-badge")).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});

test("header menu switches between the three detail levels", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await seedFinishedAndOpen(page);
  try {
    await expect(
      page.getByTestId("tool-call-badge").filter({ hasText: "Read" }).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("tool-call-group")).toHaveCount(0);
    await expect(page.getByTestId("turn-collapse-header")).toHaveCount(0);

    await page.getByTestId("tool-call-detail-menu-trigger").click();
    await expect(page.getByTestId("tool-call-detail-menu-detailed")).toBeVisible();
    await expect(page.getByTestId("tool-call-detail-menu-auto")).toBeVisible();
    await expect(page.getByTestId("tool-call-detail-menu-overview")).toBeVisible();

    await page.getByTestId("tool-call-detail-menu-auto").click();
    await expect(page.getByTestId("turn-collapse-header")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("tool-call-detail-menu-trigger").click();
    await page.getByTestId("tool-call-detail-menu-overview").click();
    await expect(page.getByTestId("tool-call-group").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("turn-collapse-header")).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});

test("Ctrl+Alt+D cycles the detail level", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await seedFinishedAndOpen(page);
  try {
    await expect(
      page.getByTestId("tool-call-badge").filter({ hasText: "Read" }).first(),
    ).toBeVisible({ timeout: 60_000 });

    await page.keyboard.press("Control+Alt+d");
    await expect(page.getByTestId("turn-collapse-header")).toBeVisible({ timeout: 30_000 });

    await page.keyboard.press("Control+Alt+d");
    await expect(page.getByTestId("tool-call-group").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("turn-collapse-header")).toHaveCount(0);

    await page.keyboard.press("Control+Alt+d");
    await expect(
      page.getByTestId("tool-call-badge").filter({ hasText: "Read" }).first(),
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await agent.cleanup();
  }
});
