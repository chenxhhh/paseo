import { useMemo, type ReactElement, type RefObject } from "react";
import { Text, View } from "react-native";
import type { TFunction } from "i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { GitBranch } from "lucide-react-native";
import {
  Combobox,
  ComboboxItem,
  type ComboboxOption,
  type ComboboxProps,
} from "@/components/ui/combobox";
import {
  getWorktreeSupportForHostProject,
  type HostProjectListItem,
} from "@/projects/host-projects";
import type { Theme } from "@/styles/theme";
import type { PickerCheckoutRequest } from "../new-workspace-picker-item";
import type { ExistingWorktreePickerEntry } from "./existing-worktree-picker";
import { FieldTrigger, type FieldTriggerVariant } from "./form/field-trigger";
import { branchIcon, folderGit2Icon, folderIcon } from "./form/icons";

export type IsolationMode = "local" | "worktree" | "existing-worktree";
export type PersistedIsolation = "local" | "worktree";

export interface WorktreeFormControl {
  anchorRef: RefObject<View | null>;
  open: () => void;
  openState: boolean;
  onOpenChange: (open: boolean) => void;
  show: boolean;
  selectedSourceDirectory: string | null;
  triggerLabel: string;
  options: ComboboxOption[];
  selectedOptionId: string;
  onSelect: (id: string) => void;
  emptyText: string;
  renderOption: NonNullable<ComboboxProps["renderOption"]>;
}

const ThemedGitBranch = withUnistyles(GitBranch);
const branchIconPropsMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

export function WorktreeOptionItem({
  optionId,
  label,
  description,
  selected,
  active,
  disabled,
  onPress,
  trailingLabel,
}: {
  optionId: string;
  label: string;
  description: string;
  selected: boolean;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
  trailingLabel: string | undefined;
}) {
  const leadingSlot = useMemo(
    () => (
      <View style={styles.rowIconBox}>
        <ThemedGitBranch uniProps={branchIconPropsMapping} />
      </View>
    ),
    [],
  );
  const trailingSlot = useMemo(
    () =>
      trailingLabel ? <Text style={styles.refDivergenceLabel}>{trailingLabel}</Text> : undefined,
    [trailingLabel],
  );
  return (
    <ComboboxItem
      testID={`new-workspace-worktree-picker-${optionId}`}
      label={label}
      description={description}
      selected={selected}
      active={active}
      disabled={disabled}
      onPress={onPress}
      leadingSlot={leadingSlot}
      trailingSlot={trailingSlot}
    />
  );
}

export function renderWorktreePickerOption(input: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  itemById: Map<string, ExistingWorktreePickerEntry>;
  isPending: boolean;
  t: TFunction;
}) {
  const { option, selected, active, onPress, itemById, isPending, t } = input;
  const item = itemById.get(option.id);
  if (!item) return <View key={option.id} />;
  return (
    <WorktreeOptionItem
      optionId={option.id}
      label={item.label}
      description={item.worktreePath}
      selected={selected}
      active={active}
      disabled={isPending}
      onPress={onPress}
      trailingLabel={item.inUse ? t("newWorkspace.worktreePicker.inUse") : undefined}
    />
  );
}

export function resolveEffectiveIsolation(input: {
  isolation: IsolationMode;
  canCreateWorktree: boolean;
}): IsolationMode {
  if (!input.canCreateWorktree) return "local";
  return input.isolation;
}

export function persistIsolationPreference(value: IsolationMode): PersistedIsolation | null {
  if (value === "existing-worktree") return null;
  return value;
}

export function multiplicityWorkspaceSource(input: {
  isolation: IsolationMode;
  sourceDirectory: string;
  existingWorktreePath: string | null;
  projectId: string;
  checkoutRequest: PickerCheckoutRequest | undefined;
  chooseWorktreeMessage: string;
  worktreeSlug: string;
}) {
  if (input.isolation === "worktree") {
    return {
      kind: "worktree" as const,
      cwd: input.sourceDirectory,
      projectId: input.projectId,
      worktreeSlug: input.worktreeSlug,
      ...input.checkoutRequest,
    };
  }
  if (input.isolation === "existing-worktree") {
    if (!input.existingWorktreePath) {
      throw new Error(input.chooseWorktreeMessage);
    }
    return {
      kind: "directory" as const,
      path: input.existingWorktreePath,
      projectId: input.projectId,
    };
  }
  return {
    kind: "directory" as const,
    path: input.sourceDirectory,
    projectId: input.projectId,
  };
}

export function existingWorktreePathForCreate(input: {
  isolation: IsolationMode;
  selectedWorktree: { worktreePath: string } | null;
  chooseWorktreeMessage: string;
}): string | null {
  if (input.isolation !== "existing-worktree") {
    return input.selectedWorktree?.worktreePath ?? null;
  }
  if (!input.selectedWorktree) {
    throw new Error(input.chooseWorktreeMessage);
  }
  return input.selectedWorktree.worktreePath;
}

export function resolveNewWorkspaceWorktreeSupport(input: {
  project: HostProjectListItem | null;
  serverId: string;
}): "supported" | "unsupported" | "unknown" {
  if (!input.project) return "unsupported";
  return getWorktreeSupportForHostProject({ project: input.project, serverId: input.serverId });
}

export function resetSelectionIfTargetChanged(input: {
  currentId: string;
  nextId: string;
  reset: () => void;
}): void {
  if (input.currentId !== input.nextId) {
    input.reset();
  }
}

export function isolationLabel(t: TFunction, isolation: IsolationMode): string {
  if (isolation === "worktree") return t("newWorkspace.isolation.worktree");
  if (isolation === "existing-worktree") return t("newWorkspace.isolation.existingWorktree");
  return t("newWorkspace.isolation.local");
}

export function isolationLeadingIcon(isolation: IsolationMode) {
  if (isolation === "worktree") return branchIcon;
  if (isolation === "existing-worktree") return folderGit2Icon;
  return folderIcon;
}

export function buildWorktreeControl(
  worktree: WorktreeFormControl,
  input: { variant: FieldTriggerVariant; t: TFunction; isPending: boolean },
): { field: ReactElement; picker: ReactElement } {
  const { variant, t, isPending } = input;
  const field = (
    <FieldTrigger
      ref={worktree.anchorRef}
      variant={variant}
      label={t("newWorkspace.worktreePicker.title")}
      accessibilityLabel={t("newWorkspace.worktreePicker.title")}
      tooltip={t("newWorkspace.tooltips.existingWorktree")}
      icon={folderGit2Icon}
      value={worktree.triggerLabel}
      onPress={worktree.open}
      disabled={isPending || !worktree.selectedSourceDirectory}
      testID="new-workspace-worktree-picker-trigger"
    />
  );
  const picker = (
    <Combobox
      options={worktree.options}
      value={worktree.selectedOptionId}
      onSelect={worktree.onSelect}
      searchable
      searchPlaceholder={t("newWorkspace.worktreePicker.searchPlaceholder")}
      title={t("newWorkspace.worktreePicker.title")}
      open={worktree.openState}
      onOpenChange={worktree.onOpenChange}
      desktopPlacement="bottom-start"
      anchorRef={worktree.anchorRef}
      emptyText={worktree.emptyText}
      renderOption={worktree.renderOption}
    />
  );
  return { field, picker };
}

const styles = StyleSheet.create((theme) => ({
  rowIconBox: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
  },
  refDivergenceLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
}));
