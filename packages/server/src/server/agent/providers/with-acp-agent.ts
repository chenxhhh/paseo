import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { AgentModelDefinition, AgentSessionConfig } from "../agent-sdk-types.js";
import {
  type ACPCatalogModelResolverContext,
  type ACPConfigFeatureOption,
  type SpawnedACPProcess,
  deriveSelectorOptions,
  findSelectConfigOption,
} from "./acp-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";
import { toDiagnosticErrorMessage } from "./diagnostic-utils.js";

export const WITH_CONTEXT_FEATURE_OPTION: ACPConfigFeatureOption = {
  id: "max_context_tokens",
  configId: "max_context_tokens",
  category: "model_config",
  label: "Context Window",
  description: "Maximum context tokens advertised by With for the selected model",
  tooltip: "Select With context window",
  emptyOptionLabel: "Default",
  hideWhenEmpty: true,
  skipUnsupportedOnRestore: true,
};

// Knot's initial session uses an empty model id and has no reasoning choices.
// Query each concrete model in the disposable catalog session, not user sessions.
export async function resolveWithCatalogModels({
  connection,
  sessionId,
  models,
  configOptions,
  runRequest,
  transformConfigOptions,
  logger,
}: ACPCatalogModelResolverContext): Promise<AgentModelDefinition[]> {
  const modelOption = findSelectConfigOption({ configOptions, category: "model" });
  if (!modelOption) return models;

  const resolved: AgentModelDefinition[] = [];
  for (const model of models) {
    if (!model.id) {
      resolved.push(model);
      continue;
    }
    // Never inherit a different model's reasoning choices after a failed probe.
    const base = { ...model, thinkingOptions: undefined, defaultThinkingOptionId: undefined };
    try {
      const response = await runRequest(() =>
        connection.setSessionConfigOption({ sessionId, configId: modelOption.id, value: model.id }),
      );
      const options = transformConfigOptions(response.configOptions ?? []);
      if (
        findSelectConfigOption({ configOptions: options, category: "model" })?.currentValue !==
        model.id
      ) {
        throw new Error("With did not confirm the selected model");
      }
      const thinkingOptions = deriveSelectorOptions(options, "thought_level");
      resolved.push({
        ...base,
        thinkingOptions: thinkingOptions.length ? thinkingOptions : undefined,
        defaultThinkingOptionId: thinkingOptions.find((option) => option.isDefault)?.id,
      });
    } catch (error) {
      logger.warn(
        { modelId: model.id, error: toDiagnosticErrorMessage(error) },
        "With catalog probe could not resolve model thinking options",
      );
      resolved.push(base);
    }
  }
  return resolved;
}

export class WithACPAgentClient extends GenericACPAgentClient {
  constructor(options: ConstructorParameters<typeof GenericACPAgentClient>[0]) {
    super({
      ...options,
      catalogModelResolver: resolveWithCatalogModels,
      configFeatureOptions: [
        WITH_CONTEXT_FEATURE_OPTION,
        ...(options.providerId === "with-desktop"
          ? [
              {
                id: "enable_web_search",
                configId: "enable_web_search",
                category: "_tools",
                label: "Web Search",
                emptyOptionLabel: "Default",
              },
              {
                id: "enable_thinking",
                configId: "enable_thinking",
                category: "model_config",
                label: "Enable Thinking",
              },
            ]
          : []),
      ],
    });
  }

  protected override async resolveFeatureConfigOptions(
    probe: SpawnedACPProcess,
    sessionId: string,
    configOptions: SessionConfigOption[],
    config: AgentSessionConfig,
  ): Promise<SessionConfigOption[]> {
    const modelOption = findSelectConfigOption({ configOptions, category: "model" });
    if (!config.model || !modelOption || modelOption.currentValue === config.model)
      return configOptions;
    const selected = await probe.connection.setSessionConfigOption({
      sessionId,
      configId: modelOption.id,
      value: config.model,
    });
    const options = this.transformSessionResponse(selected).configOptions ?? [];
    if (
      findSelectConfigOption({ configOptions: options, category: "model" })?.currentValue !==
      config.model
    ) {
      throw new Error("With did not confirm the selected model for context options");
    }
    return options;
  }
}
