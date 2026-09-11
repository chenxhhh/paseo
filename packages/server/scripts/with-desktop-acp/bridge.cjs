"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { fileURLToPath } = require("node:url");
const { DesktopTransport, discoverEndpoint } = require("./transport.cjs");
const MODES = [
  {
    id: "agent",
    name: "Agent",
    description: "With tools, with manual review for elevated actions",
  },
  { id: "manual", name: "Manual", description: "Pure chat without workspace tools" },
];
const select = (id, name, category, value, options) => ({
  id,
  name,
  category,
  type: "select",
  currentValue: value,
  options,
});
const choice = (value, name = value || "Default") => ({ value: String(value), name });
function invalid(message) {
  const error = new Error(message);
  error.code = -32602;
  return error;
}
function modelsFrom(value) {
  const found = new Map();
  const visit = (x) => {
    if (!x || typeof x !== "object") return;
    if (typeof x.model_name === "string") {
      found.set(x.model_name, x);
      return;
    }
    for (const v of Object.values(x)) visit(v);
  };
  visit(value);
  return [...found.values()];
}
function patchDocument(document, patches = []) {
  const out = structuredClone(document || {});
  for (const patch of patches) {
    if (!["add", "replace", "remove"].includes(patch.op) || typeof patch.path !== "string")
      continue;
    const keys = patch.path
      .split("/")
      .slice(1)
      .map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (!keys.length || keys.some((k) => ["__proto__", "constructor", "prototype"].includes(k)))
      continue;
    let target = out;
    for (const k of keys.slice(0, -1)) target = target[k] ??= {};
    const last = keys.at(-1);
    if (patch.op === "remove") {
      if (Array.isArray(target)) target.splice(Number(last), 1);
      else delete target[last];
    } else if (Array.isArray(target) && patch.op === "add")
      target.splice(last === "-" ? target.length : Number(last), 0, patch.value);
    else target[last] = patch.value;
  }
  return out;
}
class StateStore {
  constructor(dir = path.join(os.homedir(), ".paseo", "with-desktop-acp")) {
    this.dir = dir;
  }
  file(id) {
    if (!/^with-desktop-[a-f0-9-]{36}$/.test(id)) throw invalid("Not a bridge-owned session ID");
    return path.join(this.dir, id + ".json");
  }
  put(s) {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.file(s.id),
      temp = file + "." + randomUUID() + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(s, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  get(id) {
    try {
      return JSON.parse(fs.readFileSync(this.file(id), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") throw invalid("Unknown bridge session");
      throw e;
    }
  }
  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => /^with-desktop-[a-f0-9-]{36}\.json$/.test(f))
      .map((f) => this.get(f.slice(0, -5)))
      .filter((s) => !s.deleted);
  }
}
class Bridge {
  constructor({
    transport,
    store = new StateStore(),
    notify = () => {},
    requestClient = async () => ({ outcome: { outcome: "cancelled" } }),
    turnTimeout = 30 * 60 * 1000,
  } = {}) {
    this.transport = transport;
    this.store = store;
    this.notify = notify;
    this.requestClient = requestClient;
    this.sessions = new Map();
    this.runs = new Map();
    this.models = [];
    this.turnTimeout = turnTimeout;
  }
  async init(params) {
    if (params.protocolVersion !== 1) throw invalid("Only ACP protocol version 1 is supported");
    if (!this.transport) this.transport = new DesktopTransport(await discoverEndpoint());
    this.transport.onDisconnect = (error) => {
      for (const run of this.runs.values()) run.finish(error);
    };
    this.models = modelsFrom(await this.transport.invoke("get_agent_models"));
    if (!this.models.length)
      throw new Error("With returned no models; sign in in the With desktop app");
    return {
      protocolVersion: 1,
      agentInfo: { name: "with-desktop-acp", title: "With Desktop Bridge", version: "0.1.0" },
      authMethods: [],
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, embeddedContext: true, audio: false },
        mcpCapabilities: { http: false, sse: false },
        sessionCapabilities: { list: {}, resume: {}, close: {} },
      },
      _meta: {
        desktopRequired: true,
        permissions: "manual_review",
        unsupported: ["custom MCP injection", "automatic active-stream resume", "fork"],
        extensions: ["session/delete", "_with/set_additional_directories"],
      },
    };
  }
  checkMcp(p) {
    if (p.mcpServers?.length)
      throw invalid(
        "Desktop bridge cannot inject ACP mcpServers. Use desktop-configured MCP or the Knot CLI provider.",
      );
  }
  get(id) {
    const s = this.sessions.get(id) || this.store.get(id);
    if (s.deleted) throw invalid("Session was deleted");
    this.sessions.set(id, s);
    return s;
  }
  persist(s) {
    s.updatedAt = new Date().toISOString();
    this.store.put(s);
  }
  model(s) {
    return this.models.find((m) => m.model_name === s.model);
  }
  options(s) {
    const m = this.model(s),
      efforts = m?.reasoning_effort || [],
      contexts = m?.max_context_token_list || [];
    return [
      select(
        "model",
        "Model",
        "model",
        s.model,
        this.models.map((m) => choice(m.model_name, m.display_name || m.model_name)),
      ),
      select(
        "reasoning_effort",
        "Reasoning Effort",
        "thought_level",
        s.reasoning_effort,
        efforts.map((e) => choice(e.name, e.display_name || e.name)),
      ),
      select(
        "max_context_tokens",
        "Context Window",
        "model_config",
        s.max_context_tokens,
        contexts.length
          ? [
              choice(""),
              ...contexts.map((n) => choice(n, n >= 1e6 ? `${n / 1e6}M` : `${n / 1000}K`)),
            ]
          : [],
      ),
      select(
        "enable_thinking",
        "Enable Thinking",
        "model_config",
        s.enable_thinking,
        (m?.is_support_thinking ? ["false", "true"] : ["false"]).map((v) =>
          choice(v, v === "true" ? "On" : "Off"),
        ),
      ),
      select(
        "mode",
        "Mode",
        "mode",
        s.mode,
        MODES.map((m) => choice(m.id, m.name)),
      ),
      select("enable_web_search", "Web Search", "_tools", s.enable_web_search, [
        choice(""),
        choice("true", "On"),
        choice("false", "Off"),
      ]),
    ];
  }
  resetModel(s) {
    const m = this.model(s);
    s.reasoning_effort =
      m?.reasoning_effort?.find((e) => e.default_option)?.name ||
      m?.reasoning_effort?.[0]?.name ||
      "";
    s.max_context_tokens = "";
    s.enable_thinking = "false";
  }
  result(s) {
    return {
      sessionId: s.id,
      configOptions: this.options(s),
      modes: { currentModeId: s.mode, availableModes: MODES },
    };
  }
  update(s, update) {
    this.notify("session/update", { sessionId: s.id, update });
  }
  async newSession(p) {
    this.checkMcp(p);
    if (!p.cwd || !path.isAbsolute(p.cwd)) throw invalid("cwd must be absolute");
    const s = {
      id: "with-desktop-" + randomUUID(),
      cwd: path.resolve(p.cwd),
      extraDirs: [],
      model: this.models[0].model_name,
      mode: "agent",
      enable_web_search: "",
      createdAt: new Date().toISOString(),
      turns: 0,
    };
    this.resetModel(s);
    this.sessions.set(s.id, s);
    this.persist(s);
    return this.result(s);
  }
  async history(s) {
    if (!s.desktopId) return [];
    let page = 1,
      result = [];
    for (;;) {
      const r = await this.transport.invoke("list_qa_messages", {
        params: { session_id: s.desktopId, page, page_size: 100 },
      });
      const items = r?.messages || [];
      result.push(...items);
      if (!items.length || result.length >= (r.total ?? items.length)) break;
      if (++page > 1000) throw new Error("History exceeds replay limit");
    }
    return result.reverse();
  }
  async load(p, replay) {
    this.checkMcp(p);
    const s = this.get(p.sessionId);
    if (p.cwd && path.resolve(p.cwd).toLowerCase() !== s.cwd.toLowerCase())
      throw invalid("Session workspace differs from persisted workspace");
    if (this.runs.has(s.id)) throw invalid("Cannot load a running session");
    if (replay)
      for (const m of await this.history(s)) {
        if (m.request)
          this.update(s, {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: m.request },
          });
        if (m.response_protocol === "ag_ui") {
          const fake = { replay: true, tools: new Map(), seen: new Set(), finish: () => {} };
          for (const line of (m.response || "").split("\n")) {
            let e;
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }
            await this.event(s, fake, e);
          }
        } else if (m.response)
          this.update(s, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: m.response },
          });
      }
    return this.result(s);
  }
  setConfig(p) {
    const s = this.get(p.sessionId);
    if (this.runs.has(s.id)) throw invalid("Cannot change settings during a turn");
    const o = this.options(s).find((o) => o.id === p.configId);
    if (!o || !o.options.some((v) => v.value === p.value))
      throw invalid(`Invalid ${p.configId} value`);
    s[p.configId] = p.value;
    if (p.configId === "model") this.resetModel(s);
    this.persist(s);
    const configOptions = this.options(s);
    this.update(s, { sessionUpdate: "config_option_update", configOptions });
    if (p.configId === "mode")
      this.update(s, { sessionUpdate: "current_mode_update", currentModeId: s.mode });
    return { configOptions };
  }
  async ensureDesktop(s) {
    if (s.desktopId) return;
    const r = await this.transport.invoke("session_create", {
      title: "Paseo · With Desktop",
      workspaceDir: s.cwd,
      isPureChat: s.mode === "manual",
      sessionType: "common",
    });
    s.desktopId = typeof r === "string" ? r : r?.session_id || r?.id;
    if (!s.desktopId) throw new Error("With did not return a session ID");
    const detail = await this.transport.invoke("session_get", { sessionId: s.desktopId });
    s.clientUuid = detail?.client_uuid || detail?.session?.client_uuid;
    this.persist(s);
  }
  async content(blocks) {
    if (!Array.isArray(blocks) || !blocks.length) throw invalid("Empty prompt");
    const texts = [],
      images = [],
      files = [];
    for (const b of blocks) {
      if (b.type === "text") texts.push(b.text);
      else if (b.type === "resource" && typeof b.resource?.text === "string")
        texts.push(`${b.resource.uri || "Embedded context"}\n${b.resource.text}`);
      else if (b.type === "resource_link" && b.uri?.startsWith("file:"))
        files.push({ file_abs_path: fileURLToPath(b.uri) });
      else if (b.type === "resource_link") texts.push(`${b.name || "Resource"}: ${b.uri}`);
      else if (b.type === "image" && b.data && /^image\//.test(b.mimeType || "")) {
        if (b.data.length > 20 * 1024 * 1024) throw invalid("Image exceeds bridge limit");
        images.push({
          data: b.data,
          filename: `acp-${images.length}.${b.mimeType.split("/")[1].replace(/[^a-z0-9]/gi, "")}`,
        });
      } else throw invalid(`Unsupported prompt block: ${b.type}. Nothing was sent.`);
    }
    const uploaded = images.length
      ? await this.transport.invoke("upload_image_base64", { images })
      : null;
    if (images.length && uploaded?.files?.length !== images.length)
      throw new Error("With image upload incomplete");
    return {
      message: texts.join("\n\n"),
      attached_images: uploaded?.files?.map((f) => f.cos_url) || [],
      selected_files: files,
    };
  }
  async prompt(p) {
    const s = this.get(p.sessionId);
    if (this.runs.has(s.id)) throw invalid("A turn is already active");
    let resolve, reject;
    const done = new Promise((a, b) => {
      resolve = a;
      reject = b;
    });
    const run = {
      tools: new Map(),
      seen: new Set(),
      permissionIds: new Set(),
      text: "",
      thought: "",
      cancelled: false,
      settled: false,
      queue: Promise.resolve(),
    };
    run.finish = (error) => {
      if (run.settled) return;
      run.settled = true;
      clearTimeout(run.timer);
      clearInterval(run.poll);
      run.close?.();
      this.runs.delete(s.id);
      this.notify("_with/turn_finished", { sessionId: s.id });
      if (error) reject(error);
      else resolve({ stopReason: run.cancelled ? "cancelled" : "end_turn" });
    };
    this.runs.set(s.id, run);
    done.catch(() => {});
    try {
      const content = await this.content(p.prompt);
      await this.ensureDesktop(s);
      if (run.cancelled || run.settled) {
        run.finish();
        return await done;
      }
      let active = await this.transport.invoke("get_active_session", { sessionId: s.desktopId });
      for (
        let attempt = 0;
        active?.message_id && active.message_id === s.lastMessageId && attempt < 12;
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        active = await this.transport.invoke("get_active_session", { sessionId: s.desktopId });
      }
      if (active?.message_id)
        throw invalid(
          "Desktop session already has an active turn; cancel or wait before sending another",
        );
      if (run.cancelled || run.settled) {
        run.finish();
        return await done;
      }
      const params = {
        session_id: s.desktopId,
        client_uuid: s.clientUuid,
        ...content,
        is_first: s.turns === 0,
        model: s.model,
        workspaces: [s.cwd, ...s.extraDirs],
        is_pure_chat: s.mode === "manual",
        permission_mode: "manual_review",
        extra_headers: { "X-Internal-Oauth-Type": "oauth2" },
        ...(s.reasoning_effort ? { reasoning_effort: s.reasoning_effort } : {}),
        ...(s.max_context_tokens ? { max_context_tokens: Number(s.max_context_tokens) } : {}),
        ...(this.model(s)?.is_support_thinking
          ? { enable_thinking: s.enable_thinking === "true" }
          : {}),
        ...(s.enable_web_search ? { enable_web_search: s.enable_web_search === "true" } : {}),
      };
      run.timer = setTimeout(() => {
        this.cancel(s.id).catch(() => {});
        run.finish(new Error("Turn timeout; cancellation requested"));
      }, this.turnTimeout);
      run.sending = true;
      let acknowledge;
      run.startAck = new Promise((resolve) => {
        acknowledge = resolve;
      });
      let close;
      try {
        close = await this.transport.stream("chat_send", { params }, (payload) => {
          run.queue = run.queue
            .then(async () => {
              for (const e of Array.isArray(payload) ? payload : [payload])
                await this.event(s, run, e);
            })
            .catch((error) => run.finish(error));
        });
      } finally {
        acknowledge();
      }
      run.close = close;
      if (run.settled) close();
      s.turns++;
      this.persist(s);
      if (run.cancelled && !run.settled) await this.cancel(s.id);
      if (!run.settled)
        run.poll = setInterval(() => this.poll(s, run).catch((error) => run.finish(error)), 5000);
    } catch (error) {
      run.finish(error);
    }
    return done;
  }
  async poll(s, run) {
    if (run.polling || run.settled || !run.messageId) return;
    run.polling = true;
    try {
      const m = await this.transport.invoke("get_qa_message_detail", {
        params: { sessionId: s.desktopId, messageId: run.messageId, withChatId: null },
      });
      if (["done", "cancelled", "canceled", "error", "failed"].includes(m?.status)) {
        if (m.status === "error" || m.status === "failed")
          run.finish(new Error("With reported failed message"));
        else {
          await run.queue;
          if (run.settled) return;
          if (m.status !== "done") run.cancelled = true;
          const parts = { text: "", thought: "" };
          for (const line of (m.response || "").split("\n")) {
            let event;
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }
            const key =
              event.type === "TEXT_MESSAGE_CONTENT"
                ? "text"
                : event.type === "THINKING_TEXT_MESSAGE_CONTENT"
                  ? "thought"
                  : null;
            if (key) parts[key] += event.rawEvent?.content || event.delta || "";
          }
          for (const key of ["thought", "text"])
            if (parts[key].startsWith(run[key]) && parts[key].length > run[key].length) {
              this.update(s, {
                sessionUpdate: key === "text" ? "agent_message_chunk" : "agent_thought_chunk",
                content: { type: "text", text: parts[key].slice(run[key].length) },
              });
            }
          this.persist(s);
          run.finish();
        }
      }
    } finally {
      run.polling = false;
    }
  }
  async event(s, run, e) {
    if (!e || run.settled) return;
    const r = e.rawEvent || {},
      type = e.type;
    if (e.session_id && e.session_id !== s.desktopId) return;
    if (typeof e.offset === "number" && e.offset > 0) {
      const key = `${e.offset}:${type}`;
      if (run.seen.has(key)) return;
      run.seen.add(key);
    }
    if (!run.replay && r.message_id) {
      run.messageId = r.message_id;
      s.lastMessageId = r.message_id;
    }
    const text = e.delta || r.content || e.content || "";
    if (type === "TEXT_MESSAGE_CONTENT" || type === "THINKING_TEXT_MESSAGE_CONTENT") {
      if (text) {
        const key = type === "TEXT_MESSAGE_CONTENT" ? "text" : "thought";
        run[key] = (run[key] || "") + text;
        this.update(s, {
          sessionUpdate: key === "text" ? "agent_message_chunk" : "agent_thought_chunk",
          content: { type: "text", text },
        });
      }
    } else if (type === "TOOL_CALL_START") {
      const id = r.tool_call_id || e.toolCallId;
      if (!id) return;
      const tool = {
        toolCallId: id,
        title: r.display_name || r.name || e.toolCallName || "With tool",
        kind: /terminal|command/.test(r.name || "")
          ? "execute"
          : /write|replace|edit/.test(r.name || "")
            ? "edit"
            : /read|search/.test(r.name || "")
              ? "read"
              : "other",
        status: "in_progress",
        rawInput: {},
      };
      run.tools.set(id, tool);
      this.update(s, { sessionUpdate: "tool_call", ...tool });
    } else if (type === "TOOL_CALL_ARGS") {
      const tool = run.tools.get(r.tool_call_id || e.toolCallId);
      if (!tool) return;
      tool.rawInput = patchDocument(r.document ?? tool.rawInput, r.patchs);
      this.update(s, {
        sessionUpdate: "tool_call_update",
        toolCallId: tool.toolCallId,
        rawInput: tool.rawInput,
      });
    } else if (type === "TOOL_CALL_RESULT") {
      const id = r.tool_call_id || e.toolCallId;
      if (!id) return;
      const output = r.document ?? r.result ?? r.content ?? e.content;
      this.update(s, {
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: r.is_streamable && !r.is_result_done ? "in_progress" : "completed",
        rawOutput: output,
        ...(output !== undefined
          ? {
              content: [
                {
                  type: "content",
                  content: {
                    type: "text",
                    text: typeof output === "string" ? output : JSON.stringify(output),
                  },
                },
              ],
            }
          : {}),
      });
    } else if (type === "CUSTOM" && (r.type || e.name) === "user_confirm") {
      if (!run.replay)
        this.permission(s, run, r).catch((error) => {
          this.cancel(s.id).catch(() => {});
          run.finish(error);
        });
    } else if (type === "CUSTOM" && (r.type || e.name) === "mcp_oauth_required") {
      this.update(s, {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "\nWith requires MCP authorization. Complete it in the With desktop app.\n",
        },
      });
    } else if (type === "STEP_FINISHED" && r.token_usage) {
      const size = Number(s.max_context_tokens) || this.model(s)?.max_context_token;
      if (size > 0)
        this.update(s, {
          sessionUpdate: "usage_update",
          used: r.token_usage.prompt_tokens || 0,
          size,
        });
    } else if (type === "RUN_ERROR")
      run.finish(new Error(r.message || e.message || "With run failed"));
    else if (type === "RUN_FINISHED" || type === "done") {
      if (!run.replay) this.persist(s);
      run.finish();
    }
  }
  async permission(s, run, r) {
    if (!r.tool_call_id || run.permissionIds.has(r.tool_call_id)) return;
    run.permissionIds.add(r.tool_call_id);
    const actions = (r.actions || []).filter((a) => typeof a.value === "string");
    const options = actions
      .filter((a) => ["yes", "no"].includes(a.value))
      .map((a) => ({
        optionId: a.value,
        name: a.label || a.value,
        kind: a.value === "yes" ? "allow_once" : "reject_once",
      }));
    if (!options.length) {
      await this.cancel(s.id);
      throw new Error("Unknown desktop confirmation actions; cancelled rather than auto-approve");
    }
    const tool = run.tools.get(r.tool_call_id) || {
      toolCallId: r.tool_call_id,
      title: r.label || r.name || "With confirmation",
      kind: "other",
      status: "pending",
    };
    const response = await this.requestClient("session/request_permission", {
      sessionId: s.id,
      toolCall: { ...tool, status: "pending", title: r.label || tool.title },
      options,
    });
    if (run.settled || run.cancelled) return;
    const selected = response?.outcome?.outcome === "selected" ? response.outcome.optionId : null;
    if (!options.some((o) => o.optionId === selected)) {
      await this.cancel(s.id);
      return;
    }
    await this.transport.invoke("chat_agent_user_confirm", {
      params: { tool_call_id: r.tool_call_id, status: selected, client_uuid: s.clientUuid },
    });
  }
  async cancel(id) {
    const s = this.get(id),
      run = this.runs.get(id);
    if (run) run.cancelled = true;
    if (!s.desktopId || (run && !run.sending)) {
      if (run) run.finish();
      return {};
    }
    if (run?.startAck) await run.startAck;
    let mid = run?.messageId;
    if (!mid)
      mid = (await this.transport.invoke("get_active_session", { sessionId: s.desktopId }))
        ?.message_id;
    if (mid || run?.sending)
      await this.transport.invoke("chat_cancel", {
        params: { session_id: s.desktopId, message_id: mid || "", disconnect_only: false },
      });
    if (run) run.finish();
    return {};
  }
  async dispatch(method, p = {}) {
    if (method === "initialize") return this.init(p);
    if (!this.models.length) throw invalid("Initialize first");
    switch (method) {
      case "authenticate":
        throw invalid("Sign in using the With desktop app");
      case "session/new":
        return this.newSession(p);
      case "session/load":
        return this.load(p, true);
      case "session/resume":
        return this.load(p, false);
      case "session/set_config_option":
        return this.setConfig(p);
      case "session/set_model":
        this.setConfig({ ...p, configId: "model", value: p.modelId });
        return {};
      case "session/set_mode":
        this.setConfig({ ...p, configId: "mode", value: p.modeId });
        return {};
      case "session/prompt":
        return this.prompt(p);
      case "session/cancel":
        return this.cancel(p.sessionId);
      case "session/close": {
        if (this.runs.has(p.sessionId)) await this.cancel(p.sessionId);
        this.sessions.delete(p.sessionId);
        return {};
      }
      case "session/list": {
        const all = this.store
          .list()
          .filter((s) => s.desktopId && (!p.cwd || path.resolve(p.cwd) === s.cwd))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const start = Number(p.cursor || 0);
        if (!Number.isSafeInteger(start) || start < 0) throw invalid("Invalid cursor");
        return {
          sessions: all
            .slice(start, start + 50)
            .map((s) => ({
              sessionId: s.id,
              cwd: s.cwd,
              title: s.title || "Paseo · With Desktop",
              updatedAt: s.updatedAt,
            })),
          ...(start + 50 < all.length ? { nextCursor: String(start + 50) } : {}),
        };
      }
      case "session/delete": {
        const s = this.get(p.sessionId);
        if (this.runs.has(s.id)) await this.cancel(s.id);
        if (s.desktopId) await this.transport.invoke("session_delete", { sessionId: s.desktopId });
        s.deleted = true;
        this.persist(s);
        this.sessions.delete(s.id);
        return {};
      }
      case "_with/set_additional_directories": {
        const s = this.get(p.sessionId);
        if (this.runs.has(s.id)) throw invalid("Turn active");
        if (
          !Array.isArray(p.directories) ||
          p.directories.some((d) => typeof d !== "string" || !path.isAbsolute(d))
        )
          throw invalid("Absolute directories required");
        s.extraDirs = [...new Set(p.directories.map((d) => path.resolve(d)))];
        this.persist(s);
        return { directories: s.extraDirs };
      }
      default: {
        const error = new Error(`Unsupported ACP method: ${method}`);
        error.code = -32601;
        throw error;
      }
    }
  }
  async shutdown() {
    await Promise.allSettled([...this.runs.keys()].map((id) => this.cancel(id)));
    this.transport?.close();
  }
}
module.exports = { Bridge, StateStore, modelsFrom, patchDocument, invalid };
