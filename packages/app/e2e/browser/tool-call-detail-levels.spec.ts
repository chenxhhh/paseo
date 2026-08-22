import { test, expect } from "../support/fixtures";
import type { Locator, Page } from "@playwright/test";
import { openSettings } from "../support/helpers/app";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { clickSettingsBackToWorkspace, openSettingsSection } from "../support/helpers/settings";

// The mock provider streams one cycle of: intro assistant → reasoning → read →
// grep → mid assistant ("Cycle 1") → edit (oldString/newString + unifiedDiff) →
// shell → closing assistant. Drawer mode renders the full timeline and folds
// consecutive tools/thoughts into process-run rows. Expanding a run reveals
// today's per-call badges. Result cards and the Worked-for footer stay.

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

test("drawer level folds process runs on a full finished timeline", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await seedFinishedAndOpen(page, JSON.stringify({ toolCallDetailLevel: "auto" }));
  try {
    await expect(page.getByTestId("turn-collapse-header")).toHaveCount(0);

    const runRow = page.getByTestId("process-run-row").first();
    await expect(runRow).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("tool-call-badge")).toHaveCount(0);
    await expect(page.getByTestId("balanced-tool-call-group")).toHaveCount(0);
    for (const verb of ["Read", "Grep", "Edited", "Ran", "Thinking"]) {
      await expect(page.getByTestId("tool-call-badge").filter({ hasText: verb })).toHaveCount(0);
    }

    // The mock streams: intro ("## Cycle 1") → run 1 (thought/read/grep) →
    // mid narration ("Now I have a clearer picture…") → run 2 (edit/shell) →
    // closing reply. Assert the mid narration sits between the two runs.
    const narration = page.getByText("Now I have a clearer picture");
    const closingReply = page.getByText("The change should keep scroll-to-bottom");
    await expect(narration).toBeVisible();
    await expect(closingReply).toBeVisible();
    await expectLocatorAbove(runRow, narration);
    await expectLocatorAbove(narration, page.getByTestId("process-run-row").nth(1));
    await expectLocatorAbove(narration, closingReply);

    const fileCard = page.getByTestId("turn-result-file-card");
    await expect(fileCard).toBeVisible();
    await expect(fileCard).toContainText("use-scroll-anchor.ts");
    await expect(fileCard.getByTestId("turn-result-file-diff-stat")).toBeVisible();
    await expect(page.getByTestId("turn-result-web-card")).toHaveCount(0);
    await expect(page.getByText(/Worked for/).first()).toBeVisible();

    await runRow.click();
    // Expansion reveals the run at the drawer level's inner detail tier: the
    // Thinking badge plus the folded read/grep group chip. Per-call badges only
    // appear once that group itself expands (or at the full-detail level).
    await expect(
      page.getByTestId("tool-call-badge").filter({ hasText: "Thinking" }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("balanced-tool-call-group").first()).toBeVisible();

    await runRow.click();
    await expect(page.getByTestId("tool-call-badge")).toHaveCount(0);
    await expect(page.getByTestId("balanced-tool-call-group")).toHaveCount(0);
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
    await expect(page.getByTestId("process-run-row")).toHaveCount(0);
    await expect(page.getByTestId("turn-collapse-header")).toHaveCount(0);

    await openSettings(page);
    await openSettingsSection(page, "appearance");
    await page.getByLabel("Select tool call display (Full detail)").click();
    await page.getByRole("menuitem", { name: "Drawer", exact: true }).click();
    await clickSettingsBackToWorkspace(page);
    await expectComposerVisible(page);

    await expect(page.getByTestId("process-run-row").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("turn-collapse-header")).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});
