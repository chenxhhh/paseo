import { expect, test } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { openSettingsSection } from "../support/helpers/settings";

async function seedFinishedDrawerAgent(title: string) {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "tool-call-drawer-",
    title,
    model: "ten-second-stream",
    initialPrompt: "Stream a realistic drawer turn",
  });
  await agent.client.waitForFinish(agent.agentId, 120_000);
  return agent;
}

/**
 * Deep-linking the workspace route races the SPA's own redirect on this
 * harness; navigating inside the loaded app via the sidebar row instead.
 */
async function openWorkspaceViaSidebar(page: import("@playwright/test").Page, workspaceId: string) {
  await page.goto("/");
  const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expectComposerVisible(page);
}

test("offers and persists the drawer tool call display option", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");

  const trigger = page.getByLabel(/Select tool call display/);
  await expect(trigger).toContainText("Full detail");
  await trigger.click();

  await expect(page.getByRole("menuitem", { name: "Full detail" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Summary" })).toBeVisible();
  const drawerItem = page.getByRole("menuitem", { name: "Drawer" });
  await expect(drawerItem).toBeVisible();
  await drawerItem.click();

  await expect(trigger).toContainText("Drawer");

  await page.reload();
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");
  await expect(page.getByLabel(/Select tool call display/)).toContainText("Drawer");
});

test("collapses adjacent thinking and tool calls into single drawer lines", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const agent = await seedFinishedDrawerAgent("Drawer collapsed timeline");
  try {
    await page.addInitScript(() => {
      localStorage.setItem(
        "@paseo:app-settings",
        JSON.stringify({ toolCallDetailLevel: "drawer" }),
      );
    });
    await openWorkspaceViaSidebar(page, agent.workspaceId);

    const groups = page.getByTestId("tool-call-group");
    await expect.poll(async () => groups.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

    // Cycle shape: assistant intro, then thinking + read + grep, assistant mid,
    // edit + bash, assistant closing. Drawer folds each stretch into one line.
    const firstGroup = groups.nth(0);
    await expect(firstGroup).toContainText("Thought 1 time");
    await expect(firstGroup).toContainText("read 1 file");
    await expect(firstGroup).toContainText("searched 1 time");

    const editRunGroups = groups.filter({ hasText: "ran 1 command" });
    await expect
      .poll(async () => editRunGroups.count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);
    await expect(editRunGroups.first()).toContainText("Edited 1 file");

    // Thinking is folded into the group summary, not rendered as its own badge.
    await expect(page.getByRole("button", { name: "Thinking" })).toHaveCount(0);

    await page.screenshot({ path: testInfo.outputPath("drawer-collapsed.png"), fullPage: true });
  } finally {
    await agent.cleanup();
  }
});

test("expands a drawer group into thinking and tool call children", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const agent = await seedFinishedDrawerAgent("Drawer expanded timeline");
  try {
    await page.addInitScript(() => {
      localStorage.setItem(
        "@paseo:app-settings",
        JSON.stringify({ toolCallDetailLevel: "drawer" }),
      );
    });
    await openWorkspaceViaSidebar(page, agent.workspaceId);

    const firstGroup = page.getByTestId("tool-call-group").first();
    await expect(firstGroup).toBeVisible({ timeout: 30_000 });
    await firstGroup.click();

    const expandedBadges = firstGroup.getByTestId("tool-call-badge");
    await expect(expandedBadges).toHaveCount(3, { timeout: 10_000 });
    await expect(firstGroup.getByRole("button", { name: "Thinking" })).toBeVisible();
    await expect(firstGroup.getByRole("button", { name: /^Read/ })).toBeVisible();
    await expect(firstGroup.getByRole("button", { name: /^Search/ })).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath("drawer-expanded.png"), fullPage: true });
  } finally {
    await agent.cleanup();
  }
});

test("keeps thinking outside the group in overview mode", async ({ page }) => {
  test.setTimeout(180_000);
  const agent = await seedFinishedDrawerAgent("Overview contrast timeline");
  try {
    await page.addInitScript(() => {
      localStorage.setItem(
        "@paseo:app-settings",
        JSON.stringify({ toolCallDetailLevel: "overview" }),
      );
    });
    await openWorkspaceViaSidebar(page, agent.workspaceId);

    const groups = page.getByTestId("tool-call-group");
    await expect.poll(async () => groups.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    await expect(groups.nth(0)).not.toContainText("Thought");
    await expect
      .poll(async () => page.getByRole("button", { name: "Thinking" }).count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);
  } finally {
    await agent.cleanup();
  }
});
