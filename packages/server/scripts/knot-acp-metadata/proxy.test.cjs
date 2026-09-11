"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { MODEL_PATH, mergeCatalog, startProxy } = require("./proxy.cjs");
const { ProtocolOutput, parseArgs } = require("./index.cjs");
const model = {
  model_name: "ext-glm-5.3",
  is_support_thinking: false,
  max_context_token_list: [200000, 1000000],
  reasoning_effort: [{ name: "high" }, { name: "max", default_option: true }],
};
const catalog = {
  code: 0,
  data: {
    models: [
      { name: "ext-glm-5.3", is_external: true, unknown: 7, infos: { extra: true } },
      { name: "other", infos: { context: [42] } },
    ],
  },
};
const allowedModels = [model.model_name];
test("merge only same-name allowlisted non-thinking models; retain official routing and other models", () => {
  const result = mergeCatalog(
    catalog,
    [model, { ...model, model_name: "desktop-only" }],
    allowedModels,
  );
  assert.equal(result.catalog.data.models.length, 2);
  assert.equal(result.catalog.data.models[0].is_external, true);
  assert.equal(result.catalog.data.models[0].unknown, 7);
  assert.equal(result.catalog.data.models[0].infos.extra, true);
  assert.deepEqual(result.catalog.data.models[0].infos.context, [200000, 1000000]);
  assert.equal(
    result.catalog.data.models[0].infos.modes.non_thinking.reasoning_effort.default,
    "max",
  );
  assert.deepEqual(result.catalog.data.models[1], catalog.data.models[1]);
  assert.equal(catalog.data.models[0].infos.context, undefined);
});
test("unavailable metadata, errors and thinking-enabled models never invent capabilities", () => {
  for (const input of [[], [{ ...model, is_support_thinking: true }]])
    assert.deepEqual(mergeCatalog(catalog, input, allowedModels).catalog, catalog);
  assert.deepEqual(mergeCatalog({ code: 403 }, [model], allowedModels), {
    catalog: { code: 403 },
    patched: [],
  });
  assert.deepEqual(mergeCatalog(catalog, [model], []).catalog, catalog);
});
test("official capability defaults/options preserved while supplementing", () => {
  const original = structuredClone(catalog);
  original.data.models[0].infos = {
    context: [123],
    modes: {
      non_thinking: { reasoning_effort: { default: "low", options: [{ name: "low" }] } },
      thinking: { marker: true },
    },
  };
  const r = mergeCatalog(original, [model], allowedModels).catalog.data.models[0].infos;
  assert.deepEqual(r.context, [123, 200000, 1000000]);
  assert.equal(r.modes.non_thinking.reasoning_effort.default, "low");
  assert.deepEqual(
    r.modes.non_thinking.reasoning_effort.options.map((x) => x.name),
    ["low", "high", "max"],
  );
  assert.equal(r.modes.thinking.marker, true);
});
async function fixture(t, handler, extras = {}) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const proxy = await startProxy({
    upstream: `http://127.0.0.1:${server.address().port}/apigw`,
    desktopModels: [model],
    allowedModels,
    ...extras,
  });
  t.after(async () => {
    await proxy.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  return proxy;
}
test("catalog overlay preserves request path/body/auth; never logs credentials", async (t) => {
  const events = [];
  const proxy = await fixture(
    t,
    (req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        assert.equal(req.url, "/apigw" + MODEL_PATH);
        assert.equal(req.headers.authorization, "Bearer test-only");
        assert.equal(body, '{"platform":"knot"}');
        res.writeHead(200, { "content-type": "application/json", etag: "stale" });
        res.end(JSON.stringify(catalog));
      });
    },
    { onEvent: (e) => events.push(e) },
  );
  const r = await fetch(proxy.url + MODEL_PATH, {
    method: "POST",
    headers: { authorization: "Bearer test-only" },
    body: '{"platform":"knot"}',
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("etag"), null);
  assert.deepEqual((await r.json()).data.models[0].infos.context, [200000, 1000000]);
  assert(!JSON.stringify(events).includes("test-only"));
});
test("non-model reports preserve bytes, status and response headers", async (t) => {
  const reportPath =
    "/trpc.gongfeng.background_agent_manager.BackgroundAgentManagerHttp/api/report";
  const proxy = await fixture(t, (req, res) => {
    assert.equal(req.url, "/apigw" + reportPath);
    req.pipe(res);
    res.statusCode = 202;
    res.setHeader("x-test", "kept");
  });
  const r = await fetch(proxy.url + reportPath, { method: "POST", body: "opaque body" });
  assert.equal(r.status, 202);
  assert.equal(r.headers.get("x-test"), "kept");
  assert.equal(await r.text(), "opaque body");
});
test("forbid missing secret prefix, browsers, foreign paths and GET", async (t) => {
  let called = 0;
  const proxy = await fixture(t, (_, res) => {
    called++;
    res.end();
  });
  const origin = new URL(proxy.url).origin;
  for (const [url, options, status] of [
    [origin + MODEL_PATH, { method: "POST" }, 403],
    [proxy.url + MODEL_PATH, { method: "POST", headers: { origin: "https://example.com" } }, 403],
    [proxy.url + "/other", { method: "POST" }, 404],
    [proxy.url + MODEL_PATH, {}, 404],
  ])
    assert.equal((await fetch(url, options)).status, status);
  assert.equal(called, 0);
});
test("malformed or denied upstream metadata is passed unchanged", async (t) => {
  let count = 0;
  const proxy = await fixture(t, (_, res) => {
    res.statusCode = count++ ? 403 : 200;
    res.end("not json");
  });
  for (const status of [200, 403]) {
    const r = await fetch(proxy.url + MODEL_PATH, { method: "POST" });
    assert.equal(r.status, status);
    assert.equal(await r.text(), "not json");
  }
});
test("upstream timeout returns 502 without retry", async (t) => {
  let calls = 0;
  const proxy = await fixture(
    t,
    () => {
      calls++;
    },
    { timeoutMs: 50 },
  );
  assert.equal((await fetch(proxy.url + MODEL_PATH, { method: "POST" })).status, 502);
  assert.equal(calls, 1);
});
test("ACP compatibility changes only missing select options", async () => {
  const stream = new ProtocolOutput();
  const chunks = [];
  stream.on("data", (c) => chunks.push(c));
  const input = {
    jsonrpc: "2.0",
    id: 3,
    result: { configOptions: [{ type: "select", id: "中文", options: null }], value: 5 },
  };
  const bytes = Buffer.from(JSON.stringify(input) + "\n");
  for (let i = 0; i < bytes.length; i++) stream.write(bytes.subarray(i, i + 1));
  stream.end();
  await once(stream, "end");
  const out = JSON.parse(Buffer.concat(chunks));
  assert.deepEqual(out.result.configOptions[0].options, []);
  assert.equal(out.result.configOptions[0].id, "中文");
  assert.equal(out.result.value, 5);
  assert.throws(() => parseArgs(["--config", "a"]));
});
