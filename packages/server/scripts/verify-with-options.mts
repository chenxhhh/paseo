import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pino from "pino";
import { WithACPAgentClient } from "../src/server/agent/providers/with-acp-agent.js";

for (const key of ["BG_AGENT_TOKEN", "BG_USER_TOKEN", "KNOT_JWT_TOKEN"]) delete process.env[key];
const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".paseo/config.json"), "utf8"));
const provider = config.agents.providers.with;
const client = new WithACPAgentClient({
  logger: pino({ level: "error" }),
  command: provider.command,
  env: provider.env,
});
const cwd = process.cwd();
const started = Date.now();
const catalog = await client.fetchCatalog({ scope: "workspace", cwd, force: true });
const model = catalog.models.find((entry) => entry.id === "gpt-6-astra");
assert(model?.thinkingOptions?.some((option) => option.id === "high"));
console.log(
  JSON.stringify({
    phase: "catalog",
    models: catalog.models.length,
    ms: Date.now() - started,
    thinking: model.thinkingOptions,
  }),
);
const features = await client.listFeatures({ provider: "acp", cwd, model: model.id });
const context = features.find((feature) => feature.id === "max_context_tokens");
assert(context?.type === "select" && context.options.some((option) => option.id === "272000"));
console.log(JSON.stringify({ phase: "features", context }));
const session = await client.createSession({
  provider: "acp",
  cwd,
  model: model.id,
  thinkingOptionId: "high",
  featureValues: { max_context_tokens: "272000" },
});
try {
  assert.equal((await session.getRuntimeInfo()).thinkingOptionId, "high");
  assert.equal(
    session.features?.find((feature) => feature.id === "max_context_tokens")?.value,
    "272000",
  );
  await session.setThinkingOption!("max");
  await session.setFeature!("max_context_tokens", "");
  assert.equal((await session.getRuntimeInfo()).thinkingOptionId, "max");
  assert.equal(session.features?.find((feature) => feature.id === "max_context_tokens")?.value, "");
  console.log(
    JSON.stringify({
      phase: "session",
      configured: "high + 272K",
      updated: "max + Default",
      passed: true,
    }),
  );
} finally {
  await session.close();
}
