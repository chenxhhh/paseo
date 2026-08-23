import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ListPlus, Settings2, Zap } from "lucide-react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";
import { useQuickCommands } from "./use-quick-commands";
import { QuickCommandsManageSheet } from "./quick-commands-manage-sheet";
import type { QuickCommand } from "./model";

const ThemedZap = withUnistyles(Zap);
const ThemedListPlus = withUnistyles(ListPlus);
const ThemedSettings2 = withUnistyles(Settings2);

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface QuickCommandsButtonProps {
  /** Project the composer belongs to; null means no project context (global commands only). */
  projectId: string | null;
  projectName: string | null;
  onInsert: (prompt: string) => void;
  disabled?: boolean;
}

/**
 * Composer toolbar trigger for quick commands: preset prompts stored per
 * project or globally. Selecting one inserts its prompt at the cursor.
 */
export function QuickCommandsButton({
  projectId,
  projectName,
  onInsert,
  disabled = false,
}: QuickCommandsButtonProps) {
  const { t } = useTranslation();
  const { commands, upsert, remove } = useQuickCommands(projectId);
  const [manageSheet, setManageSheet] = useState<"closed" | "list" | "new">("closed");

  const projectCommands = useMemo(
    () => commands.filter((command) => command.scope.type === "project"),
    [commands],
  );
  const globalCommands = useMemo(
    () => commands.filter((command) => command.scope.type === "global"),
    [commands],
  );

  const handleInsert = useCallback(
    (command: QuickCommand) => {
      onInsert(command.prompt);
    },
    [onInsert],
  );

  const handleNew = useCallback(() => {
    setManageSheet("new");
  }, []);

  const handleManage = useCallback(() => {
    setManageSheet("list");
  }, []);

  const handleSheetClose = useCallback(() => {
    setManageSheet("closed");
  }, []);

  const newListIcon = useMemo(
    () => <ThemedListPlus size={16} uniProps={iconForegroundMutedMapping} />,
    [],
  );
  const newManageIcon = useMemo(
    () => <ThemedSettings2 size={16} uniProps={iconForegroundMutedMapping} />,
    [],
  );

  const triggerLabel = t("composer.quickCommands.trigger");
  const triggerStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [
      styles.trigger,
      Boolean(hovered) && styles.triggerHovered,
    ],
    [],
  );
  const renderTriggerIcon = useCallback(({ hovered }: { hovered?: boolean }) => {
    const colorMapping = hovered ? iconForegroundMapping : iconForegroundMutedMapping;
    return <ThemedZap size={16} uniProps={colorMapping} />;
  }, []);

  return (
    <>
      <DropdownMenu compactMode="sheet">
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger
              disabled={disabled}
              accessibilityLabel={triggerLabel}
              accessibilityRole="button"
              testID="composer-quick-commands-button"
              style={triggerStyle}
            >
              {renderTriggerIcon}
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{triggerLabel}</Text>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          side="top"
          align="start"
          offset={8}
          minWidth={240}
          sheetTitle={triggerLabel}
          testID="composer-quick-commands-menu"
        >
          {commands.length === 0 ? (
            <DropdownMenuLabel>{t("composer.quickCommands.empty")}</DropdownMenuLabel>
          ) : null}
          {projectCommands.length > 0 && projectId !== null ? (
            <DropdownMenuLabel>{t("composer.quickCommands.sectionProject")}</DropdownMenuLabel>
          ) : null}
          {projectCommands.map((command) => (
            <CommandMenuItem key={command.id} command={command} onSelect={handleInsert} />
          ))}
          {projectCommands.length > 0 && globalCommands.length > 0 ? (
            <DropdownMenuSeparator />
          ) : null}
          {globalCommands.length > 0 ? (
            <DropdownMenuLabel>{t("composer.quickCommands.sectionGlobal")}</DropdownMenuLabel>
          ) : null}
          {globalCommands.map((command) => (
            <CommandMenuItem key={command.id} command={command} onSelect={handleInsert} />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={handleNew}
            leading={newListIcon}
            testID="composer-quick-commands-new"
          >
            {t("composer.quickCommands.newCommand")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={handleManage}
            leading={newManageIcon}
            testID="composer-quick-commands-manage"
          >
            {t("composer.quickCommands.manage")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <QuickCommandsManageSheet
        visible={manageSheet !== "closed"}
        initialMode={manageSheet === "new" ? "new" : "list"}
        onClose={handleSheetClose}
        projectId={projectId}
        projectName={projectName}
        commands={commands}
        onUpsert={upsert}
        onRemove={remove}
      />
    </>
  );
}

function CommandMenuItem({
  command,
  onSelect,
}: {
  command: QuickCommand;
  onSelect: (command: QuickCommand) => void;
}) {
  const handleSelect = useCallback(() => onSelect(command), [command, onSelect]);
  return (
    <DropdownMenuItem onSelect={handleSelect} testID={`composer-quick-commands-item-${command.id}`}>
      {command.label}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
