import { test, expect } from "../support/fixtures";
import type { Page } from "@playwright/test";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

// The mock provider streams one cycle of: read → grep → (assistant boundary) →
// edit (oldString/newString + unifiedDiff) → shell → (assistant boundary).
// In balanced mode that renders as one noise badge (read+grep) beside individual
// signal rows (Edited with a diff-stat chip, Ran).

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

test("auto level folds noise into badges beside signal rows", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await seedFinishedAndOpen(page, JSON.stringify({ toolCallDetailLevel: "auto" }));
  try {
    const noiseBadge = page.getByTestId("balanced-tool-call-group").first();
    await expect(noiseBadge).toBeVisible({ timeout: 60_000 });
    await expect(noiseBadge).toContainText("Read 1 file");
    await expect(noiseBadge).toContainText("searched 1 time");

    const editedRow = page.getByTestId("tool-call-badge").filter({ hasText: "Edited" }).first();
    await expect(editedRow).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId("tool-call-badge").filter({ hasText: "Ran" }).first(),
    ).toBeVisible({
      timeout: 30_000,
    });

    await expect(editedRow.getByTestId("tool-call-diff-stat")).toBeVisible();
  } finally {
    await agent.cleanup();
  }
});

test("header menu switches between the three detail levels", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await seedFinishedAndOpen(page);
  try {
    // Default level is detailed: every call is its own row, no badges.
    await expect(
      page.getByTestId("tool-call-badge").filter({ hasText: "Read" }).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("tool-call-group")).toHaveCount(0);
    await expect(page.getByTestId("balanced-tool-call-group")).toHaveCount(0);

    await page.getByTestId("tool-call-detail-menu-trigger").click();
    await page.getByTestId("tool-call-detail-menu-auto").click();
    await expect(page.getByTestId("balanced-tool-call-group").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByTestId("tool-call-badge").filter({ hasText: "Edited" }).first(),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("tool-call-detail-menu-trigger").click();
    await page.getByTestId("tool-call-detail-menu-overview").click();
    await expect(page.getByTestId("tool-call-group").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("balanced-tool-call-group")).toHaveCount(0);
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
    await expect(page.getByTestId("balanced-tool-call-group").first()).toBeVisible({
      timeout: 30_000,
    });

    await page.keyboard.press("Control+Alt+d");
    await expect(page.getByTestId("tool-call-group").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("balanced-tool-call-group")).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});
