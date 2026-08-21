import { test, expect } from "../support/fixtures";
import type { Locator, Page } from "@playwright/test";
import { openSettings } from "../support/helpers/app";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { clickSettingsBackToWorkspace, openSettingsSection } from "../support/helpers/settings";

// The mock provider streams one cycle of: intro assistant → reasoning → read →
// grep → mid assistant ("Cycle 1") → edit (oldString/newString + unifiedDiff) →
// shell → closing assistant. Drawer mode keeps the user bubble, collapse
// header, closing reply, and result cards; everything else (thinking, mid
// narration, tools) goes in the drawer until the header is expanded.

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
    await expect(header).toContainText("Worked for");
    await expect(header).toContainText("edited 1 file");
    await expect(header).toContainText("+5");
    await expect(header).toContainText("-2");
    await expect(header).toContainText("ran 1 command");

    const closingReply = page.getByText("The change should keep scroll-to-bottom");
    await expect(closingReply).toBeVisible();
    await expect(page.getByText("Cycle 1", { exact: true })).toHaveCount(0);
    await expectLocatorAbove(header, closingReply);
    await expect(page.getByTestId("balanced-tool-call-group")).toHaveCount(0);
    for (const verb of ["Read", "Grep", "Edited", "Ran", "Thinking"]) {
      await expect(page.getByTestId("tool-call-badge").filter({ hasText: verb })).toHaveCount(0);
    }

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
    await expect(page.getByTestId("tool-call-badge").filter({ hasText: "Edited" })).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});

test("appearance settings switch the timeline onto the drawer level", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await seedFinishedAndOpen(page);
  try {
    await expect(
      page.getByTestId("tool-call-badge").filter({ hasText: "Read" }).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("turn-collapse-header")).toHaveCount(0);

    await openSettings(page);
    await openSettingsSection(page, "appearance");
    await page.getByLabel("Select tool call display (Full detail)").click();
    await page.getByRole("menuitem", { name: "Drawer", exact: true }).click();
    await clickSettingsBackToWorkspace(page);
    await expectComposerVisible(page);

    await expect(page.getByTestId("turn-collapse-header")).toBeVisible({ timeout: 30_000 });
  } finally {
    await agent.cleanup();
  }
});
