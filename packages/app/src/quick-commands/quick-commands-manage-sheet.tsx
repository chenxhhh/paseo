import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  MAX_QUICK_COMMAND_LABEL_LENGTH,
  MAX_QUICK_COMMAND_PROMPT_LENGTH,
  createQuickCommandId,
  type QuickCommand,
  type QuickCommandScope,
} from "./model";

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

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      footer={footer}
      testID="quick-commands-manage-sheet"
    >
      {editor === null ? (
        <SettingsSection title={t("composer.quickCommands.sheetTitle")} flush>
          <View style={settingsStyles.card} testID="quick-commands-list">
            {commands.length === 0 ? (
              <View style={settingsStyles.row}>
                <View style={settingsStyles.rowContent}>
                  <Text style={settingsStyles.rowHint}>
                    {t("composer.quickCommands.emptyManage")}
                  </Text>
                </View>
              </View>
            ) : (
              commands.map((command, index) => (
                <CommandRow
                  key={command.id}
                  command={command}
                  withBorder={index > 0}
                  onPress={openEdit}
                />
              ))
            )}
          </View>
        </SettingsSection>
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
              <Text style={styles.scopeHint}>
                {scopeValue === "project"
                  ? t("composer.quickCommands.scopeProjectHint", {
                      project: projectName ?? t("composer.quickCommands.scopeProjectFallback"),
                    })
                  : t("composer.quickCommands.scopeGlobalHint")}
              </Text>
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

function CommandRow({
  command,
  withBorder,
  onPress,
}: {
  command: QuickCommand;
  withBorder: boolean;
  onPress: (command: QuickCommand) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onPress(command), [command, onPress]);
  return (
    <Pressable
      style={[settingsStyles.row, withBorder ? settingsStyles.rowBorder : null]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={command.label}
      testID={`quick-commands-row-${command.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{command.label}</Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {command.scope.type === "global"
            ? t("composer.quickCommands.scopeGlobal")
            : t("composer.quickCommands.scopeProject")}{" "}
          · {command.prompt}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  footerRow: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
  scopeHint: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));
