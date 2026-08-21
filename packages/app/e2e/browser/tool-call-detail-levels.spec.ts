import { test, expect } from "../support/fixtures";
import type { Page } from "@playwright/test";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

// The mock provider streams one cycle of: read → grep → (assistant boundary) →
// edit (oldString/newString + unifiedDiff) → shell → (assistant boundary).
// Auto mode collapses the finished response to the prompt, the closing reply,
// a Worked-for summary row, and result cards. Expanding the summary reveals
// the balanced process rows (noise badges beside Edited/Ran).

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

test("auto level collapses a finished turn behind a summary row and file cards", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const agent = await seedFinishedAndOpen(page, JSON.stringify({ toolCallDetailLevel: "auto" }));
  try {
    const summary = page.getByTestId("turn-summary-row");
    await expect(summary).toBeVisible({ timeout: 60_000 });
    await expect(summary).toContainText("Worked for");

    await expect(page.getByText("The change should keep scroll-to-bottom")).toBeVisible();
    await expect(page.getByText("Cycle 1", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("balanced-tool-call-group")).toHaveCount(0);
    await expect(page.getByTestId("tool-call-badge")).toHaveCount(0);

    const fileCard = page.getByTestId("turn-result-file-card");
    await expect(fileCard).toBeVisible();
    await expect(fileCard).toContainText("use-scroll-anchor.ts");
    await expect(fileCard.getByTestId("turn-result-file-diff-stat")).toBeVisible();
    await expect(page.getByTestId("turn-result-web-card")).toHaveCount(0);

    await summary.click();
    await expect(page.getByTestId("balanced-tool-call-group").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByTestId("tool-call-badge").filter({ hasText: "Edited" }).first(),
    ).toBeVisible({ timeout: 30_000 });

    await summary.click();
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
    await expect(page.getByTestId("turn-summary-row")).toHaveCount(0);

    await page.getByTestId("tool-call-detail-menu-trigger").click();
    await expect(page.getByTestId("tool-call-detail-menu-detailed")).toBeVisible();
    await expect(page.getByTestId("tool-call-detail-menu-auto")).toBeVisible();
    await expect(page.getByTestId("tool-call-detail-menu-overview")).toBeVisible();

    await page.getByTestId("tool-call-detail-menu-auto").click();
    await expect(page.getByTestId("turn-summary-row")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("tool-call-detail-menu-trigger").click();
    await page.getByTestId("tool-call-detail-menu-overview").click();
    await expect(page.getByTestId("tool-call-group").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("turn-summary-row")).toHaveCount(0);
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
    await expect(page.getByTestId("turn-summary-row")).toBeVisible({ timeout: 30_000 });

    await page.keyboard.press("Control+Alt+d");
    await expect(page.getByTestId("tool-call-group").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("turn-summary-row")).toHaveCount(0);

    await page.keyboard.press("Control+Alt+d");
    await expect(
      page.getByTestId("tool-call-badge").filter({ hasText: "Read" }).first(),
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await agent.cleanup();
  }
});
