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

test.describe("Schedules run history", () => {
  const cleanupTasks: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    for (const cleanup of cleanupTasks.toReversed()) {
      await cleanup();
    }
    cleanupTasks.length = 0;
  });

  test("opens run history from the kebab menu and drills into a run", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "schedule-run-history-" });
    cleanupTasks.push(() => workspace.cleanup());
    const fakeHost = await buildFakeScheduleHostWorkspace(workspace);
    const fakePort = String(59_000 + Math.floor(Math.random() * 900));
    const scheduleId = "fake-host-schedule";
    const runId = "fake-host-run-1";
    const runOutput = "Hello from the scheduled agent.";
    const nowIso = "2026-07-01T00:00:00.000Z";

    await installFakeScheduleHost({
      page,
      port: fakePort,
      serverId: fakeHost.serverId,
      workspace: fakeHost.workspace,
      project: fakeHost,
      schedules: [
        {
          id: scheduleId,
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
      runs: {
        [scheduleId]: [
          {
            id: runId,
            scheduledFor: nowIso,
            startedAt: nowIso,
            endedAt: "2026-07-01T00:05:00.000Z",
            status: "succeeded",
            agentId: null,
            workspaceId: null,
            output: runOutput,
            error: null,
          },
        ],
      },
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

    const row = page.getByTestId(`schedule-row-${scheduleId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Open the kebab menu and click "View run history".
    await page.getByTestId(`schedule-kebab-${scheduleId}`).click();
    const runsMenuItem = page.getByTestId(`schedule-menu-runs-${scheduleId}`);
    await expect(runsMenuItem).toBeVisible({ timeout: 10_000 });
    await expectSettled(runsMenuItem);
    await runsMenuItem.click();

    const runsSheet = page.getByTestId("schedule-runs-sheet");
    await expect(runsSheet).toBeVisible({ timeout: 10_000 });
    await expectStableHeight(runsSheet);

    // The seeded run renders as a row.
    const runRow = page.getByTestId(`schedule-run-${runId}`);
    await expect(runRow).toBeVisible({ timeout: 10_000 });
    await expect(runRow).toContainText("Succeeded", { timeout: 10_000 });

    // Drill into the run detail and assert the output.
    await runRow.click();
    await expect(page.getByText(runOutput)).toBeVisible({ timeout: 10_000 });

    // Back returns to the run list.
    await page.getByTestId("sheet-header-back").click();
    await expect(runRow).toBeVisible({ timeout: 10_000 });
  });
});
