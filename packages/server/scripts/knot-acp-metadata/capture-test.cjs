"use strict";
const http = require("node:http");
const https = require("node:https");
const { randomBytes } = require("node:crypto");
const { pipeline } = require("node:stream");
const { headersWithoutHop } = require("./proxy.cjs");
function extractSettings(value, at = "", result = [], depth = 0) {
  if (depth > 12 || !value || typeof value !== "object") return result;
  for (const [key, v] of Object.entries(value)) {
    const loc = at ? `${at}.${key}` : key;
    if (
      ["model", "model_name", "reasoning_effort", "max_context_tokens", "enable_thinking"].includes(
        key,
      ) &&
      ["string", "number", "boolean"].includes(typeof v) &&
      String(v).length < 120
    )
      result.push({ field: loc, value: v });
    if (key === "chat_extra" && typeof v === "string") {
      try {
        extractSettings(JSON.parse(v), loc, result, depth + 1);
      } catch {}
    } else if (typeof v === "object") extractSettings(v, loc, result, depth + 1);
  }
  return result;
}
async function startCapture(upstream, onEvent) {
  const base = new URL(upstream);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/")
    throw new Error("Capture requires original HTTPS Knot origin");
  const prefix = `/test-${randomBytes(32).toString("hex")}`;
  const active = new Set();
  const server = http.createServer((req, res) => {
    if (
      req.headers.host !== `127.0.0.1:${server.address().port}` ||
      req.headers.origin ||
      !req.url.startsWith(prefix + "/apigw/")
    ) {
      res.writeHead(403);
      res.end();
      req.resume();
      return;
    }
    const route = req.url.slice(prefix.length);
    if (!/^\/apigw\/[A-Za-z0-9_./-]+$/.test(route) || route.includes("..")) {
      res.writeHead(404);
      res.end();
      req.resume();
      return;
    }
    const target = new URL(route, base);
    const outbound = https.request(target, {
      method: req.method,
      headers: headersWithoutHop(req.headers),
    });
    active.add(outbound);
    const timer = setTimeout(() => outbound.destroy(), 180000);
    outbound.on("close", () => {
      clearTimeout(timer);
      active.delete(outbound);
    });
    outbound.on("error", () => {
      onEvent({ type: "capture-upstream-error", route });
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    const chunks = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes <= 16 * 1024 * 1024) chunks.push(chunk);
    });
    req.on("end", () => {
      if (!route.endsWith("/chat")) return;
      try {
        if (bytes > 16 * 1024 * 1024) throw new Error("too large");
        const fields = extractSettings(JSON.parse(Buffer.concat(chunks)));
        onEvent({ type: "chat-request-fields", route, fields });
      } catch {
        onEvent({ type: "chat-fields-unavailable", route });
      }
    });
    req.on("aborted", () => outbound.destroy());
    res.on("close", () => {
      if (!res.writableFinished) outbound.destroy();
    });
    outbound.on("response", (incoming) => {
      onEvent({ type: "capture-response", route, status: incoming.statusCode });
      res.writeHead(incoming.statusCode, headersWithoutHop(incoming.headers));
      pipeline(incoming, res, () => {});
    });
    req.pipe(outbound);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}${prefix}`,
    async close() {
      for (const r of active) r.destroy();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
module.exports = { startCapture, extractSettings };
