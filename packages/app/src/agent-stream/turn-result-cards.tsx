import { memo, useCallback } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AttachmentFrame } from "@/components/attachment-pill";
import { DiffStat } from "@/components/diff-stat";
import { FileChangeIcon } from "@/components/file-change-icon";
import type { Theme } from "@/styles/theme";
import type { TurnResultFileCard, TurnResultWebCard } from "./turn-collapse";

export interface TurnResultCardsRowProps {
  files: TurnResultFileCard[];
  webPages: TurnResultWebCard[];
  onOpenFile: (path: string) => void;
  onOpenChanges: () => void;
  onOpenWebUrl: (url: string) => void;
}

const MAX_VISIBLE_FILE_CARDS = 6;
const ThemedGlobe = withUnistyles(Globe);
const globeColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function fileBasename(path: string): string {
  const segments = path.split(/[/\\]/);
  return segments.at(-1) || path;
}

function fileChangeKind(file: TurnResultFileCard): "added" | "deleted" | "modified" {
  if (file.additions === 0) {
    return "deleted";
  }
  if (file.deletions === 0) {
    return "added";
  }
  return "modified";
}

const FileResultCard = memo(function FileResultCard({
  file,
  onOpenFile,
}: {
  file: TurnResultFileCard;
  onOpenFile: (path: string) => void;
}) {
  const { t } = useTranslation();
  const basename = fileBasename(file.path);
  const handlePress = useCallback(() => onOpenFile(file.path), [file.path, onOpenFile]);
  return (
    <AttachmentFrame
      onPress={handlePress}
      accessibilityLabel={t("message.turnResult.fileCardAccessibility", { name: basename })}
      testID="turn-result-file-card"
    >
      <View style={styles.fileCardBody}>
        <FileChangeIcon change={fileChangeKind(file)} />
        <Text style={styles.fileCardName} numberOfLines={1}>
          {basename}
        </Text>
        <DiffStat
          additions={file.additions}
          deletions={file.deletions > 0 ? file.deletions : undefined}
          testID="turn-result-file-diff-stat"
        />
      </View>
    </AttachmentFrame>
  );
});

const WebResultCard = memo(function WebResultCard({
  page,
  onOpenWebUrl,
}: {
  page: TurnResultWebCard;
  onOpenWebUrl: (url: string) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onOpenWebUrl(page.url), [onOpenWebUrl, page.url]);
  return (
    <AttachmentFrame
      onPress={handlePress}
      accessibilityLabel={t("message.turnResult.webCardAccessibility", { title: page.title })}
      testID="turn-result-web-card"
    >
      <View style={styles.fileCardBody}>
        <ThemedGlobe size={16} uniProps={globeColorMapping} />
        <View style={styles.labelTextColumn}>
          <Text style={styles.labelTitle} numberOfLines={1}>
            {page.title}
          </Text>
          <Text style={styles.labelSubtitle} numberOfLines={1}>
            {page.hostname}
          </Text>
        </View>
      </View>
    </AttachmentFrame>
  );
});

const MoreFilesCard = memo(function MoreFilesCard({
  count,
  onOpenChanges,
}: {
  count: number;
  onOpenChanges: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AttachmentFrame
      onPress={onOpenChanges}
      accessibilityLabel={t("message.turnResult.moreFiles", { count })}
      testID="turn-result-more-card"
    >
      <View style={styles.fileCardBody}>
        <FileChangeIcon change="modified" />
        <View style={styles.labelTextColumn}>
          <Text style={styles.labelTitle} numberOfLines={1}>
            {t("message.turnResult.moreFiles", { count })}
          </Text>
          <Text style={styles.labelSubtitle} numberOfLines={1}>
            {t("message.turnResult.changesSubtitle")}
          </Text>
        </View>
      </View>
    </AttachmentFrame>
  );
});

export const TurnResultCardsRow = memo(function TurnResultCardsRow({
  files,
  webPages,
  onOpenFile,
  onOpenChanges,
  onOpenWebUrl,
}: TurnResultCardsRowProps) {
  const visibleFiles = files.slice(0, MAX_VISIBLE_FILE_CARDS);
  const overflowCount = files.length - visibleFiles.length;
  return (
    <View style={styles.row}>
      {visibleFiles.map((file) => (
        <FileResultCard key={file.path} file={file} onOpenFile={onOpenFile} />
      ))}
      {overflowCount > 0 ? (
        <MoreFilesCard count={overflowCount} onOpenChanges={onOpenChanges} />
      ) : null}
      {webPages.map((page) => (
        <WebResultCard key={page.url} page={page} onOpenWebUrl={onOpenWebUrl} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    columnGap: theme.spacing[2],
    rowGap: theme.spacing[2],
    flexWrap: "wrap",
  },
  fileCardBody: {
    height: 48,
    maxWidth: 260,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
  },
  fileCardName: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  labelTextColumn: {
    minWidth: 0,
    flexShrink: 1,
  },
  labelTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  labelSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
