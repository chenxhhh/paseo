import type { SessionConfigOption, ClientSideConnection } from "@agentclientprotocol/sdk";
import { describe, expect, test, vi } from "vitest";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { ACPAgentSession, type SpawnedACPProcess } from "./acp-agent.js";
import { WithACPAgentClient, WITH_CONTEXT_FEATURE_OPTION } from "./with-acp-agent.js";

const modelIds = ["", "gpt-6-astra", "glm-5.3"];
function options(model = "", effort = "", context = ""): SessionConfigOption[] {
  return [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: model,
      options: modelIds.map((value) => ({ value, name: value || "Default" })),
    },
    {
      id: "reasoning_effort",
      name: "Reasoning Effort",
      category: "thought_level",
      type: "select",
      currentValue: effort,
      options:
        model === "gpt-6-astra"
          ? ["low", "medium", "high", "xhigh", "max"].map((value) => ({ value, name: value }))
          : [],
    },
    {
      id: "max_context_tokens",
      name: "Context Window",
      category: "model_config",
      type: "select",
      currentValue: context,
      options:
        model === "gpt-6-astra"
          ? [
              { value: "", name: "Default" },
              { value: "272000", name: "272K" },
            ]
          : [],
    },
  ];
}

function fixture(initialOptions = options()) {
  const close = vi.fn();
  const setSessionConfigOption = vi.fn(async ({ value }: { value: string }) => ({
    configOptions: options(value),
  }));
  const probe = {
    child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
    connection: {
      newSession: vi.fn().mockResolvedValue({ sessionId: "probe", configOptions: initialOptions }),
      setSessionConfigOption,
    },
    initialize: { agentCapabilities: {} },
  } as unknown as SpawnedACPProcess;
  class TestWithClient extends WithACPAgentClient {
    protected override async spawnProcess() {
      return probe;
    }
    protected override async closeProbe(_probe: SpawnedACPProcess, sessionId?: string | null) {
      close(sessionId);
    }
  }
  const client = new TestWithClient({ logger: createTestLogger(), command: ["knot-cli", "acp"] });
  return { client, probe, setSessionConfigOption, close };
}

async function catalog(client: WithACPAgentClient) {
  return client.fetchCatalog({ scope: "workspace", cwd: "C:/test", force: false });
}

describe("With ACP model options", () => {
  test("discovers real per-model effort choices from an empty default session", async () => {
    const f = fixture();
    const result = await catalog(f.client);
    expect(f.setSessionConfigOption.mock.calls.map(([call]) => call.value)).toEqual([
      "gpt-6-astra",
      "glm-5.3",
    ]);
    expect(
      result.models.find((m) => m.id === "gpt-6-astra")?.thinkingOptions?.map((o) => o.id),
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(result.models.find((m) => m.id === "glm-5.3")?.thinkingOptions).toBeUndefined();
    expect(f.close).toHaveBeenCalledWith("probe");
  });

  test("does not inherit another model's options on a failed or unconfirmed switch", async () => {
    const f = fixture(options("gpt-6-astra", "high"));
    f.setSessionConfigOption.mockImplementation(async ({ value }) => {
      if (value === "glm-5.3") throw new Error("unavailable");
      return { configOptions: options("") };
    });
    const result = await catalog(f.client);
    for (const model of result.models.filter((m) => m.id)) {
      expect(model.thinkingOptions).toBeUndefined();
      expect(model.defaultThinkingOptionId).toBeUndefined();
    }
    expect(f.close).toHaveBeenCalledWith("probe");
  });

  test("probes even a single concrete model when initial effort choices are empty", async () => {
    const initial = options();
    if (initial[0].type === "select") initial[0].options = [{ value: "gpt-6-astra", name: "GPT" }];
    const f = fixture(initial);
    expect((await catalog(f.client)).models[0].thinkingOptions).toHaveLength(5);
    expect(f.setSessionConfigOption).toHaveBeenCalledTimes(1);
  });

  test("selects the draft model before querying context choices", async () => {
    const f = fixture();
    const features = await f.client.listFeatures({
      provider: "acp",
      cwd: "C:/test",
      model: "gpt-6-astra",
    });
    expect(f.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "probe",
      configId: "model",
      value: "gpt-6-astra",
    });
    expect(features).toContainEqual(
      expect.objectContaining({
        id: "max_context_tokens",
        type: "select",
        value: "",
        options: [
          expect.objectContaining({ id: "", label: "Default" }),
          expect.objectContaining({ id: "272000", label: "272K" }),
        ],
      }),
    );
    expect(features.map((feature) => feature.id)).not.toContain("auto_accept");
    expect(f.close).toHaveBeenCalledWith("probe");
  });

  test("hides unsupported context controls instead of inventing choices", async () => {
    const f = fixture();
    const features = await f.client.listFeatures({
      provider: "acp",
      cwd: "C:/test",
      model: "glm-5.3",
    });
    expect(features).toEqual([]);
  });

  test("closes the feature probe if the model switch fails", async () => {
    const f = fixture();
    f.setSessionConfigOption.mockRejectedValue(new Error("not available"));
    await expect(
      f.client.listFeatures({ provider: "acp", cwd: "C:/test", model: "gpt-6-astra" }),
    ).rejects.toThrow("not available");
    expect(f.close).toHaveBeenCalledWith("probe");
  });
});

function sessionFixture(
  config: {
    model?: string;
    thinkingOptionId?: string;
    featureValues?: Record<string, unknown>;
  } = {},
) {
  let model = "";
  let effort = "";
  let context = "";
  const setSessionConfigOption = vi.fn(
    async ({ configId, value }: { configId: string; value: string }) => {
      if (configId === "model") {
        model = value;
        effort = "";
        context = "";
      }
      if (configId === "reasoning_effort") effort = value;
      if (configId === "max_context_tokens") context = value;
      return { configOptions: options(model, effort, context) };
    },
  );
  const session = new ACPAgentSession(
    { provider: "acp", cwd: "C:/test", ...config },
    {
      provider: "acp",
      logger: createTestLogger(),
      defaultCommand: ["knot-cli", "acp"],
      defaultModes: [],
      capabilities: new WithACPAgentClient({
        logger: createTestLogger(),
        command: ["knot-cli", "acp"],
      }).capabilities,
      configFeatureOptions: [WITH_CONTEXT_FEATURE_OPTION],
    },
  );
  const internals = session as unknown as {
    connection: ClientSideConnection;
    sessionId: string;
    configOptions: SessionConfigOption[];
    currentModel: string;
    thinkingOptionId: string;
    applyConfiguredOverrides(): Promise<void>;
  };
  internals.connection = { setSessionConfigOption } as unknown as ClientSideConnection;
  internals.sessionId = "session";
  internals.configOptions = options();
  internals.currentModel = "";
  internals.thinkingOptionId = "";
  return { session, internals, setSessionConfigOption };
}

describe("With ACP session configuration", () => {
  test.each([undefined, "with", "with-metadata", "with-desktop"])(
    "only the desktop bridge supports Auto Accept (%s)",
    (providerId) => {
      const client = new WithACPAgentClient({
        logger: createTestLogger(),
        command: ["knot-cli", "acp"],
        providerId,
      });
      expect(client.capabilities.supportsAutoAccept).toBe(providerId === "with-desktop");
    },
  );

  test.each([true, false])("hides saved Auto Accept=%s and rejects changes", async (value) => {
    const f = sessionFixture({ featureValues: { auto_accept: value } });
    expect(f.session.features.map((feature) => feature.id)).not.toContain("auto_accept");
    await expect(f.session.setFeature("auto_accept", value)).rejects.toThrow(
      "does not support ACP Auto Accept",
    );
    expect(f.setSessionConfigOption).not.toHaveBeenCalled();
  });

  test("does not auto-approve unexpected permission callbacks from a saved setting", async () => {
    const f = sessionFixture({ featureValues: { auto_accept: true } });
    const permission = f.session.requestPermission({
      sessionId: "session",
      toolCall: {
        toolCallId: "command",
        title: "Run command",
        kind: "execute",
        status: "pending",
      },
      options: [{ optionId: "allow-once", name: "Allow", kind: "allow_once" }],
    });
    const pending = f.session.getPendingPermissions();
    expect(pending).toHaveLength(1);
    await f.session.respondToPermission(pending[0].id, {
      behavior: "allow",
      selectedActionId: "allow-once",
    });
    await expect(permission).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
  });

  test.each(["glm-5.3", "gpt-6-astra"])(
    "ignores stale saved context values when restoring %s",
    async (model) => {
      const f = sessionFixture({ model, featureValues: { max_context_tokens: "1000000" } });
      await expect(f.internals.applyConfiguredOverrides()).resolves.toBeUndefined();
      expect(f.setSessionConfigOption.mock.calls.map(([call]) => call.configId)).toEqual(["model"]);
    },
  );

  test("applies model, effort, then context before the first prompt", async () => {
    const f = sessionFixture({
      model: "gpt-6-astra",
      thinkingOptionId: "high",
      featureValues: { max_context_tokens: "272000" },
    });
    await f.internals.applyConfiguredOverrides();
    expect(
      f.setSessionConfigOption.mock.calls.map(([call]) => [call.configId, call.value]),
    ).toEqual([
      ["model", "gpt-6-astra"],
      ["reasoning_effort", "high"],
      ["max_context_tokens", "272000"],
    ]);
    expect(f.session.features).toContainEqual(
      expect.objectContaining({ id: "max_context_tokens", value: "272000" }),
    );
    expect(await f.session.getRuntimeInfo()).toMatchObject({
      model: "gpt-6-astra",
      thinkingOptionId: "high",
    });
  });

  test("writes context changes including Default and rejects unsupported values", async () => {
    const f = sessionFixture();
    await f.session.setModel("gpt-6-astra");
    await f.session.setFeature("max_context_tokens", "272000");
    await f.session.setFeature("max_context_tokens", "");
    expect(f.session.features).toContainEqual(
      expect.objectContaining({ id: "max_context_tokens", value: "" }),
    );
    await expect(f.session.setFeature("max_context_tokens", "1000000")).rejects.toThrow(
      "does not include option",
    );
    await f.session.setModel("glm-5.3");
    expect(f.session.features.map((feature) => feature.id)).not.toContain("max_context_tokens");
  });
});
