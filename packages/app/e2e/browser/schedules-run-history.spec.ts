import { type Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  addFakeScheduleHostAndReload,
  buildFakeScheduleHostWorkspace,
  FAKE_HOST_MODEL_ID,
  installFakeScheduleHost,
} from "../support/helpers/schedule-fake-host";
import { seedWorkspace } from "../support/helpers/seed-client";
import { expectSettled, expectStableHeight } from "../support/helpers/settled";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { buildSchedulesRoute } from "../../src/utils/host-routes";
import type { ScheduleRun } from "@getpaseo/protocol/schedule/types";

test.describe("Schedules run history", () => {
  const cleanupTasks: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    for (const cleanup of cleanupTasks.toReversed()) {
      await cleanup();
    }
    cleanupTasks.length = 0;
  });

  async function setupScheduleHost(options: {
    page: Page;
    scheduleId: string;
    runs: ScheduleRun[];
  }): Promise<void> {
    const { page } = options;
    const workspace = await seedWorkspace({ repoPrefix: "schedule-run-history-" });
    cleanupTasks.push(() => workspace.cleanup());
    const fakeHost = await buildFakeScheduleHostWorkspace(workspace);
    const fakePort = String(59_000 + Math.floor(Math.random() * 900));
    const nowIso = new Date().toISOString();

    await installFakeScheduleHost({
      page,
      port: fakePort,
      serverId: fakeHost.serverId,
      workspace: fakeHost.workspace,
      project: fakeHost,
      // Inline so the literal stays contextually typed for FakeScheduleSummary.
      schedules: [
        {
          id: options.scheduleId,
          name: "Run history schedule",
          prompt: "Run on the secondary host.",
          cadence: { type: "cron", expression: "0 9 * * *" },
          target: {
            type: "new-agent",
            config: {
              provider: "mock",
              cwd: String(fakeHost.workspace.workspaceDirectory),
              model: FAKE_HOST_MODEL_ID,
              modeId: "load-test",
              title: "Run history schedule",
            },
          },
          status: "active",
          createdAt: nowIso,
          updatedAt: nowIso,
          nextRunAt: nowIso,
          lastRunAt: nowIso,
          pausedAt: null,
          expiresAt: null,
          maxRuns: null,
        },
      ],
      runs: { [options.scheduleId]: options.runs },
    });

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.goto(buildSchedulesRoute());
    await addFakeScheduleHostAndReload({
      page,
      serverId: fakeHost.serverId,
      label: "Fake host",
      port: fakePort,
    });
    await page.reload();

    const row = page.getByTestId(`schedule-row-${options.scheduleId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
  }

  test("opens run history via the hover shortcut, filters, and drills into a run", async ({
    page,
  }) => {
    const scheduleId = "fake-host-schedule";
    const succeededRunId = "fake-host-run-1";
    const failedRunId = "fake-host-run-2";
    const succeededOutput = "Hello from the scheduled agent.";
    const now = Date.now();
    // Both runs land in "Today"; the failed one is older so the list renders
    // newest-first with the succeeded run on top.
    const runs: ScheduleRun[] = [
      {
        id: succeededRunId,
        scheduledFor: new Date(now - 40_000).toISOString(),
        startedAt: new Date(now - 30_000).toISOString(),
        endedAt: new Date(now - 25_000).toISOString(),
        status: "succeeded",
        agentId: null,
        workspaceId: null,
        output: succeededOutput,
        error: null,
      },
      {
        id: failedRunId,
        scheduledFor: new Date(now - 7_200_000).toISOString(),
        startedAt: new Date(now - 7_200_000).toISOString(),
        endedAt: new Date(now - 7_140_000).toISOString(),
        status: "failed",
        agentId: null,
        workspaceId: null,
        output: null,
        error: "Scheduled agent failed",
      },
    ];

    await setupScheduleHost({ page, scheduleId, runs });

    // Hovering the schedule row reveals the desktop history shortcut; clicking
    // it opens the sheet directly without going through the kebab menu.
    const row = page.getByTestId(`schedule-row-${scheduleId}`);
    await row.hover();
    const historyShortcut = page.getByTestId(`schedule-row-history-${scheduleId}`);
    await expect(historyShortcut).toBeVisible({ timeout: 10_000 });
    await historyShortcut.click();

    const runsSheet = page.getByTestId("schedule-runs-sheet");
    await expect(runsSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(runsSheet);

    // Both runs render under a Today group header.
    const succeededRow = page.getByTestId(`schedule-run-${succeededRunId}`);
    const failedRow = page.getByTestId(`schedule-run-${failedRunId}`);
    await expect(succeededRow).toBeVisible({ timeout: 10_000 });
    await expect(failedRow).toBeVisible();
    await expect(runsSheet.getByText("Today")).toBeVisible();

    // The status filter narrows the list to failed runs only.
    await page
      .getByTestId("schedule-runs-filter")
      .getByTestId("schedule-runs-filter-failed")
      .click();
    await expect(failedRow).toBeVisible();
    await expect(succeededRow).toBeHidden();
    await expect(failedRow).toContainText("Scheduled agent failed");

    // ...and back to the full list.
    await page.getByTestId("schedule-runs-filter").getByTestId("schedule-runs-filter-all").click();
    await expect(succeededRow).toBeVisible();
    await expect(failedRow).toBeVisible();

    // Drill into the succeeded run: metadata card + output + copy action.
    await succeededRow.click();
    const metaCard = page.getByTestId("schedule-run-detail-meta");
    await expect(metaCard).toBeVisible({ timeout: 10_000 });
    await expect(metaCard).toContainText("Succeeded");
    await expect(metaCard).toContainText("Started");
    await expect(page.getByText(succeededOutput)).toBeVisible();
    await expect(page.getByTestId("schedule-runs-copy")).toBeVisible();
    await expect(page.getByTestId("schedule-runs-copy")).toBeEnabled();

    // Back returns to the run list.
    await page.getByTestId("sheet-header-back").click();
    await expect(succeededRow).toBeVisible({ timeout: 10_000 });
  });

  test("shows an empty state with a run-now call to action", async ({ page }) => {
    const scheduleId = "fake-host-schedule-empty";

    await setupScheduleHost({ page, scheduleId, runs: [] });

    await page.getByTestId(`schedule-kebab-${scheduleId}`).click();
    const runsMenuItem = page.getByTestId(`schedule-menu-runs-${scheduleId}`);
    await expect(runsMenuItem).toBeVisible({ timeout: 10_000 });
    await expectSettled(runsMenuItem);
    await runsMenuItem.click();

    const runsSheet = page.getByTestId("schedule-runs-sheet");
    await expect(runsSheet).toBeVisible({ timeout: 10_000 });
    await expect(runsSheet.getByText("No runs yet")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("schedule-runs-empty-run-now")).toBeVisible();
  });
});
