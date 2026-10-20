import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowLeft, ArrowRight, Check, Pencil, Plus, Trash2 } from "lucide-react-native";
import type { WorkspaceLabelColor } from "@getpaseo/protocol/workspace-labels";
import type { Theme } from "@/styles/theme";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { WorkspaceLabelSwatchRow } from "@/workspace-labels/swatch";
import { useWorkspaceStatusStore } from "@/stores/workspace-status-store";
import {
  resolveStatusRemovalReassignment,
  type WorkspaceStatusDefinition,
} from "@/utils/workspace-statuses";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedCheck = withUnistyles(Check);
const ThemedPencil = withUnistyles(Pencil);
const ThemedPlus = withUnistyles(Plus);
const ThemedTrash2 = withUnistyles(Trash2);

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentIconMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });

/**
 * The board's column manager: the status catalog as one sheet. Rename, recolour,
 * reorder, retire, add. Retiring a column reassigns its workspaces to the
 * neighbour that takes its place — the caller commits those, the sheet decides.
 */
export function BoardManageSheet({
  open,
  onClose,
  onRetire,
}: {
  open: boolean;
  onClose: () => void;
  /** Commits the reassignment of every workspace on the retired status. */
  onRetire: (retiredStatusId: string, reassignToStatusId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const statuses = useWorkspaceStatusStore((state) => state.statuses);
  const addStatus = useWorkspaceStatusStore((state) => state.addStatus);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const closeRenaming = useCallback(() => setRenamingId(null), []);
  const submitRenaming = useCallback(
    (value: string) => {
      useWorkspaceStatusStore.getState().renameStatus(renamingId ?? "", value);
    },
    [renamingId],
  );
  const openCreating = useCallback(() => setCreating(true), []);
  const closeCreating = useCallback(() => setCreating(false), []);
  const submitCreating = useCallback(
    (value: string) => {
      addStatus(value);
      setCreating(false);
    },
    [addStatus],
  );
  const removeStatus = useCallback(
    (statusId: string) => {
      const { reassignTo } = resolveStatusRemovalReassignment({
        removedStatusId: statusId,
        statuses,
      });
      useWorkspaceStatusStore.getState().removeStatus(statusId);
      onRetire(statusId, reassignTo);
    },
    [onRetire, statuses],
  );

  const sheetHeader = useMemo<SheetHeader>(
    () => ({ title: t("workspaceStatus.manage.title") }),
    [t],
  );

  return (
    <>
      <AdaptiveModalSheet
        visible={open}
        onClose={onClose}
        desktopMaxWidth={480}
        header={sheetHeader}
      >
        <View style={styles.sheetBody} testID="board-manage-sheet">
          {statuses.map((status, index) => (
            <ManageStatusRow
              key={status.id}
              status={status}
              index={index}
              isLast={index === statuses.length - 1}
              canRemove={statuses.length > 1}
              onRemove={removeStatus}
            />
          ))}
          <Pressable style={styles.addButton} onPress={openCreating} testID="board-manage-add">
            <ThemedPlus size={14} uniProps={mutedIconMapping} />
            <Text style={styles.addButtonText}>{t("workspaceStatus.manage.add")}</Text>
          </Pressable>
          <Pressable style={styles.doneButton} onPress={onClose} testID="board-manage-done">
            <ThemedCheck size={14} uniProps={accentIconMapping} />
            <Text style={styles.doneButtonText}>{t("workspaceStatus.manage.done")}</Text>
          </Pressable>
        </View>
      </AdaptiveModalSheet>
      <AdaptiveRenameModal
        visible={renamingId !== null}
        title={t("workspaceStatus.manage.renameTitle")}
        initialValue={statuses.find((status) => status.id === renamingId)?.label ?? ""}
        onClose={closeRenaming}
        onSubmit={submitRenaming}
        testID="board-manage-rename-modal"
      />
      <AdaptiveRenameModal
        visible={creating}
        title={t("workspaceStatus.manage.addTitle")}
        initialValue=""
        placeholder={t("workspaceStatus.manage.namePlaceholder")}
        onClose={closeCreating}
        onSubmit={submitCreating}
        testID="board-manage-create-modal"
      />
    </>
  );
}

function ManageStatusRow({
  status,
  index,
  isLast,
  canRemove,
  onRemove,
}: {
  status: WorkspaceStatusDefinition;
  index: number;
  isLast: boolean;
  canRemove: boolean;
  onRemove: (statusId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const moveStatus = useWorkspaceStatusStore((state) => state.moveStatus);
  const setStatusColor = useWorkspaceStatusStore((state) => state.setStatusColor);
  const [renaming, setRenaming] = useState(false);

  const openRenaming = useCallback(() => setRenaming(true), []);
  const closeRenaming = useCallback(() => setRenaming(false), []);
  const submitRenaming = useCallback(
    (value: string) => {
      useWorkspaceStatusStore.getState().renameStatus(status.id, value);
    },
    [status.id],
  );
  const changeColor = useCallback(
    (color: WorkspaceLabelColor) => setStatusColor(status.id, color),
    [setStatusColor, status.id],
  );
  const moveLeft = useCallback(() => moveStatus(status.id, -1), [moveStatus, status.id]);
  const moveRight = useCallback(() => moveStatus(status.id, 1), [moveStatus, status.id]);
  const remove = useCallback(() => onRemove(status.id), [onRemove, status.id]);

  return (
    <>
      <View style={styles.statusRow}>
        <View style={styles.statusRowMain}>
          <Pressable
            style={styles.statusNameButton}
            onPress={openRenaming}
            testID={`board-manage-rename-${status.id}`}
          >
            <Text style={styles.statusName} numberOfLines={1}>
              {status.label}
            </Text>
            <ThemedPencil size={12} uniProps={mutedIconMapping} />
          </Pressable>
          <WorkspaceLabelSwatchRow
            value={status.color}
            onChange={changeColor}
            testID={`board-manage-colors-${status.id}`}
          />
        </View>
        <View style={styles.statusRowActions}>
          <Pressable
            hitSlop={6}
            disabled={index === 0}
            onPress={moveLeft}
            accessibilityLabel={t("workspaceStatus.manage.moveLeft")}
            testID={`board-manage-left-${status.id}`}
          >
            <ThemedArrowLeft size={14} uniProps={index === 0 ? undefined : mutedIconMapping} />
          </Pressable>
          <Pressable
            hitSlop={6}
            disabled={isLast}
            onPress={moveRight}
            accessibilityLabel={t("workspaceStatus.manage.moveRight")}
            testID={`board-manage-right-${status.id}`}
          >
            <ThemedArrowRight size={14} uniProps={isLast ? undefined : mutedIconMapping} />
          </Pressable>
          <Pressable
            hitSlop={6}
            disabled={!canRemove}
            onPress={remove}
            accessibilityLabel={t("workspaceStatus.manage.remove")}
            testID={`board-manage-remove-${status.id}`}
          >
            <ThemedTrash2 size={14} uniProps={canRemove ? mutedIconMapping : undefined} />
          </Pressable>
        </View>
      </View>
      <AdaptiveRenameModal
        visible={renaming}
        title={t("workspaceStatus.manage.renameTitle")}
        initialValue={status.label}
        onClose={closeRenaming}
        onSubmit={submitRenaming}
        testID={`board-manage-rename-modal-${status.id}`}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  sheetBody: {
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[3],
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  statusRowMain: {
    flexDirection: "column",
    gap: theme.spacing[1.5],
    flexShrink: 1,
    minWidth: 0,
  },
  statusNameButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  statusName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    flexShrink: 1,
    minWidth: 0,
  },
  statusRowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
  },
  addButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  doneButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.accent,
  },
  doneButtonText: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
}));
