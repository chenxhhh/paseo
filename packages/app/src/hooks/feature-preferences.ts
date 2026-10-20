import type { AgentFeature } from "@getpaseo/protocol/agent-types";

function acceptsFeatureValue(feature: AgentFeature, value: unknown): boolean {
  return feature.type !== "select" || feature.options.some((option) => option.id === value);
}

export function pruneFeatureValues(
  featureValues: Record<string, unknown>,
  features: AgentFeature[],
): Record<string, unknown> {
  const featuresById = new Map(features.map((feature) => [feature.id, feature]));
  let changed = false;
  const next: Record<string, unknown> = {};

  for (const [featureId, value] of Object.entries(featureValues)) {
    const feature = featuresById.get(featureId);
    if (!feature || !acceptsFeatureValue(feature, value)) {
      changed = true;
      continue;
    }
    next[featureId] = value;
  }

  return changed ? next : featureValues;
}

export function applyFeatureValues(
  features: AgentFeature[],
  featureValues: Record<string, unknown>,
): AgentFeature[] {
  if (Object.keys(featureValues).length === 0) {
    return features;
  }

  return features.map((feature) => {
    if (
      !Object.prototype.hasOwnProperty.call(featureValues, feature.id) ||
      !acceptsFeatureValue(feature, featureValues[feature.id])
    ) {
      return feature;
    }

    return {
      ...feature,
      value: featureValues[feature.id],
    } as AgentFeature;
  });
}

export function resolveFeatureValues(args: {
  features: AgentFeature[];
  persistedFeatureValues: Record<string, unknown>;
  localFeatureValues: Record<string, unknown>;
}): Record<string, unknown> {
  const next: Record<string, unknown> = {};

  for (const feature of args.features) {
    if (
      Object.prototype.hasOwnProperty.call(args.localFeatureValues, feature.id) &&
      acceptsFeatureValue(feature, args.localFeatureValues[feature.id])
    ) {
      next[feature.id] = args.localFeatureValues[feature.id];
      continue;
    }
    if (
      Object.prototype.hasOwnProperty.call(args.persistedFeatureValues, feature.id) &&
      acceptsFeatureValue(feature, args.persistedFeatureValues[feature.id])
    ) {
      next[feature.id] = args.persistedFeatureValues[feature.id];
    }
  }

  return next;
}
