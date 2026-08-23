import { expect, test } from "../support/fixtures";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import { expectComposerVisible, submitMessage } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test.describe("Turn artifacts", () => {
  test("shows artifact chip, change stats, and rewind entry for a write turn", async ({ page }) => {
    test.setTimeout(120_000);
    const prompt = "emit a synthetic artifact write reports/demo.docx with 120 lines";
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "turn-artifacts-",
      title: "Turn artifacts",
      model: "ten-second-stream",
    });

    try {
      await openAgentRoute(page, agent);
      await expectComposerVisible(page);

      await submitMessage(page, prompt);
      await expect(page.getByTestId("user-message").filter({ hasText: prompt })).toBeVisible();

      const finish = await agent.client.waitForFinish(agent.agentId, 30_000);
      expect(finish.status).toBe("idle");
      await expectAgentIdle(page);

      const chip = page.getByTestId("turn-artifact-chip");
      await expect(chip).toBeVisible();
      await expect(chip.getByText("demo.docx", { exact: true })).toBeVisible();
      await expect(chip.getByText("DOCX", { exact: true })).toBeVisible();

      await expect(page.getByTestId("turn-artifact-stats")).toBeVisible();
      await expect(page.getByTestId("turn-artifact-stats")).toContainText("+120");
      await expect(page.getByTestId("turn-artifact-stats-label")).toContainText(/1 file changed/i);

      await expect(
        page.getByTestId("turn-artifacts").getByRole("button", { name: "Rewind to this message" }),
      ).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });
});
