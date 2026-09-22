import {
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
} from "@getpaseo/protocol/workspace-labels";

/**
 * The user-assignable workflow status (board column). Orthogonal to the derived
 * activity bucket a workspace's status dot shows: that one reflects live agent
 * state, this one is a label the user placed.
 */
export interface WorkspaceStatusDefinition {
  id: string;
  label: string;
  color: WorkspaceLabelColor;
}

export const DEFAULT_WORKSPACE_STATUSES: readonly WorkspaceStatusDefinition[] = [
  { id: "todo", label: "Todo", color: "sky" },
  { id: "in-progress", label: "In progress", color: "amber" },
  { id: "in-review", label: "In review", color: "violet" },
  { id: "done", label: "Done", color: "emerald" },
] as const;

/** The lane unassigned or stale-assigned workspaces resolve to. */
export const DEFAULT_WORKSPACE_STATUS_ID = "in-progress";

const MAX_STATUS_LABEL_LENGTH = 32;
const WORKSPACE_STATUS_GROUP_PREFIX = "user-status:";

export function cloneDefaultWorkspaceStatuses(): WorkspaceStatusDefinition[] {
  return DEFAULT_WORKSPACE_STATUSES.map((status) => ({ ...status }));
}

function sanitizeStatusLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, MAX_STATUS_LABEL_LENGTH) : fallback;
}

function slugStatusLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "status";
}

function sanitizeStatusId(value: unknown, fallbackLabel: string): string {
  if (typeof value !== "string") {
    return slugStatusLabel(fallbackLabel);
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return slugStatusLabel(fallbackLabel);
  }
  return trimmed.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "status";
}

function sanitizeStatusColor(value: unknown, id: string, index: number): WorkspaceLabelColor {
  if (typeof value === "string" && WORKSPACE_LABEL_COLORS.some((color) => color === value)) {
    return value as WorkspaceLabelColor;
  }
  const defaultStatus = DEFAULT_WORKSPACE_STATUSES.find((status) => status.id === id);
  if (defaultStatus) {
    return defaultStatus.color;
  }
  return WORKSPACE_LABEL_COLORS[index % WORKSPACE_LABEL_COLORS.length];
}

export function makeWorkspaceStatusId(
  label: string,
  existingStatuses: readonly WorkspaceStatusDefinition[],
): string {
  const base = slugStatusLabel(label);
  const existingIds = new Set(existingStatuses.map((status) => status.id));
  if (!existingIds.has(base)) {
    return base;
  }
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }
  return `status-${Date.now().toString(36)}`;
}

/**
 * Coerces anything persisted or user-typed into a well-formed catalog: labels
 * trimmed and clamped, ids slugged and deduped, colors mapped to the palette.
 * An empty or invalid array falls back to the defaults so a board always has
 * at least one column to drop on.
 */
export function normalizeWorkspaceStatuses(value: unknown): WorkspaceStatusDefinition[] {
  if (!Array.isArray(value)) {
    return cloneDefaultWorkspaceStatuses();
  }

  const statuses: WorkspaceStatusDefinition[] = [];
  const usedIds = new Set<string>();
  for (const rawStatus of value) {
    if (!rawStatus || typeof rawStatus !== "object" || Array.isArray(rawStatus)) {
      continue;
    }
    const raw = rawStatus as Record<string, unknown>;
    const fallbackLabel = `Status ${statuses.length + 1}`;
    const label = sanitizeStatusLabel(raw.label, fallbackLabel);
    let id = sanitizeStatusId(raw.id, label);
    if (usedIds.has(id)) {
      id = makeWorkspaceStatusId(label, statuses);
    }
    usedIds.add(id);
    statuses.push({
      id,
      label,
      color: sanitizeStatusColor(raw.color, id, statuses.length),
    });
  }

  if (statuses.length === 0) {
    return cloneDefaultWorkspaceStatuses();
  }

  return statuses;
}

export function isWorkspaceStatusId(
  value: string,
  statuses: readonly WorkspaceStatusDefinition[],
): boolean {
  return statuses.some((status) => status.id === value);
}

export function getDefaultWorkspaceStatusId(
  statuses: readonly WorkspaceStatusDefinition[],
): string {
  return statuses.some((status) => status.id === DEFAULT_WORKSPACE_STATUS_ID)
    ? DEFAULT_WORKSPACE_STATUS_ID
    : (statuses[0]?.id ?? DEFAULT_WORKSPACE_STATUS_ID);
}

/**
 * Resolves a workspace's lane: its stored assignment when the catalog still
 * defines it, the default lane otherwise. A deleted status never strands a
 * workspace outside the board.
 */
export function getWorkspaceUserStatus(input: {
  userStatus: string | null | undefined;
  statuses: readonly WorkspaceStatusDefinition[];
}): string {
  return input.userStatus && isWorkspaceStatusId(input.userStatus, input.statuses)
    ? input.userStatus
    : getDefaultWorkspaceStatusId(input.statuses);
}

/**
 * When a status is removed, its workspaces move to the neighbor that takes its
 * place in the order (the next column, or the previous one when it was last).
 * The caller commits these through the assignment mutation.
 */
export function resolveStatusRemovalReassignment(input: {
  removedStatusId: string;
  statuses: readonly WorkspaceStatusDefinition[];
}): { reassignTo: string } {
  const remaining = input.statuses.filter((status) => status.id !== input.removedStatusId);
  const index = input.statuses.findIndex((status) => status.id === input.removedStatusId);
  const neighbor = remaining[Math.min(index < 0 ? 0 : index, remaining.length - 1)];
  return { reassignTo: neighbor ? neighbor.id : getDefaultWorkspaceStatusId(input.statuses) };
}

export function getWorkspaceStatusGroupKey(statusId: string): string {
  return `${WORKSPACE_STATUS_GROUP_PREFIX}${encodeURIComponent(statusId)}`;
}

export function getWorkspaceStatusFromGroupKey(
  groupKey: string,
  statuses: readonly WorkspaceStatusDefinition[],
): string | null {
  if (!groupKey.startsWith(WORKSPACE_STATUS_GROUP_PREFIX)) {
    return null;
  }
  try {
    const status = decodeURIComponent(groupKey.slice(WORKSPACE_STATUS_GROUP_PREFIX.length));
    return isWorkspaceStatusId(status, statuses) ? status : null;
  } catch {
    return null;
  }
}
