#!/usr/bin/env node
"use strict";
if (process.argv.includes("--version")) {
  console.log("with-desktop-acp 0.1.0");
  process.exit(0);
}
const readline = require("node:readline");
const { Bridge, StateStore } = require("./bridge.cjs");
let seq = 0,
  closing = false;
const pending = new Map();
const write = (message) => {
  if (!process.stdout.destroyed)
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
};
const bridge = new Bridge({
  store: new StateStore(process.env.WITH_DESKTOP_STATE_DIR),
  notify: (method, params) => {
    if (method === "_with/turn_finished") {
      for (const [id, p] of pending)
        if (p.sessionId === params.sessionId) {
          clearTimeout(p.timer);
          pending.delete(id);
          p.resolve({ outcome: { outcome: "cancelled" } });
        }
    } else write({ method, params });
  },
  requestClient: (method, params) =>
    new Promise((resolve) => {
      const id = `desktop-permission-${++seq}`;
      const timer = setTimeout(
        () => {
          pending.delete(id);
          resolve({ outcome: { outcome: "cancelled" } });
        },
        5 * 60 * 1000,
      );
      pending.set(id, { resolve, timer, sessionId: params.sessionId });
      write({ id, method, params });
    }),
});
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (closing) return;
  if (line.length > 32 * 1024 * 1024) {
    write({ id: null, error: { code: -32600, message: "Frame exceeds 32 MiB" } });
    return;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    write({ id: null, error: { code: -32700, message: "Invalid JSON" } });
    return;
  }
  if (!message || message.jsonrpc !== "2.0" || Array.isArray(message)) {
    write({ id: message?.id ?? null, error: { code: -32600, message: "Invalid JSON-RPC frame" } });
    return;
  }
  if (!message.method && pending.has(message.id)) {
    const p = pending.get(message.id);
    clearTimeout(p.timer);
    pending.delete(message.id);
    p.resolve(message.result || { outcome: { outcome: "cancelled" } });
    return;
  }
  if (typeof message.method !== "string") return;
  Promise.resolve()
    .then(() => bridge.dispatch(message.method, message.params))
    .then(
      (result) => {
        if (message.id !== undefined) write({ id: message.id, result });
      },
      (error) => {
        if (message.id !== undefined)
          write({ id: message.id, error: { code: error.code || -32603, message: error.message } });
        else process.stderr.write(`[with-desktop-acp] ${error.message}\n`);
      },
    );
});
async function close() {
  if (closing) return;
  closing = true;
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.resolve({ outcome: { outcome: "cancelled" } });
  }
  pending.clear();
  const timeout = setTimeout(() => process.exit(0), 6000);
  timeout.unref();
  await bridge.shutdown();
  lines.close();
  process.stdin.destroy();
}
lines.on("close", close);
process.on("SIGINT", close);
process.on("SIGTERM", close);
process.stdout.on("error", () => close());
