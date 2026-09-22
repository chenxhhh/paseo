"use strict";
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

async function discoverEndpoint(env = process.env) {
  if (env.WITH_DESKTOP_PORT) {
    const port = Number(env.WITH_DESKTOP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid WITH_DESKTOP_PORT");
    return `http://127.0.0.1:${port}`;
  }
  if (process.platform !== "win32") throw new Error("Set WITH_DESKTOP_PORT on non-Windows hosts");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      '$ids=@(Get-Process with_daemon -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id); if($ids.Count -gt 0){Get-NetTCPConnection -State Listen | Where-Object {$_.OwningProcess -in $ids -and $_.LocalAddress -eq "127.0.0.1"} | Select-Object -ExpandProperty LocalPort}',
    ],
    { windowsHide: true, timeout: 15000 },
  );
  const ports = [
    ...new Set(
      stdout
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((n) => n > 0),
    ),
  ];
  if (ports.length !== 1)
    throw new Error("Cannot uniquely locate With daemon. Open With or set WITH_DESKTOP_PORT.");
  return `http://127.0.0.1:${ports[0]}`;
}
function unwrap(value) {
  if (value && typeof value === "object" && typeof value.code === "number") {
    if (value.code !== 0)
      throw new Error(`With error ${value.code}: ${value.msg || "request failed"}`);
    return value.data ?? null;
  }
  return value;
}
class DesktopTransport {
  constructor(endpoint, options = {}) {
    this.endpoint = endpoint;
    this.requestTimeout = options.requestTimeout || 30000;
    this.pending = new Map();
    this.channels = new Map();
    this.seq = 1;
    this.onDisconnect = () => {};
    this.closing = false;
  }
  async invoke(cmd, args = {}) {
    const response = await fetch(`${this.endpoint}/invoke?cmd=${encodeURIComponent(cmd)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd, args }),
      signal: AbortSignal.timeout(this.requestTimeout),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error || `With HTTP ${response.status}`);
    return unwrap(result);
  }
  async connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.closing = false;
    this.connecting = new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(this.endpoint.replace("http:", "ws:") + "/ws"));
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("With WebSocket timeout"));
      }, 10000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("With WebSocket unavailable"));
      };
      ws.onmessage = ({ data }) => {
        let frame;
        try {
          frame = JSON.parse(data);
        } catch {
          return;
        }
        if (typeof frame.channel === "number") {
          const entry = this.channels.get(frame.channel);
          if (entry?.id === frame.id) entry.callback(frame.payload);
          return;
        }
        const entry = this.pending.get(frame.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(frame.id);
        try {
          frame.ok
            ? entry.resolve(unwrap(frame.data))
            : entry.reject(new Error(frame.error || "With invocation failed"));
        } catch (error) {
          entry.reject(error);
        }
      };
      ws.onclose = () => {
        clearTimeout(timer);
        reject(new Error("With WebSocket closed during connection"));
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("With disconnected"));
        }
        this.pending.clear();
        this.channels.clear();
        if (!this.closing)
          this.onDisconnect(
            new Error(
              "With disconnected; load the session to recover history. Requests are never retried automatically.",
            ),
          );
      };
    }).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
  async stream(cmd, args, callback) {
    await this.connect();
    const id = this.seq++,
      channel = this.seq++;
    this.channels.set(channel, { id, callback });
    const started = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${cmd} acknowledgement timeout`));
      }, this.requestTimeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(
        JSON.stringify({
          id,
          type: "invoke",
          cmd,
          args: { ...args, onEvent: `__CHANNEL__:${channel}` },
        }),
      );
    });
    const close = () => {
      this.channels.delete(channel);
      if (this.ws?.readyState === WebSocket.OPEN)
        this.ws.send(JSON.stringify({ type: "channel_close", channel }));
    };
    try {
      await started;
    } catch (error) {
      close();
      throw error;
    }
    return close;
  }
  close() {
    this.closing = true;
    this.ws?.close();
  }
}
module.exports = { DesktopTransport, discoverEndpoint, unwrap };
