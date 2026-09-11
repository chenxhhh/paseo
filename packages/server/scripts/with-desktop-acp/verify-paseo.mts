import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { WithACPAgentClient } from "../../src/server/agent/providers/with-acp-agent.js";
const dir = path.dirname(fileURLToPath(import.meta.url));
for (const key of ["BG_AGENT_TOKEN", "BG_USER_TOKEN", "KNOT_JWT_TOKEN"]) delete process.env[key];
const client = new WithACPAgentClient({
  logger: pino({ level: "error" }),
  command: [process.execPath, path.join(dir, "index.cjs")],
  providerId: "with-desktop",
  providerParams: { supportsMcpServers: false },
});
const catalog = await client.fetchCatalog({ scope: "workspace", cwd: dir, force: true });
const model = catalog.models.find((m) => m.id === "ext-glm-5.3");
assert(model?.thinkingOptions?.some((o) => o.id === "high"));
assert(model.thinkingOptions.some((o) => o.id === "max"));
console.log(
  JSON.stringify({
    phase: "catalog",
    models: catalog.models.length,
    thinking: model.thinkingOptions,
  }),
);
const config = {
  provider: "acp",
  cwd: dir,
  model: "ext-glm-5.3",
  thinkingOptionId: "high",
  modeId: "manual",
  featureValues: { max_context_tokens: "200000" },
};
const features = await client.listFeatures(config);
const context = features.find((f) => f.id === "max_context_tokens");
assert(context?.type === "select" && context.options.some((o) => o.id === "1000000"));
console.log(JSON.stringify({ phase: "features", context }));
const session = await client.createSession(config);
try {
  assert.equal((await session.getRuntimeInfo()).thinkingOptionId, "high");
  assert.equal(session.features?.find((f) => f.id === "max_context_tokens")?.value, "200000");
  if (process.argv.includes("--prompt")) {
    const result = await session.run(
      "Connectivity test. Do not call tools or read/change files. Reply exactly PASEO_WITH_DESKTOP_OK.",
    );
    console.log(JSON.stringify({ phase: "paseo-run", result }));
  }
  console.log(JSON.stringify({ phase: "session-settings", passed: true }));
} finally {
  await session.close();
}
