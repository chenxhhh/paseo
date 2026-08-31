import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Pressable, Text, View } from "react-native";
import type { PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { FolderOpen, Globe, Zap } from "lucide-react-native";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  MAX_QUICK_COMMAND_LABEL_LENGTH,
  MAX_QUICK_COMMAND_PROMPT_LENGTH,
  createQuickCommandId,
  quickCommandPromptPreview,
  type QuickCommand,
  type QuickCommandScope,
} from "./model";

const ThemedZap = withUnistyles(Zap);
const ThemedGlobe = withUnistyles(Globe);
const ThemedFolderOpen = withUnistyles(FolderOpen);

const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface QuickCommandsManageSheetProps {
  visible: boolean;
  /** Whether an opening sheet starts in the list or straight in the new-command editor. */
  initialMode: "list" | "new";
  onClose: () => void;
  /** Project the composer belongs to; null means no project context. */
  projectId: string | null;
  projectName: string | null;
  /** Commands visible in this composer (its project's plus the global ones). */
  commands: readonly QuickCommand[];
  onUpsert: (command: QuickCommand) => void;
  onRemove: (id: string) => void;
}

interface EditorState {
  mode: "new" | "edit";
  id: string | null;
  label: string;
  prompt: string;
  scope: QuickCommandScope;
}

export function QuickCommandsManageSheet({
  visible,
  initialMode,
  onClose,
  projectId,
  projectName,
  commands,
  onUpsert,
  onRemove,
}: QuickCommandsManageSheetProps) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasVisible = useRef(false);

  // Seeded when the sheet opens, so closing from the editor can keep the draft
  // while the sheet animates out without it reappearing on the next open.
  useEffect(() => {
    const opening = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (!opening) return;
    setEditor(null);
    setError(null);
    if (initialMode === "new") {
      setEditor({
        mode: "new",
        id: null,
        label: "",
        prompt: "",
        scope: projectId ? { type: "project", projectId } : { type: "global" },
      });
    }
  }, [initialMode, projectId, visible]);

  const openNew = useCallback(() => {
    setError(null);
    setEditor({
      mode: "new",
      id: null,
      label: "",
      prompt: "",
      scope: projectId ? { type: "project", projectId } : { type: "global" },
    });
  }, [projectId]);

  const openEdit = useCallback((command: QuickCommand) => {
    setError(null);
    setEditor({
      mode: "edit",
      id: command.id,
      label: command.label,
      prompt: command.prompt,
      scope: command.scope,
    });
  }, []);

  const closeEditor = useCallback(() => {
    setEditor(null);
    setError(null);
  }, []);

  const changeLabel = useCallback((label: string) => {
    setEditor((current) => (current === null ? current : { ...current, label }));
  }, []);

  const changePrompt = useCallback((prompt: string) => {
    setEditor((current) => (current === null ? current : { ...current, prompt }));
  }, []);

  const changeScope = useCallback(
    (value: string) => {
      setEditor((current) =>
        current === null
          ? current
          : {
              ...current,
              scope:
                value === "project" && projectId !== null
                  ? { type: "project", projectId }
                  : { type: "global" },
            },
      );
    },
    [projectId],
  );

  const handleSave = useCallback(() => {
    if (editor === null) return;
    const label = editor.label.trim().slice(0, MAX_QUICK_COMMAND_LABEL_LENGTH);
    const prompt = editor.prompt.trim().slice(0, MAX_QUICK_COMMAND_PROMPT_LENGTH);
    if (label.length === 0) {
      setError(t("composer.quickCommands.labelRequired"));
      return;
    }
    if (prompt.length === 0) {
      setError(t("composer.quickCommands.promptRequired"));
      return;
    }
    const scope: QuickCommandScope =
      editor.scope.type === "project" && projectId === null ? { type: "global" } : editor.scope;
    onUpsert({
      id: editor.mode === "edit" && editor.id !== null ? editor.id : createQuickCommandId(),
      label,
      prompt,
      scope,
    });
    setEditor(null);
    setError(null);
  }, [editor, onUpsert, projectId, t]);

  const handleDelete = useCallback(() => {
    if (editor?.mode !== "edit" || editor.id === null) return;
    const id = editor.id;
    const label = commands.find((command) => command.id === id)?.label ?? "";
    void (async () => {
      const confirmed = await confirmDialog({
        title: t("composer.quickCommands.deleteTitle"),
        message: t("composer.quickCommands.deleteMessage", { label }),
        confirmLabel: t("composer.quickCommands.delete"),
        destructive: true,
      });
      if (!confirmed) return;
      onRemove(id);
      setEditor(null);
      setError(null);
    })();
  }, [commands, editor, onRemove, t]);

  const scopeValue = editor?.scope.type === "project" ? "project" : "global";

  const headerTitle = resolveHeaderTitle(editor, t);
  const header = useMemo<SheetHeader>(() => ({ title: headerTitle }), [headerTitle]);

  const footer = useMemo(() => {
    if (editor === null) {
      return (
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={openNew}
          testID="quick-commands-add"
        >
          {t("composer.quickCommands.add")}
        </Button>
      );
    }
    return (
      <View style={styles.footerRow}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={closeEditor}
          testID="quick-commands-cancel"
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={handleSave}
          testID="quick-commands-save"
        >
          {t("composer.quickCommands.save")}
        </Button>
      </View>
    );
  }, [closeEditor, editor, handleSave, openNew, t]);

  const scopeHintText = resolveScopeHint(scopeValue, projectName, t);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      footer={footer}
      testID="quick-commands-manage-sheet"
    >
      {editor === null ? (
        <View style={settingsStyles.card} testID="quick-commands-list">
          {commands.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.iconChip}>
                <ThemedZap size={15} uniProps={iconForegroundMutedMapping} />
              </View>
              <Text style={styles.emptyText}>{t("composer.quickCommands.emptyManage")}</Text>
            </View>
          ) : (
            commands.map((command, index) => (
              <CommandRow
                key={command.id}
                command={command}
                projectName={projectName}
                withBorder={index > 0}
                onPress={openEdit}
              />
            ))
          )}
        </View>
      ) : (
        <View>
          <SettingsSection title={t("composer.quickCommands.labelLabel")}>
            <AdaptiveTextInput
              key={`label-${editor.id ?? "new"}`}
              initialValue={editor.label}
              onChangeText={changeLabel}
              placeholder={t("composer.quickCommands.labelPlaceholder")}
              maxLength={MAX_QUICK_COMMAND_LABEL_LENGTH}
              accessibilityLabel={t("composer.quickCommands.labelLabel")}
              testID="quick-commands-label-input"
            />
          </SettingsSection>
          <SettingsSection title={t("composer.quickCommands.promptLabel")}>
            <AdaptiveTextInput
              key={`prompt-${editor.id ?? "new"}`}
              initialValue={editor.prompt}
              onChangeText={changePrompt}
              placeholder={t("composer.quickCommands.promptPlaceholder")}
              maxLength={MAX_QUICK_COMMAND_PROMPT_LENGTH}
              multiline
              accessibilityLabel={t("composer.quickCommands.promptLabel")}
              testID="quick-commands-prompt-input"
            />
          </SettingsSection>
          {projectId !== null ? (
            <SettingsSection title={t("composer.quickCommands.scopeLabel")}>
              <SegmentedControl
                options={[
                  { value: "project", label: t("composer.quickCommands.scopeProject") },
                  { value: "global", label: t("composer.quickCommands.scopeGlobal") },
                ]}
                value={scopeValue}
                onValueChange={changeScope}
                testID="quick-commands-scope"
              />
              <View style={styles.scopePreviewRow}>
                <ScopeBadge scope={editor.scope} projectName={projectName} />
                <Text style={styles.scopeHint}>{scopeHintText}</Text>
              </View>
            </SettingsSection>
          ) : null}
          {editor.mode === "edit" ? (
            <Button variant="destructive" onPress={handleDelete} testID="quick-commands-delete">
              {t("composer.quickCommands.delete")}
            </Button>
          ) : null}
          {error !== null ? <Text style={settingsStyles.rowError}>{error}</Text> : null}
        </View>
      )}
    </AdaptiveModalSheet>
  );
}

function resolveHeaderTitle(editor: EditorState | null, t: TFunction): string {
  if (editor === null) return t("composer.quickCommands.sheetTitle");
  if (editor.mode === "new") return t("composer.quickCommands.newCommand");
  return t("composer.quickCommands.editCommand");
}

function resolveScopeHint(scopeValue: string, projectName: string | null, t: TFunction): string {
  if (scopeValue === "project") {
    return t("composer.quickCommands.scopeProjectHint", {
      project: projectName ?? t("composer.quickCommands.scopeProjectFallback"),
    });
  }
  return t("composer.quickCommands.scopeGlobalHint");
}

function ScopeBadge({
  scope,
  projectName,
}: {
  scope: QuickCommandScope;
  projectName: string | null;
}) {
  const { t } = useTranslation();
  const isGlobal = scope.type === "global";
  const leadingIcon = useMemo(
    () =>
      isGlobal ? (
        <ThemedGlobe size={11} uniProps={iconForegroundMutedMapping} />
      ) : (
        <ThemedFolderOpen size={11} uniProps={iconForegroundMutedMapping} />
      ),
    [isGlobal],
  );
  const label = isGlobal
    ? t("composer.quickCommands.sectionGlobal")
    : (projectName ?? t("composer.quickCommands.sectionProject"));
  return (
    <View style={styles.scopeBadge}>
      {leadingIcon}
      <Text style={styles.scopeBadgeText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function CommandRow({
  command,
  projectName,
  withBorder,
  onPress,
}: {
  command: QuickCommand;
  projectName: string | null;
  withBorder: boolean;
  onPress: (command: QuickCommand) => void;
}) {
  const handlePress = useCallback(() => onPress(command), [command, onPress]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.row,
      withBorder ? styles.rowBorder : null,
      hovered && !pressed ? styles.rowHovered : null,
      pressed ? styles.rowPressed : null,
    ],
    [withBorder],
  );
  return (
    <Pressable
      style={rowStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={command.label}
      testID={`quick-commands-row-${command.id}`}
    >
      <View style={styles.iconChip}>
        <ThemedZap size={15} uniProps={iconForegroundMutedMapping} />
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {command.label}
        </Text>
        <Text style={styles.rowHint} numberOfLines={1}>
          {quickCommandPromptPreview(command.prompt)}
        </Text>
      </View>
      <ScopeBadge scope={command.scope} projectName={projectName} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface0,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  iconChip: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  scopeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: 2,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    maxWidth: 140,
  },
  scopeBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  scopePreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
    flexWrap: "wrap",
  },
  scopeHint: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  emptyState: {
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  footerRow: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
}));
