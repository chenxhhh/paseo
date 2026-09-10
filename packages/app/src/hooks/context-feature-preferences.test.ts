import { describe, expect, it } from "vitest";
import type { AgentFeature } from "@getpaseo/protocol/agent-types";
import {
  applyFeatureValues,
  pruneFeatureValues,
  resolveFeatureValues,
} from "./feature-preferences";

const features: AgentFeature[] = [
  {
    type: "select",
    id: "max_context_tokens",
    label: "Context Window",
    value: "",
    options: [
      { id: "", label: "Default" },
      { id: "272000", label: "272K" },
    ],
  },
];

describe("model-specific context preferences", () => {
  it("drops a persisted context size unsupported by the selected model", () => {
    expect(
      resolveFeatureValues({
        features,
        localFeatureValues: {},
        persistedFeatureValues: { max_context_tokens: "1000000" },
      }),
    ).toEqual({});
  });
  it("prunes unsupported local values when model choices change", () => {
    expect(pruneFeatureValues({ max_context_tokens: "1000000" }, features)).toEqual({});
    expect(pruneFeatureValues({ max_context_tokens: "272000" }, [])).toEqual({});
    expect(applyFeatureValues(features, { max_context_tokens: "1000000" })).toEqual(features);
  });
  it("preserves an explicit Default choice over a remembered context size", () => {
    expect(
      resolveFeatureValues({
        features,
        localFeatureValues: { max_context_tokens: "" },
        persistedFeatureValues: { max_context_tokens: "272000" },
      }),
    ).toEqual({ max_context_tokens: "" });
    expect(pruneFeatureValues({ max_context_tokens: "" }, features)).toEqual({
      max_context_tokens: "",
    });
  });
  it("uses a valid persisted value when a local value is stale", () => {
    expect(
      resolveFeatureValues({
        features,
        localFeatureValues: { max_context_tokens: "1000000" },
        persistedFeatureValues: { max_context_tokens: "272000" },
      }),
    ).toEqual({ max_context_tokens: "272000" });
  });
});
