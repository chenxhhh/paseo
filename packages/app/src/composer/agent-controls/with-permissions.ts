import type { AgentFeature } from "@getpaseo/protocol/agent-types";

export function usesKnotCliPermissions(provider: string): boolean {
  return provider === "with" || provider === "with-metadata";
}

export function visiblePermissionFeatures(
  provider: string,
  features: AgentFeature[] | undefined,
): AgentFeature[] | undefined {
  return usesKnotCliPermissions(provider)
    ? features?.filter((feature) => feature.id !== "auto_accept")
    : features;
}

export function knotCliPermissionNotice(provider: string, language: string): string | null {
  if (!usesKnotCliPermissions(provider)) return null;
  return language.toLowerCase().startsWith("zh")
    ? "权限由 Knot CLI 管理，Paseo 不提供执行前确认。工具可能直接修改文件或运行命令；Worktree 不是安全沙箱。"
    : "Permissions are managed by Knot CLI. Paseo does not provide approval before execution. Tools may modify files or run commands directly; a worktree is not a security sandbox.";
}
