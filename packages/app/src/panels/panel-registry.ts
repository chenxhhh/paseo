import type { ComponentType } from "react";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface PanelIconProps {
  size: number;
  color: string;
}

/**
 * How a provider-owned child ended, when it has ended. A completed child wears the done check; a
 * canceled one finished without succeeding and stays unmarked. Undefined for managed agents and
 * panels that have no terminal outcome of their own.
 */
export type PanelTerminalStatus = "completed" | "canceled";

export interface PanelDescriptor {
  label: string;
  subtitle: string;
  tooltip: string;
  titleState: "ready" | "loading";
  icon: ComponentType<PanelIconProps>;
  statusBucket: SidebarStateBucket | null;
  terminalStatus?: PanelTerminalStatus;
}

export interface PanelDescriptorContext {
  serverId: string;
  workspaceId: string;
  tabId: string;
}

export interface PanelRegistration<
  K extends WorkspaceTabTarget["kind"] = WorkspaceTabTarget["kind"],
> {
  kind: K;
  component: ComponentType;
  useDescriptor(
    target: Extract<WorkspaceTabTarget, { kind: K }>,
    context: PanelDescriptorContext,
  ): PanelDescriptor;
  resourceKey(target: Extract<WorkspaceTabTarget, { kind: K }>): string;
}

const panelRegistry = new Map<WorkspaceTabTarget["kind"], PanelRegistration>();

export function registerPanel<K extends WorkspaceTabTarget["kind"]>(
  registration: PanelRegistration<K>,
): void {
  panelRegistry.set(registration.kind, registration as unknown as PanelRegistration);
}

export function getPanelRegistration(
  kind: WorkspaceTabTarget["kind"],
): PanelRegistration | undefined {
  return panelRegistry.get(kind);
}
