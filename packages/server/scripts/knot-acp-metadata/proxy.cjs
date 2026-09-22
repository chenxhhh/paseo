"use strict";
const http = require("node:http");
const https = require("node:https");
const { randomBytes } = require("node:crypto");
const { pipeline } = require("node:stream");
const MODEL_PATH =
  "/trpc.gongfeng.background_agent_manager.BackgroundAgentManager/GetAvailableModels";
const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);
function headersWithoutHop(headers) {
  const excluded = new Set([
    ...HOP,
    ...String(headers.connection || "")
      .toLowerCase()
      .split(",")
      .map((x) => x.trim()),
  ]);
  return Object.fromEntries(
    Object.entries(headers).filter(([k]) => !excluded.has(k.toLowerCase())),
  );
}
function mergeCatalog(catalog, desktopModels, allowedModels) {
  if (catalog?.code !== 0 || !Array.isArray(catalog?.data?.models)) return { catalog, patched: [] };
  const copy = structuredClone(catalog);
  const desktop = new Map(desktopModels.map((m) => [m.model_name, m]));
  const allowed = new Set(allowedModels);
  const patched = [];
  for (const m of copy.data.models) {
    const d = desktop.get(m.name);
    // Thinking-enabled metadata has not been mapped/verified. Never invent model IDs or routing flags.
    if (!allowed.has(m.name) || !d || d.is_support_thinking !== false) continue;
    const contexts = Array.isArray(d.max_context_token_list)
      ? d.max_context_token_list.filter((n) => Number.isSafeInteger(n) && n > 0)
      : [];
    const options = Array.isArray(d.reasoning_effort)
      ? d.reasoning_effort.filter(
          (e) => e && typeof e.name === "string" && /^[a-z0-9_-]{1,64}$/i.test(e.name),
        )
      : [];
    if (!contexts.length && !options.length) continue;
    m.infos ||= {};
    if (contexts.length)
      m.infos.context = [
        ...new Set([...(Array.isArray(m.infos.context) ? m.infos.context : []), ...contexts]),
      ];
    if (options.length) {
      m.infos.modes ||= {};
      m.infos.modes.non_thinking ||= {};
      const old = m.infos.modes.non_thinking.reasoning_effort || {};
      const merged = new Map(
        (Array.isArray(old.options) ? old.options : []).map((o) => [o.name, o]),
      );
      for (const o of options)
        if (!merged.has(o.name))
          merged.set(o.name, {
            name: o.name,
            display_name: o.display_name || o.name,
            tip: o.tip || "",
          });
      m.infos.modes.non_thinking.reasoning_effort = {
        ...old,
        default: old.default || options.find((o) => o.default_option)?.name || "",
        options: [...merged.values()],
      };
    }
    patched.push(m.name);
  }
  return { catalog: copy, patched };
}
async function startProxy({
  upstream,
  desktopModels,
  allowedModels,
  onEvent = () => {},
  timeoutMs = 120000,
  maxCatalogBytes = 4 * 1024 * 1024,
}) {
  const base = new URL(upstream);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Unsupported manager URL");
  const key = randomBytes(32).toString("hex");
  const prefix = `/local-${key}`;
  const active = new Set();
  const emit = (e) => {
    try {
      onEvent(e);
    } catch {}
  };
  const server = http.createServer((req, res) => {
    const expectedHost = `127.0.0.1:${server.address().port}`;
    if (
      req.headers.host !== expectedHost ||
      req.headers.origin ||
      req.headers["sec-fetch-site"] ||
      !req.url.startsWith(prefix + "/")
    ) {
      res.writeHead(403);
      res.end();
      req.resume();
      return;
    }
    const route = req.url.slice(prefix.length);
    // Accept only observed manager namespaces, never absolute URLs, traversal or another upstream.
    const knownRoute =
      /^\/trpc\.gongfeng\.background_agent_manager\.BackgroundAgentManager\/[A-Za-z0-9_]+$/.test(
        route,
      ) ||
      route === "/trpc.gongfeng.background_agent_manager.BackgroundAgentManagerHttp/api/report";
    if (!knownRoute || req.method !== "POST") {
      emit({ type: "route-rejected" });
      res.writeHead(404);
      res.end();
      req.resume();
      return;
    }
    const isCatalog = route === MODEL_PATH;
    const target = new URL(base);
    target.pathname = base.pathname.replace(/\/$/, "") + route;
    const headers = headersWithoutHop(req.headers);
    if (isCatalog) headers["accept-encoding"] = "identity";
    const outbound = (target.protocol === "https:" ? https : http).request(target, {
      method: req.method,
      headers,
    });
    active.add(outbound);
    let status;
    const timer = setTimeout(() => outbound.destroy(new Error("Upstream timeout")), timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      active.delete(outbound);
    };
    outbound.once("close", finish);
    outbound.on("error", () => {
      emit({ type: "upstream-error", route, status });
      if (!res.headersSent) {
        res.writeHead(502);
        res.end("Manager upstream unavailable");
      } else res.destroy();
    });
    req.once("aborted", () => outbound.destroy());
    res.once("close", () => {
      if (!res.writableFinished) outbound.destroy();
    });
    outbound.once("response", (incoming) => {
      status = incoming.statusCode;
      emit({ type: "request", route, status });
      const responseHeaders = headersWithoutHop(incoming.headers);
      if (
        !isCatalog ||
        status !== 200 ||
        (incoming.headers["content-encoding"] &&
          incoming.headers["content-encoding"] !== "identity")
      ) {
        res.writeHead(status, responseHeaders);
        pipeline(incoming, res, () => {});
        return;
      }
      const chunks = [];
      let bytes = 0;
      incoming.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxCatalogBytes) {
          incoming.destroy();
          outbound.destroy(new Error("Catalog too large"));
        } else chunks.push(chunk);
      });
      incoming.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      incoming.once("end", () => {
        let body = Buffer.concat(chunks);
        try {
          const result = mergeCatalog(JSON.parse(body), desktopModels, allowedModels);
          if (result.patched.length) {
            body = Buffer.from(JSON.stringify(result.catalog));
            for (const h of [
              "content-length",
              "content-encoding",
              "etag",
              "content-md5",
              "digest",
              "last-modified",
            ])
              delete responseHeaders[h];
            responseHeaders["cache-control"] = "no-store";
            emit({ type: "catalog", patched: result.patched });
          }
        } catch {
          emit({ type: "catalog-unmodified" });
        }
        responseHeaders["content-length"] = String(body.length);
        res.writeHead(status, responseHeaders);
        res.end(body);
      });
    });
    req.pipe(outbound);
  });
  server.requestTimeout = timeoutMs;
  server.headersTimeout = Math.min(timeoutMs, 15000);
  server.on("clientError", (_, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}${prefix}`,
    close: async () => {
      for (const request of active) request.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
module.exports = { MODEL_PATH, mergeCatalog, startProxy, headersWithoutHop };
