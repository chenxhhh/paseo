import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { WithACPAgentClient } from "../../src/server/agent/providers/with-acp-agent.js";
const dir = path.dirname(fileURLToPath(import.meta.url));
const [cli, source, cwd, output] = process.argv.slice(2);
if (!cli || !source || !cwd || !output) throw new Error("Expected CLI CONFIG TEST_DIR REPORT");
fs.mkdirSync(cwd, { recursive: true });
for (const key of [
  "BG_AGENT_TOKEN",
  "BG_USER_TOKEN",
  "KNOT_JWT_TOKEN",
  "KNOT_METADATA_CAPTURE_TEST",
])
  delete process.env[key];
const report: Record<string, unknown> = { started: new Date().toISOString() };
const client = new WithACPAgentClient({
  logger: pino({ level: "silent" }),
  command: [
    process.execPath,
    path.join(dir, "index.cjs"),
    "--cli",
    path.resolve(cli),
    "--config",
    path.resolve(source),
    "--runtime-root",
    path.resolve(cwd),
  ],
  providerId: "with",
});
try {
  const catalog = await client.fetchCatalog({ scope: "workspace", cwd, force: true });
  const model = catalog.models.find((m) => m.id === "ext-glm-5.3");
  assert(model?.thinkingOptions?.some((o) => o.id === "high"));
  assert(model.thinkingOptions.some((o) => o.id === "max"));
  report.modelCount = catalog.models.length;
  report.thinkingOptions = model.thinkingOptions;
  const config = {
    provider: "acp" as const,
    cwd,
    model: "ext-glm-5.3",
    thinkingOptionId: "high",
    modeId: "manual",
    featureValues: { max_context_tokens: "200000" },
  };
  const features = await client.listFeatures(config);
  const context = features.find((f) => f.id === "max_context_tokens");
  assert(context?.type === "select" && context.options.some((o) => o.id === "1000000"));
  report.context = context;
  const session = await client.createSession(config);
  try {
    assert.equal((await session.getRuntimeInfo()).thinkingOptionId, "high");
    assert.equal(session.features?.find((f) => f.id === "max_context_tokens")?.value, "200000");
    report.result = await session.run(
      "Connectivity test only. Do not call tools or read/change files. Reply exactly PASEO_ROUTE_A_OK.",
    );
    report.passed = true;
  } finally {
    await session.close();
  }
} catch (e) {
  report.error = e instanceof Error ? e.message : String(e);
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
