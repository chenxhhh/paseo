import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Rows2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettings } from "@/hooks/use-settings";
import type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { TOOL_CALL_DETAIL_LEVEL_ORDER } from "@/tool-calls/detail-level/levels";

interface ToolCallDetailMenuProps {
  testID?: string;
}

const ThemedRows2 = withUnistyles(Rows2);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export const ToolCallDetailMenu = memo(function ToolCallDetailMenu({
  testID = "tool-call-detail-menu",
}: ToolCallDetailMenuProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const currentLevel = useSettings((state) => state.toolCallDetailLevel);
  const { updateSettings } = useSettings();

  const handleOpenChange = useCallback((next: boolean) => setIsOpen(next), []);

  const handleSelect = useCallback(
    (level: ToolCallDetailLevel) => () => {
      void updateSettings({ toolCallDetailLevel: level });
    },
    [updateSettings],
  );

  const selectedLabel = t(`settings.general.toolCallDetail.options.${currentLevel}`);
  const tooltipContent = (
    <TooltipContent side="top" align="center" offset={8}>
      <Text style={styles.tooltipText}>
        {t("settings.general.toolCallDetail.accessibilityLabel", { value: selectedLabel })}
      </Text>
    </TooltipContent>
  );

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <View style={styles.triggerSlot} collapsable={false}>
            <DropdownMenuTrigger
              accessibilityLabel={t("settings.general.toolCallDetail.accessibilityLabel", {
                value: selectedLabel,
              })}
              accessibilityRole="button"
              style={styles.trigger}
              testID={`${testID}-trigger`}
            >
              {({ hovered, open }) => (
                <ThemedRows2
                  size={ICON_SIZE.sm}
                  uniProps={hovered || open ? foregroundColorMapping : foregroundMutedColorMapping}
                />
              )}
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        {tooltipContent}
      </Tooltip>
      <DropdownMenuContent align="start" minWidth={220} side="bottom" testID={`${testID}-content`}>
        {TOOL_CALL_DETAIL_LEVEL_ORDER.map((level) => (
          <DropdownMenuItem
            key={level}
            selected={level === currentLevel}
            onSelect={handleSelect(level)}
            testID={`${testID}-${level}`}
          >
            {t(`settings.general.toolCallDetail.options.${level}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  triggerSlot: {
    alignSelf: "center",
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
