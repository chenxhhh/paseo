import { describe, expect, it } from "vitest";
import type { AgentFeature } from "@getpaseo/protocol/agent-types";
import { knotCliPermissionNotice, visiblePermissionFeatures } from "./with-permissions";

const features: AgentFeature[] = [
  { type: "toggle", id: "auto_accept", label: "Auto Accept", value: true },
  {
    type: "select",
    id: "max_context_tokens",
    label: "Context",
    value: "",
    options: [],
  },
];

describe("With CLI permission presentation", () => {
  it.each(["with", "with-metadata"])("hides cached Auto Accept for %s", (provider) => {
    expect(visiblePermissionFeatures(provider, features)?.map((feature) => feature.id)).toEqual([
      "max_context_tokens",
    ]);
    expect(features).toHaveLength(2);
    expect(visiblePermissionFeatures(provider, undefined)).toBeUndefined();
    expect(knotCliPermissionNotice(provider, "zh-CN")).toContain("Paseo 不提供执行前确认");
    expect(knotCliPermissionNotice(provider, "en")).toContain("does not provide approval");
    expect(knotCliPermissionNotice(provider, "fr")).toContain("does not provide approval");
  });

  it.each(["with-desktop", "claude", "acp", "kimi", "with-custom"])(
    "leaves other providers unchanged: %s",
    (provider) => {
      expect(visiblePermissionFeatures(provider, features)).toBe(features);
      expect(knotCliPermissionNotice(provider, "en")).toBeNull();
    },
  );
});
