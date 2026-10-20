import { afterEach, expect, test, vi } from "vitest";
import { buildProviderRegistry } from "./provider-registry.js";
import { WithACPAgentClient } from "./providers/with-acp-agent.js";
import { createTestLogger } from "../../test-utils/test-logger.js";

afterEach(() => vi.restoreAllMocks());

test("with-metadata preserves official ACP MCP and With option mapping", async () => {
  const logger = createTestLogger();
  const fetch = vi.spyOn(WithACPAgentClient.prototype, "fetchCatalog").mockResolvedValue({
    models: [{ id: "ext-glm-5.3", label: "GLM", thinkingOptions: [{ id: "max", label: "Max" }] }],
    modes: [],
  });
  const registry = buildProviderRegistry(logger, {
    providerOverrides: {
      with: { extends: "acp", label: "With CLI", command: ["node", "cli.cjs"] },
      "with-metadata": {
        extends: "acp",
        label: "Knot ACP metadata",
        command: ["node", "metadata.cjs"],
      },
    },
  });
  const client = registry["with-metadata"].createClient(logger);
  expect(client.provider).toBe("with-metadata");
  expect(client.capabilities.supportsMcpServers).toBe(true);
  expect(
    (await client.fetchCatalog({ scope: "workspace", cwd: process.cwd() })).models[0]
      .thinkingOptions?.[0].id,
  ).toBe("max");
  expect(fetch).toHaveBeenCalled();
  expect(registry.with.createClient(logger).provider).toBe("with");
});
