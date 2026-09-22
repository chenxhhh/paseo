import { afterEach, expect, test, vi } from "vitest";
import { buildProviderRegistry } from "./provider-registry.js";
import { WithACPAgentClient } from "./providers/with-acp-agent.js";
import { createTestLogger } from "../../test-utils/test-logger.js";

afterEach(() => vi.restoreAllMocks());

test("with-desktop uses With model capability mapping without replacing with CLI", async () => {
  const logger = createTestLogger();
  const fetch = vi.spyOn(WithACPAgentClient.prototype, "fetchCatalog").mockResolvedValue({
    models: [{ id: "ext-glm-5.3", label: "GLM", thinkingOptions: [{ id: "max", label: "Max" }] }],
    modes: [],
  });
  const registry = buildProviderRegistry(logger, {
    providerOverrides: {
      with: { extends: "acp", label: "With CLI", command: ["node", "cli.cjs"] },
      "with-desktop": {
        extends: "acp",
        label: "With Desktop",
        command: ["node", "desktop.cjs"],
        params: { supportsMcpServers: false },
      },
    },
  });
  const desktop = registry["with-desktop"].createClient(logger);
  expect(desktop.provider).toBe("with-desktop");
  expect(desktop.capabilities.supportsMcpServers).toBe(false);
  const catalog = await desktop.fetchCatalog({ scope: "workspace", cwd: process.cwd() });
  expect(catalog.models[0].thinkingOptions?.[0].id).toBe("max");
  expect(fetch).toHaveBeenCalled();
  expect(registry.with.createClient(logger).provider).toBe("with");
});
