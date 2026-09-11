"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Bridge, StateStore, patchDocument } = require("./bridge.cjs");
const { unwrap, discoverEndpoint } = require("./transport.cjs");
const models = [
  {
    model_name: "ext-glm-5.3",
    max_context_token: 1000000,
    reasoning_effort: [{ name: "high" }, { name: "max", default_option: true }],
    max_context_token_list: [200000, 1000000],
  },
  { model_name: "plain", reasoning_effort: [], max_context_token_list: [] },
];
function setup(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "with-bridge-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [],
    updates = [];
  let eventHandler;
  const transport = {
    invoke: async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "get_agent_models") return { models };
      if (cmd === "session_create") return "test-desktop";
      if (cmd === "session_get") return { client_uuid: "test-client" };
      if (cmd === "get_active_session") return null;
      if (cmd === "list_qa_messages")
        return { messages: [{ request: "hello", response: "world", status: "done" }], total: 1 };
      return null;
    },
    stream: async (cmd, args, cb) => {
      calls.push({ cmd, args });
      eventHandler = cb;
      return () => calls.push({ cmd: "channel_close" });
    },
    close() {},
  };
  const bridge = new Bridge({
    transport,
    store: new StateStore(dir),
    notify: (method, p) => {
      if (method === "session/update") updates.push(p.update);
    },
    ...extra,
  });
  return { bridge, transport, calls, updates, dir, emit: (e) => eventHandler([e]) };
}
async function session(f) {
  await f.bridge.dispatch("initialize", { protocolVersion: 1 });
  return f.bridge.dispatch("session/new", { cwd: process.cwd(), mcpServers: [] });
}
async function waitFor(test) {
  for (let i = 0; i < 100; i++) {
    if (test()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("Condition timeout");
}
const prompt = (s) => ({ sessionId: s.sessionId, prompt: [{ type: "text", text: "test" }] });

test("capabilities do not overclaim MCP, audio or active resume", async (t) => {
  const f = setup(t),
    r = await f.bridge.init({ protocolVersion: 1 });
  assert.equal(r.agentCapabilities.mcpCapabilities.http, false);
  assert.equal(r.agentCapabilities.promptCapabilities.image, true);
  assert.equal(r.agentCapabilities.loadSession, true);
});
test("model choices include actual effort and context, switching resets stale values", async (t) => {
  const f = setup(t),
    s = await session(f);
  for (const value of ["high", "max"])
    f.bridge.setConfig({ sessionId: s.sessionId, configId: "reasoning_effort", value });
  for (const value of ["200000", "1000000"])
    f.bridge.setConfig({ sessionId: s.sessionId, configId: "max_context_tokens", value });
  assert.throws(() =>
    f.bridge.setConfig({ sessionId: s.sessionId, configId: "max_context_tokens", value: "999" }),
  );
  const r = f.bridge.setConfig({ sessionId: s.sessionId, configId: "model", value: "plain" });
  assert.equal(r.configOptions.find((o) => o.id === "max_context_tokens").currentValue, "");
  assert.equal(r.configOptions.find((o) => o.id === "reasoning_effort").options.length, 0);
});
test("new catalog sessions are lazy and MCP injection is explicitly rejected", async (t) => {
  const f = setup(t);
  await session(f);
  assert(!f.calls.some((c) => c.cmd === "session_create"));
  await assert.rejects(
    f.bridge.newSession({ cwd: process.cwd(), mcpServers: [{ name: "x" }] }),
    /cannot inject/,
  );
});
test("prompt translates settings, streams text/thought/tools/usage and completes once", async (t) => {
  const f = setup(t),
    s = await session(f);
  f.bridge.setConfig({ sessionId: s.sessionId, configId: "max_context_tokens", value: "1000000" });
  const done = f.bridge.prompt(prompt(s));
  await waitFor(() => f.calls.some((c) => c.cmd === "chat_send"));
  const params = f.calls.find((c) => c.cmd === "chat_send").args.params;
  assert.equal(params.reasoning_effort, "max");
  assert.equal(params.max_context_tokens, 1000000);
  assert.equal(params.permission_mode, "manual_review");
  assert.equal(params.client_uuid, "test-client");
  f.emit({ type: "RUN_STARTED", rawEvent: { message_id: "m1" } });
  f.emit({ type: "TEXT_MESSAGE_CONTENT", offset: 2, delta: "hello" });
  f.emit({ type: "TEXT_MESSAGE_CONTENT", offset: 2, delta: "hello" });
  f.emit({ type: "THINKING_TEXT_MESSAGE_CONTENT", delta: "thinking" });
  f.emit({ type: "TOOL_CALL_START", rawEvent: { tool_call_id: "tool", name: "read_file" } });
  f.emit({
    type: "TOOL_CALL_ARGS",
    rawEvent: {
      tool_call_id: "tool",
      document: { path: "x" },
      patchs: [{ op: "replace", path: "/path", value: "y" }],
    },
  });
  f.emit({
    type: "TOOL_CALL_RESULT",
    rawEvent: { tool_call_id: "tool", document: { result: "ok" } },
  });
  f.emit({ type: "STEP_FINISHED", rawEvent: { token_usage: { prompt_tokens: 123 } } });
  f.emit({ type: "RUN_FINISHED" });
  assert.equal((await done).stopReason, "end_turn");
  assert.equal(f.updates.filter((u) => u.sessionUpdate === "agent_message_chunk").length, 1);
  assert(f.updates.some((u) => u.sessionUpdate === "usage_update" && u.used === 123));
  assert(f.updates.some((u) => u.rawInput?.path === "y"));
  assert.equal(f.bridge.runs.size, 0);
});
test("concurrent prompts and settings changes cannot race an active turn", async (t) => {
  const f = setup(t),
    s = await session(f),
    done = f.bridge.prompt(prompt(s));
  await assert.rejects(f.bridge.prompt(prompt(s)), /already active/);
  assert.throws(
    () => f.bridge.setConfig({ sessionId: s.sessionId, configId: "mode", value: "manual" }),
    /during a turn/,
  );
  await f.bridge.cancel(s.sessionId);
  assert.equal((await done).stopReason, "cancelled");
});
test("active cancellation maps to desktop cancellation, not channel disconnect", async (t) => {
  const f = setup(t),
    s = await session(f),
    done = f.bridge.prompt(prompt(s));
  await waitFor(() => f.calls.some((c) => c.cmd === "chat_send"));
  f.emit({ type: "RUN_STARTED", rawEvent: { message_id: "mid" } });
  await waitFor(() => f.bridge.runs.get(s.sessionId)?.messageId);
  await f.bridge.cancel(s.sessionId);
  assert.equal((await done).stopReason, "cancelled");
  const c = f.calls.find((c) => c.cmd === "chat_cancel");
  assert.equal(c.args.params.message_id, "mid");
  assert.equal(c.args.params.disconnect_only, false);
});
test("permission allow/reject is scoped to offered one-time options", async (t) => {
  for (const selected of ["yes", "no"]) {
    const f = setup(t, {
      requestClient: async (method, p) => {
        assert.equal(method, "session/request_permission");
        assert(p.options.every((o) => o.kind.endsWith("_once")));
        return { outcome: { outcome: "selected", optionId: selected } };
      },
    });
    const s = await session(f),
      done = f.bridge.prompt(prompt(s));
    await waitFor(() => f.calls.some((c) => c.cmd === "chat_send"));
    f.emit({
      type: "CUSTOM",
      rawEvent: {
        type: "user_confirm",
        tool_call_id: "t",
        actions: [
          { value: "yes", label: "Allow" },
          { value: "no", label: "Reject" },
        ],
      },
    });
    await waitFor(() => f.calls.some((c) => c.cmd === "chat_agent_user_confirm"));
    assert.equal(
      f.calls.find((c) => c.cmd === "chat_agent_user_confirm").args.params.status,
      selected,
    );
    f.emit({ type: "RUN_FINISHED" });
    await done;
  }
});
test("cancelled permission never defaults to approval", async (t) => {
  const f = setup(t),
    s = await session(f),
    done = f.bridge.prompt(prompt(s));
  await waitFor(() => f.calls.some((c) => c.cmd === "chat_send"));
  f.emit({
    type: "CUSTOM",
    rawEvent: {
      type: "user_confirm",
      tool_call_id: "t",
      actions: [{ value: "yes" }, { value: "no" }],
    },
  });
  assert.equal((await done).stopReason, "cancelled");
  assert(!f.calls.some((c) => c.cmd === "chat_agent_user_confirm"));
});
test("restart load replays history; resume does not; close is nondestructive", async (t) => {
  const f = setup(t),
    s = await session(f);
  await f.bridge.ensureDesktop(f.bridge.get(s.sessionId));
  await f.bridge.dispatch("session/close", { sessionId: s.sessionId });
  const next = new Bridge({
    transport: f.transport,
    store: new StateStore(f.dir),
    notify: (m, p) => f.updates.push(p.update),
  });
  await next.init({ protocolVersion: 1 });
  await next.load({ sessionId: s.sessionId, cwd: process.cwd() }, true);
  assert.equal(
    f.updates.find((u) => u.sessionUpdate === "agent_message_chunk").content.text,
    "world",
  );
  const count = f.updates.length;
  await next.load({ sessionId: s.sessionId }, false);
  assert.equal(f.updates.length, count);
  assert(!f.calls.some((c) => c.cmd === "session_delete"));
});
test("list and delete never enumerate or modify unrelated desktop sessions", async (t) => {
  const f = setup(t),
    s = await session(f);
  await f.bridge.ensureDesktop(f.bridge.get(s.sessionId));
  const listed = await f.bridge.dispatch("session/list");
  assert.equal(listed.sessions.length, 1);
  await assert.rejects(f.bridge.dispatch("session/delete", { sessionId: "someone-elses-id" }));
  await f.bridge.dispatch("session/delete", { sessionId: s.sessionId });
  assert.equal((await f.bridge.dispatch("session/list")).sessions.length, 0);
});
test("embedded text is passed through but unsupported blocks fail before chat_send", async (t) => {
  const f = setup(t),
    s = await session(f);
  const p = await f.bridge.content([
    { type: "resource", resource: { uri: "note://test", text: "context" } },
  ]);
  assert(p.message.includes("context"));
  await assert.rejects(
    f.bridge.prompt({ sessionId: s.sessionId, prompt: [{ type: "audio" }] }),
    /Unsupported/,
  );
  assert(!f.calls.some((c) => c.cmd === "chat_send"));
});
test("transport disconnect rejects prompt rather than silently replaying", async (t) => {
  const f = setup(t),
    s = await session(f),
    done = f.bridge.prompt(prompt(s));
  await waitFor(() => f.calls.some((c) => c.cmd === "chat_send"));
  f.transport.onDisconnect(new Error("connection lost"));
  await assert.rejects(done, /connection lost/);
  assert.equal(f.calls.filter((c) => c.cmd === "chat_send").length, 1);
});
test("safe JSON patch and service error envelope", () => {
  const r = patchDocument({}, [
    { op: "add", path: "/__proto__/evil", value: true },
    { op: "add", path: "/path", value: "ok" },
  ]);
  assert.equal({}.evil, undefined);
  assert.equal(r.path, "ok");
  assert.throws(() => unwrap({ code: 3, msg: "not allowed" }), /not allowed/);
});
test("explicit local port validation rejects arbitrary endpoints", async () => {
  assert.equal(await discoverEndpoint({ WITH_DESKTOP_PORT: "57438" }), "http://127.0.0.1:57438");
  await assert.rejects(discoverEndpoint({ WITH_DESKTOP_PORT: "https://external" }));
});

test("images use explicit upload and pass resulting URL", async (t) => {
  const f = setup(t);
  await session(f);
  const original = f.transport.invoke;
  f.transport.invoke = async (cmd, args) =>
    cmd === "upload_image_base64"
      ? { files: [{ cos_url: "https://example.invalid/test.png" }] }
      : original(cmd, args);
  const result = await f.bridge.content([
    { type: "image", mimeType: "image/png", data: "dGVzdA==" },
  ]);
  assert.deepEqual(result.attached_images, ["https://example.invalid/test.png"]);
});
test("additional directories require absolute paths and survive restart", async (t) => {
  const f = setup(t),
    s = await session(f);
  await assert.rejects(
    f.bridge.dispatch("_with/set_additional_directories", {
      sessionId: s.sessionId,
      directories: ["relative"],
    }),
  );
  await f.bridge.dispatch("_with/set_additional_directories", {
    sessionId: s.sessionId,
    directories: [f.dir, f.dir],
  });
  assert.deepEqual(f.bridge.store.get(s.sessionId).extraDirs, [path.resolve(f.dir)]);
});
test("cancel during send acknowledgement waits then cancels actual request", async (t) => {
  const f = setup(t),
    s = await session(f);
  let acknowledge;
  f.transport.stream = async () => {
    f.calls.push({ cmd: "chat_send" });
    await new Promise((r) => {
      acknowledge = r;
    });
    return () => {};
  };
  const done = f.bridge.prompt(prompt(s));
  await waitFor(() => acknowledge);
  const cancelled = f.bridge.cancel(s.sessionId);
  assert(!f.calls.some((c) => c.cmd === "chat_cancel"));
  acknowledge();
  await cancelled;
  assert.equal((await done).stopReason, "cancelled");
  assert(f.calls.some((c) => c.cmd === "chat_cancel"));
});
test("poll fallback emits missing final text instead of returning empty success", async (t) => {
  const f = setup(t),
    s = await session(f),
    done = f.bridge.prompt(prompt(s));
  await waitFor(() => f.calls.some((c) => c.cmd === "chat_send"));
  f.emit({ type: "RUN_STARTED", rawEvent: { message_id: "mid" } });
  f.emit({ type: "TEXT_MESSAGE_CONTENT", delta: "hel" });
  await waitFor(() => f.updates.some((u) => u.content?.text === "hel"));
  const original = f.transport.invoke;
  f.transport.invoke = async (cmd, args) =>
    cmd === "get_qa_message_detail"
      ? {
          status: "done",
          response: JSON.stringify({
            type: "TEXT_MESSAGE_CONTENT",
            rawEvent: { content: "hello" },
          }),
        }
      : original(cmd, args);
  await f.bridge.poll(f.bridge.get(s.sessionId), f.bridge.runs.get(s.sessionId));
  assert.equal((await done).stopReason, "end_turn");
  assert.equal(
    f.updates
      .filter((u) => u.sessionUpdate === "agent_message_chunk")
      .map((u) => u.content.text)
      .join(""),
    "hello",
  );
});
test("cross-session channel payload is ignored", async (t) => {
  const f = setup(t),
    s = await session(f),
    done = f.bridge.prompt(prompt(s));
  await waitFor(() => f.calls.some((c) => c.cmd === "chat_send"));
  f.emit({ type: "TEXT_MESSAGE_CONTENT", session_id: "other-session", delta: "wrong" });
  f.emit({ type: "RUN_FINISHED" });
  await done;
  assert(!f.updates.some((u) => u.content?.text === "wrong"));
});
