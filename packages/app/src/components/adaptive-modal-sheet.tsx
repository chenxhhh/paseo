import { useOverlayRegistration, type KeyboardInputEvent } from "@/keyboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Keyboard, Pressable, Text, View } from "react-native";
import type { DimensionValue, StyleProp, ViewProps, ViewStyle } from "react-native";
import { StyleSheet, useUnistyles, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getOverlayRoot, OverlayLayerProvider, useGlobalOverlayLayer } from "../lib/overlay-root";
import {
  BottomSheetHandle,
  useBottomSheetGestureHandlers,
  type BottomSheetBackgroundProps,
} from "@gorhom/bottom-sheet";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { ArrowLeft, Maximize2, Minimize2, Search, X, type LucideIcon } from "lucide-react-native";
import {
  IsolatedBottomSheetModal,
  SheetVisibleFrame,
  type ContextBridge,
  useIsolatedBottomSheetVisibility,
} from "@/components/ui/isolated-bottom-sheet-modal";
import { getCompactSheetSafeAreaPadding } from "@/components/adaptive-modal-sheet-layout";
import { ScrollView } from "@/components/ui/scroll-view";
import { isWeb } from "@/constants/platform";
import { useKeyboardVisibility } from "@/hooks/use-keyboard-visibility";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
export { AdaptiveTextInput, type AdaptiveTextInputProps } from "@/components/adaptive-text-input";

// Horizontal indent token shared by the sheet header (title, back arrow,
// leading icon, search input icon) and any row primitive rendered inside the
// sheet body. Rows whose leading icon should line up with the header must
// match this padding.
export const SHEET_HORIZONTAL_PADDING_SCALE = 6;

// The header's close button grows outward from its glyph, so the glyph's
// trailing rail is the content inset plus this padding. Rows whose trailing
// glyph should line up with the X must reach the same rail.
export const SHEET_HEADER_CLOSE_PADDING_SCALE = 2;

/** The one height a sheet takes when it shows a whole pane rather than sizing to its content. */
export const FULL_SHEET_SNAP_POINTS = ["92%"];

export interface SheetHeaderSearch {
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  resetKey?: string | number;
  placeholder?: string;
  autoFocus?: boolean;
  testID?: string;
}

export interface SheetHeaderBack {
  onPress: () => void;
  label?: string;
  accessibilityLabel?: string;
}

export interface SheetHeader {
  title: string;
  subtitle?: ReactNode;
  back?: SheetHeaderBack;
  leading?: ReactNode;
  actions?: ReactNode;
  search?: SheetHeaderSearch;
}

const SCROLL_CONTENT_GROW = { flexGrow: 1 };
const ABSOLUTE_FILL_STYLE = { ...StyleSheet.absoluteFill };
const NATIVE_DIALOG_SNAP_POINTS = ["100%"];

const styles = StyleSheet.create((theme) => ({
  nativeDialogSurface: {
    flex: 1,
  },
  nativeDialogBackground: {
    backgroundColor: "transparent",
  },
  desktopOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing[6],
    pointerEvents: "auto" as const,
  },
  desktopCard: {
    overflow: "hidden",
    width: "100%",
    maxWidth: 520,
    maxHeight: "85%",
    flexShrink: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
  },
  headerContainer: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surface2,
  },
  headerRow: {
    paddingHorizontal: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    paddingVertical: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  headerBackButton: {
    borderRadius: theme.borderRadius.lg,
  },
  headerLeadingSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitleGroup: {
    flex: 1,
    gap: theme.spacing[1],
    minWidth: 0,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  closeButton: {
    padding: theme.spacing[SHEET_HEADER_CLOSE_PADDING_SCALE],
    borderRadius: theme.borderRadius.lg,
  },
  // Without a header the close button floats over the card's top-right corner.
  floatingClose: {
    position: "absolute",
    top: theme.spacing[4],
    right: theme.spacing[4],
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    paddingBottom: theme.spacing[3],
  },
  // Inline variants for InlineHeaderView inside the desktop Combobox popover.
  // Horizontal padding matches the model picker's row indent: the picker uses
  // children mode (desktopChildrenScrollContent, no scroll padding), so the
  // row content starts at item.paddingHorizontal = spacing[3].
  // The search row below owns the gap under the title: the input already
  // carries its own vertical padding, so a paddingBottom here would stack on
  // top of two more and push the title far off the field.
  inlineHeaderRow: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  inlineSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  inlineTitle: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  searchInput: {
    flex: 1,
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  desktopScrollContainer: {
    // Grows only when the card has an explicit `desktopHeight`; a content-sized
    // card has nothing to grow into. Without it a fixed-height card with short
    // content leaves the footer stranded in the middle.
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    position: "relative",
  },
  desktopScroll: {
    flexShrink: 1,
    minHeight: 0,
  },
  // The sheet's content inset — one definition for every presentation, always
  // applied through <SheetContent />.
  sheetContent: {
    padding: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    gap: theme.spacing[4],
  },
  contentGrow: {
    flexGrow: 1,
  },
  compactStaticContent: {
    flex: 1,
    minHeight: 0,
  },
  bottomSheetVisibleScroll: {
    flex: 1,
    minHeight: 0,
  },
  desktopStaticContent: {
    flexShrink: 1,
    minHeight: 0,
  },
  footer: {
    paddingHorizontal: theme.spacing[SHEET_HORIZONTAL_PADDING_SCALE],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.surface2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
}));

const WEB_EXIT_DURATION_MS = 160;
const WEB_ENTER_DURATION_MS = 160;
const WEB_ENTER_ANIMATION_NAME = "paseo-modal-enter";

// The desktop card fades in; the dim lands at once, so the screen behind is never seen undimmed
// while the dialog arrives. A CSS animation runs from the card's first paint, so a dialog that opens
// on its own, like first-run setup, never pops in. Closing fades the whole overlay. With reduced
// motion the keyframes are never defined, so the card appears at once.
function ensureWebEnterKeyframes() {
  if (!isWeb || typeof document === "undefined") return;
  if (document.getElementById(WEB_ENTER_ANIMATION_NAME)) return;
  const style = document.createElement("style");
  style.id = WEB_ENTER_ANIMATION_NAME;
  style.textContent = `@media (prefers-reduced-motion: no-preference) { @keyframes ${WEB_ENTER_ANIMATION_NAME} { from { opacity: 0; } to { opacity: 1; } } }`;
  document.head.appendChild(style);
}
ensureWebEnterKeyframes();
// The CSS animation props are not part of ViewStyle without the generated expo-env.d.ts.
const WEB_ENTER_STYLE = {
  animationName: WEB_ENTER_ANIMATION_NAME,
  animationDuration: `${WEB_ENTER_DURATION_MS}ms`,
  animationTimingFunction: "ease-out",
} as unknown as ViewStyle;

/** The compact sheet's surface: Gorhom's `backgroundComponent` for every bottom sheet. */
export function SheetBackground({ style }: BottomSheetBackgroundProps) {
  const { theme } = useUnistyles();
  const combinedStyle = useMemo(
    () => [
      style,
      {
        backgroundColor: theme.colors.surface0,
        borderTopLeftRadius: theme.borderRadius["2xl"],
        borderTopRightRadius: theme.borderRadius["2xl"],
      },
    ],
    [style, theme.colors.surface0, theme.borderRadius],
  );
  return <Animated.View pointerEvents="none" style={combinedStyle} />;
}

const ThemedBottomSheetHandle = withUnistyles(BottomSheetHandle, (theme) => ({
  indicatorStyle: { backgroundColor: theme.colors.palette.zinc[600] },
}));

/** The compact sheet's drag handle: Gorhom's `handleComponent` for every bottom sheet. */
export function SheetHandle({
  // Gorhom passes `indicatorStyle={undefined}`, which would override the themed indicator.
  indicatorStyle: _indicatorStyle,
  ...props
}: ComponentProps<typeof BottomSheetHandle>) {
  return <ThemedBottomSheetHandle {...props} />;
}

/**
 * Content that drags the sheet the way its handle does. A sheet whose body scrolls on its own
 * turns content panning off and wraps its header in this, so the header still pulls it down.
 * Render it inside the sheet's content.
 */
export function SheetDragArea({ children }: { children: ReactNode }) {
  const { handlePanGestureHandler } = useBottomSheetGestureHandlers();
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .shouldCancelWhenOutside(false)
        .runOnJS(false)
        .onStart(handlePanGestureHandler.handleOnStart)
        .onChange(handlePanGestureHandler.handleOnChange)
        .onEnd(handlePanGestureHandler.handleOnEnd)
        .onFinalize(handlePanGestureHandler.handleOnFinalize),
    [handlePanGestureHandler],
  );
  return (
    <GestureDetector gesture={gesture}>
      <View>{children}</View>
    </GestureDetector>
  );
}

/**
 * A compact sheet's content area that reaches the bottom of the screen. It owns the system
 * navigation inset: it pads it once and tells its content none is left, so content that pads the
 * inset itself, like the composer dock, sits the same in a sheet as in a tab.
 */
export function SheetBottomInset({ style, children, ...props }: ViewProps) {
  const insets = useSafeAreaInsets();
  const contentInsets = useMemo(() => ({ ...insets, bottom: 0 }), [insets]);
  const insetStyle = useMemo(() => [style, { paddingBottom: insets.bottom }], [style, insets]);
  return (
    <View {...props} style={insetStyle}>
      <SafeAreaInsetsContext.Provider value={contentInsets}>
        {children}
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

/**
 * The sheet body, indented to the sheet's content inset.
 *
 * The inset lives on a real `View` and never on a scroller's
 * `contentContainerStyle`: that is a library prop, not the `style` prop
 * Unistyles registers, so a themed inset handed to a third-party scroller such
 * as `BottomSheetScrollView` silently resolves to nothing on web — which is how
 * the compact sheet ended up rendering its cards flush to the screen edges. See
 * docs/unistyles.md "Main Gotcha: contentContainerStyle".
 */
function SheetContent({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  return <View style={[styles.sheetContent, style]}>{children}</View>;
}

/**
 * An icon action in a sheet header's trailing rail, drawn like the Close button so a header's
 * actions line up with it at one size. Pass it through `SheetHeader.actions`.
 */
export function SheetHeaderIconButton({
  icon: Icon,
  accessibilityLabel,
  onPress,
  testID,
}: {
  icon: LucideIcon;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.closeButton}
      onPress={onPress}
      testID={testID}
    >
      {({ pressed }) => (
        <Icon size={16} color={pressed ? theme.colors.foreground : theme.colors.foregroundMuted} />
      )}
    </Pressable>
  );
}

export function SheetHeaderView({
  header,
  onClose,
  showCloseButton = true,
  isMaximized,
  onToggleMaximize,
  testID,
}: {
  header: SheetHeader;
  onClose: () => void;
  showCloseButton?: boolean;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  testID?: string;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const titleStyle = useMemo(
    () => [styles.title, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
  const back = header.back;
  const handleBackPress = back?.onPress;
  const search = header.search;
  const handleSearchChange = useCallback(
    (value: string) => {
      search?.onChange(value);
    },
    [search],
  );

  return (
    <View style={styles.headerContainer} testID={testID}>
      <View style={styles.headerRow}>
        {handleBackPress ? (
          <Pressable
            onPress={handleBackPress}
            hitSlop={8}
            style={styles.headerBackButton}
            accessibilityRole="button"
            accessibilityLabel={back?.accessibilityLabel ?? back?.label ?? t("common.actions.back")}
            testID="sheet-header-back"
          >
            {({ pressed }) => (
              <ArrowLeft
                size={18}
                color={pressed ? theme.colors.foreground : theme.colors.foregroundMuted}
              />
            )}
          </Pressable>
        ) : null}
        {header.leading ? <View style={styles.headerLeadingSlot}>{header.leading}</View> : null}
        <View style={styles.headerTitleGroup}>
          <Text style={titleStyle} numberOfLines={1}>
            {header.title}
          </Text>
          {typeof header.subtitle === "string" || typeof header.subtitle === "number" ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {header.subtitle}
            </Text>
          ) : (
            header.subtitle
          )}
        </View>
        {header.actions ? <View style={styles.headerActions}>{header.actions}</View> : null}
        {onToggleMaximize ? (
          <SheetHeaderIconButton
            icon={isMaximized ? Minimize2 : Maximize2}
            accessibilityLabel={isMaximized ? "Restore window size" : "Maximize window"}
            onPress={onToggleMaximize}
            testID="sheet-header-maximize"
          />
        ) : null}
        {showCloseButton ? (
          <SheetHeaderIconButton
            icon={X}
            accessibilityLabel={t("common.actions.close")}
            onPress={onClose}
          />
        ) : null}
      </View>
      {search ? (
        <View style={styles.searchRow}>
          <Search size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
          <AdaptiveTextInput
            // @ts-expect-error - outlineStyle is web-only
            style={[styles.searchInput, isWeb && { outlineStyle: "none" }]}
            placeholder={search.placeholder ?? t("common.actions.search")}
            resetKey={search.resetKey}
            onChangeText={handleSearchChange}
            onFocus={search.onFocus}
            onBlur={search.onBlur}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={search.autoFocus}
            testID={search.testID}
          />
        </View>
      ) : null}
    </View>
  );
}

export function InlineHeaderView({ header }: { header: SheetHeader }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const back = header.back;
  const handleBackPress = back?.onPress;
  const hasInlineRow = Boolean(handleBackPress || header.leading || header.actions);
  if (!hasInlineRow && !header.search) return null;
  return (
    <View>
      {hasInlineRow ? (
        <View style={styles.inlineHeaderRow}>
          {handleBackPress ? (
            <Pressable
              onPress={handleBackPress}
              hitSlop={8}
              style={styles.headerBackButton}
              accessibilityRole="button"
              accessibilityLabel={
                back?.accessibilityLabel ?? back?.label ?? t("common.actions.back")
              }
              testID="sheet-header-back"
            >
              {({ pressed }) => (
                <ArrowLeft
                  size={16}
                  color={pressed ? theme.colors.foreground : theme.colors.foregroundMuted}
                />
              )}
            </Pressable>
          ) : null}
          {header.leading ? <View style={styles.headerLeadingSlot}>{header.leading}</View> : null}
          <Text style={styles.inlineTitle} numberOfLines={1}>
            {header.title}
          </Text>
          {header.actions ? <View style={styles.headerActions}>{header.actions}</View> : null}
        </View>
      ) : null}
      {header.search ? (
        <View style={styles.inlineSearchRow}>
          <Search size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          <AdaptiveTextInput
            // @ts-expect-error - outlineStyle is web-only
            style={[styles.searchInput, isWeb && { outlineStyle: "none" }]}
            placeholder={header.search.placeholder ?? t("common.actions.search")}
            resetKey={header.search.resetKey}
            onChangeText={header.search.onChange}
            onFocus={header.search.onFocus}
            onBlur={header.search.onBlur}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={header.search.autoFocus}
            testID={header.search.testID}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The sheet's action row: a top border, the sheet's side inset, and children spread across it.
 * The sheet draws it for `footer`; a body that splits into panes renders it at the bottom of one.
 */
export function SheetFooter({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return <View style={[styles.footer, style]}>{children}</View>;
}

export interface AdaptiveModalSheetProps {
  /**
   * The title row with the close button. Leave it out when the body draws its own chrome, such as
   * a full-height side rail: the desktop card then floats the close button over its top-right
   * corner, and the compact sheet closes from its handle.
   */
  header?: SheetHeader;
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  /**
   * Override what tapping the backdrop / pressing Escape does. Defaults to
   * closing the sheet (calls `onClose`). Callers with drill-down state (e.g. a
   * sheet with a back level) can step back one level instead of closing.
   */
  onBackdropPress?: () => void;
  children: ReactNode;
  /** Sticky footer rendered below the scrollable content. */
  footer?: ReactNode;
  footerContainerStyle?: StyleProp<ViewStyle>;
  snapPoints?: string[];
  testID?: string;
  /** Override the max width of the desktop card. */
  desktopMaxWidth?: number;
  /** Bound an author-owned list without changing content-sized first-party dialogs. */
  desktopHeight?: DimensionValue;
  /** Allow dragging edges/corners and toggling maximize on desktop web. */
  resizable?: boolean;
  /** Optional localStorage key used to persist custom desktop dimensions when resizable. */
  resizeStorageKey?: string;
  /** Whether the host supplies the scroll container. Caller-owned lists still share sheet gestures. */
  scrollable?: boolean;
  presentation?: "push" | "replace";
  /** Full body viewport below the header, including space beyond the content. */
  bodyStyle?: StyleProp<ViewStyle>;
  /** Layout intent for the sheet body, composed over the sheet's own content inset. */
  contentStyle?: StyleProp<ViewStyle>;
  /** Re-establishes caller-owned contexts inside the native or compact sheet portal. */
  contextBridge?: ContextBridge | null;
}

/**
 * The compact sheet's body. It renders on the far side of the sheet's portal so it reads the
 * screen's bottom inset, not the one left where the sheet was opened: inside a sheet tab, none is.
 */
function CompactSheetBody({
  header,
  onClose,
  testID,
  footer,
  isKeyboardVisible,
  scrollable,
  bodyStyle,
  contentStyle,
  children,
}: {
  header?: SheetHeader;
  onClose: () => void;
  testID?: string;
  footer: ReactNode;
  isKeyboardVisible: boolean;
  scrollable: boolean;
  bodyStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { contentPaddingBottom = 0, footerPaddingBottom = 0 } = getCompactSheetSafeAreaPadding({
    isCompact: true,
    isKeyboardVisible,
    hasFooter: Boolean(footer),
    safeAreaBottom: insets.bottom,
  });
  // Safe-area clearance is a separate layer: it must not replace the caller's
  // padding (including an explicit zero), and the footer owns it when present.
  const bodyClearanceStyle = { paddingBottom: contentPaddingBottom };
  const footerClearanceStyle = useMemo(
    () => ({ paddingBottom: footerPaddingBottom }),
    [footerPaddingBottom],
  );
  const footerView = useMemo(
    () => (footer ? <View style={footerClearanceStyle}>{footer}</View> : null),
    [footer, footerClearanceStyle],
  );
  return (
    <SheetVisibleFrame footer={footerView}>
      {header ? <SheetHeaderView header={header} onClose={onClose} testID={testID} /> : null}
      <View style={[styles.compactStaticContent, bodyStyle]}>
        {scrollable ? (
          <ScrollView
            style={styles.bottomSheetVisibleScroll}
            contentContainerStyle={SCROLL_CONTENT_GROW}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.contentGrow, bodyClearanceStyle]}>
              <SheetContent style={[styles.contentGrow, contentStyle]}>{children}</SheetContent>
            </View>
          </ScrollView>
        ) : (
          <View style={[styles.compactStaticContent, bodyClearanceStyle]}>
            <SheetContent style={[styles.compactStaticContent, contentStyle]}>
              {children}
            </SheetContent>
          </View>
        )}
      </View>
    </SheetVisibleFrame>
  );
}

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface StoredSheetDimensions {
  width?: number;
  height?: number;
  isMaximized?: boolean;
}

const MIN_RESIZABLE_WIDTH = 440;
const MIN_RESIZABLE_HEIGHT = 340;
const VIEWPORT_MARGIN = 32;

const RESIZE_HANDLE_N_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 12,
  right: 12,
  height: 6,
  cursor: "ns-resize",
  zIndex: 20,
};
const RESIZE_HANDLE_S_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 12,
  right: 12,
  height: 6,
  cursor: "ns-resize",
  zIndex: 20,
};
const RESIZE_HANDLE_W_STYLE: React.CSSProperties = {
  position: "absolute",
  left: 0,
  top: 12,
  bottom: 12,
  width: 6,
  cursor: "ew-resize",
  zIndex: 20,
};
const RESIZE_HANDLE_E_STYLE: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: 12,
  bottom: 12,
  width: 6,
  cursor: "ew-resize",
  zIndex: 20,
};
const RESIZE_HANDLE_NW_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: 12,
  height: 12,
  cursor: "nwse-resize",
  zIndex: 21,
};
const RESIZE_HANDLE_NE_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  width: 12,
  height: 12,
  cursor: "nesw-resize",
  zIndex: 21,
};
const RESIZE_HANDLE_SW_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 0,
  width: 12,
  height: 12,
  cursor: "nesw-resize",
  zIndex: 21,
};
const RESIZE_HANDLE_SE_STYLE: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  right: 0,
  width: 16,
  height: 16,
  cursor: "nwse-resize",
  zIndex: 21,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "flex-end",
  padding: 3,
  opacity: 0.45,
};

function readStoredSheetDimensions(storageKey: string | undefined): StoredSheetDimensions | null {
  if (!isWeb || !storageKey || typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSheetDimensions;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredSheetDimensions(
  storageKey: string | undefined,
  value: StoredSheetDimensions,
): void {
  if (!isWeb || !storageKey || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // ignore storage quota / privacy mode errors
  }
}

function readInitialCustomSize(
  storageKey: string | undefined,
): { width: number; height: number } | null {
  const stored = readStoredSheetDimensions(storageKey);
  if (
    stored &&
    typeof stored.width === "number" &&
    Number.isFinite(stored.width) &&
    typeof stored.height === "number" &&
    Number.isFinite(stored.height)
  ) {
    return { width: stored.width, height: stored.height };
  }
  return null;
}

function computeResizedDimensions(input: {
  direction: ResizeDirection;
  startWidth: number;
  startHeight: number;
  dx: number;
  dy: number;
}): { width: number; height: number } {
  const { direction, startWidth, startHeight, dx, dy } = input;
  const maxWidth = Math.max(MIN_RESIZABLE_WIDTH, window.innerWidth - VIEWPORT_MARGIN);
  const maxHeight = Math.max(MIN_RESIZABLE_HEIGHT, window.innerHeight - VIEWPORT_MARGIN);
  let nextWidth = startWidth;
  let nextHeight = startHeight;
  if (direction.includes("e")) {
    nextWidth = startWidth + dx * 2;
  } else if (direction.includes("w")) {
    nextWidth = startWidth - dx * 2;
  }
  if (direction.includes("s")) {
    nextHeight = startHeight + dy * 2;
  } else if (direction.includes("n")) {
    nextHeight = startHeight - dy * 2;
  }
  return {
    width: Math.round(Math.min(maxWidth, Math.max(MIN_RESIZABLE_WIDTH, nextWidth))),
    height: Math.round(Math.min(maxHeight, Math.max(MIN_RESIZABLE_HEIGHT, nextHeight))),
  };
}

function useResizableSheet(input: {
  canResizeWeb: boolean;
  resizeStorageKey?: string;
  desktopMaxWidth?: number;
  desktopHeight?: DimensionValue;
}) {
  const { canResizeWeb, resizeStorageKey, desktopMaxWidth, desktopHeight } = input;
  const [customSize, setCustomSize] = useState<{ width: number; height: number } | null>(() =>
    readInitialCustomSize(resizeStorageKey),
  );
  const [isMaximized, setIsMaximized] = useState<boolean>(() =>
    Boolean(readStoredSheetDimensions(resizeStorageKey)?.isMaximized),
  );
  const cardElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!canResizeWeb || !resizeStorageKey) return;
    writeStoredSheetDimensions(resizeStorageKey, {
      ...(customSize ? { width: customSize.width, height: customSize.height } : {}),
      isMaximized,
    });
  }, [canResizeWeb, customSize, isMaximized, resizeStorageKey]);

  const handleToggleMaximize = useCallback(() => {
    setIsMaximized((prev) => !prev);
  }, []);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canResizeWeb || isMaximized || typeof window === "undefined") {
        return;
      }
      const direction = event.currentTarget.dataset.resizeDir as ResizeDirection | undefined;
      if (!direction) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const rect = cardElementRef.current?.getBoundingClientRect();
      const fallbackWidth = desktopMaxWidth ?? 520;
      const fallbackHeight =
        typeof desktopHeight === "number" ? desktopHeight : Math.round(window.innerHeight * 0.75);
      const startWidth = customSize?.width ?? rect?.width ?? fallbackWidth;
      const startHeight = customSize?.height ?? rect?.height ?? fallbackHeight;
      const startX = event.clientX;
      const startY = event.clientY;

      const onPointerMove = (moveEvent: PointerEvent) => {
        setCustomSize(
          computeResizedDimensions({
            direction,
            startWidth,
            startHeight,
            dx: moveEvent.clientX - startX,
            dy: moveEvent.clientY - startY,
          }),
        );
      };

      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [canResizeWeb, customSize, desktopHeight, desktopMaxWidth, isMaximized],
  );

  const attachCardElement = useCallback((node: unknown) => {
    cardElementRef.current = node instanceof HTMLElement ? node : null;
  }, []);

  const desktopCardStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      styles.desktopCard,
      desktopHeight != null && { height: desktopHeight },
      desktopMaxWidth != null && { maxWidth: desktopMaxWidth },
      isWeb && WEB_ENTER_STYLE,
      canResizeWeb && { position: "relative" as const },
      canResizeWeb &&
        customSize != null &&
        !isMaximized && {
          width: customSize.width,
          maxWidth: "96%" as DimensionValue,
          height: customSize.height,
          maxHeight: "92%" as DimensionValue,
        },
      canResizeWeb &&
        isMaximized && {
          width: "96%" as DimensionValue,
          maxWidth: "96%" as DimensionValue,
          height: "92%" as DimensionValue,
          maxHeight: "92%" as DimensionValue,
        },
    ],
    [canResizeWeb, customSize, desktopMaxWidth, desktopHeight, isMaximized],
  );

  const hasFixedDesktopHeight =
    desktopHeight != null || (canResizeWeb && (customSize != null || isMaximized));

  return {
    isMaximized: canResizeWeb ? isMaximized : undefined,
    handleToggleMaximize: canResizeWeb ? handleToggleMaximize : undefined,
    showResizeHandles: canResizeWeb && !isMaximized,
    desktopCardStyle,
    hasFixedDesktopHeight,
    attachCardElement,
    handleResizePointerDown,
  };
}

function SheetResizeHandles({
  onPointerDown,
}: {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <>
      <div data-resize-dir="n" onPointerDown={onPointerDown} style={RESIZE_HANDLE_N_STYLE} />
      <div data-resize-dir="s" onPointerDown={onPointerDown} style={RESIZE_HANDLE_S_STYLE} />
      <div data-resize-dir="w" onPointerDown={onPointerDown} style={RESIZE_HANDLE_W_STYLE} />
      <div data-resize-dir="e" onPointerDown={onPointerDown} style={RESIZE_HANDLE_E_STYLE} />
      <div data-resize-dir="nw" onPointerDown={onPointerDown} style={RESIZE_HANDLE_NW_STYLE} />
      <div data-resize-dir="ne" onPointerDown={onPointerDown} style={RESIZE_HANDLE_NE_STYLE} />
      <div data-resize-dir="sw" onPointerDown={onPointerDown} style={RESIZE_HANDLE_SW_STYLE} />
      <div
        data-testid="sheet-resize-handle-se"
        data-resize-dir="se"
        onPointerDown={onPointerDown}
        title="Drag to resize"
        style={RESIZE_HANDLE_SE_STYLE}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M9 1L1 9M9 5L5 9"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </>
  );
}

export function AdaptiveModalSheet({
  header,
  visible,
  onClose,
  onDismiss,
  onBackdropPress,
  children,
  footer,
  footerContainerStyle,
  snapPoints,
  testID,
  desktopMaxWidth,
  desktopHeight,
  resizable = false,
  resizeStorageKey,
  scrollable = true,
  presentation,
  contentStyle,
  bodyStyle,
  contextBridge = null,
}: AdaptiveModalSheetProps) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const isKeyboardVisible = useKeyboardVisibility(visible);
  const resolvedSnapPoints = useMemo(() => snapPoints ?? ["65%", "90%"], [snapPoints]);
  const footerView = useMemo(
    () => (footer ? <SheetFooter style={footerContainerStyle}>{footer}</SheetFooter> : null),
    [footer, footerContainerStyle],
  );
  const canResizeWeb = Boolean(resizable && isWeb && !isMobile);
  const {
    isMaximized,
    handleToggleMaximize,
    showResizeHandles,
    desktopCardStyle,
    hasFixedDesktopHeight,
    attachCardElement,
    handleResizePointerDown,
  } = useResizableSheet({
    canResizeWeb,
    resizeStorageKey,
    desktopMaxWidth,
    desktopHeight,
  });
  useEffect(() => {
    if (!isWeb && visible) {
      // A newly opened sheet owns input. A keyboard belonging to the sheet below
      // would cover controls in the new sheet, which has no focused input yet.
      Keyboard.dismiss();
    }
  }, [visible]);

  const { sheetRef, handleSheetChange, handleSheetDismiss } = useIsolatedBottomSheetVisibility({
    visible,
    isEnabled: isMobile || !isWeb,
    onClose,
  });
  const [shouldRenderWeb, setShouldRenderWeb] = useState(visible);
  const [isWebClosing, setIsWebClosing] = useState(false);
  const modalLayer = useGlobalOverlayLayer("modal", visible || shouldRenderWeb);
  const handleDismiss = useCallback(() => {
    handleSheetDismiss();
    onDismiss?.();
  }, [handleSheetDismiss, onDismiss]);

  const desktopOverlayStyle = useMemo(
    () => [
      styles.desktopOverlay,
      isWeb && {
        zIndex: modalLayer,
        opacity: isWebClosing ? 0 : 1,
        transitionDuration: `${WEB_EXIT_DURATION_MS}ms`,
        transitionProperty: "opacity",
        transitionTimingFunction: "ease",
      },
    ],
    [isWebClosing, modalLayer],
  );

  const handleBackdropPress = useCallback(() => {
    (onBackdropPress ?? onClose)();
  }, [onBackdropPress, onClose]);

  const handleOverlayKeyDown = useCallback(
    (event: KeyboardInputEvent) => {
      if (event.key !== "Escape") return false;
      event.preventDefault();
      event.stopPropagation();
      handleBackdropPress();
      return true;
    },
    [handleBackdropPress],
  );
  const setOverlayScope = useOverlayRegistration({
    keys: ["Escape"],
    active: visible,
    layer: modalLayer,
    onKeyDown: handleOverlayKeyDown,
  });
  const setCardRef = useCallback(
    (node: unknown) => {
      setOverlayScope(node);
      attachCardElement(node);
    },
    [attachCardElement, setOverlayScope],
  );

  useEffect(() => {
    if (!isWeb || isMobile) return;
    if (visible) {
      setShouldRenderWeb(true);
      setIsWebClosing(false);
      return;
    }
    if (!shouldRenderWeb) return;
    setIsWebClosing(true);
    const timeout = window.setTimeout(() => {
      setShouldRenderWeb(false);
      setIsWebClosing(false);
      onDismiss?.();
    }, WEB_EXIT_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [visible, isMobile, onDismiss, shouldRenderWeb]);

  if (isMobile) {
    return (
      <IsolatedBottomSheetModal
        ref={sheetRef}
        contextBridge={contextBridge}
        snapPoints={resolvedSnapPoints}
        index={0}
        enableDynamicSizing={false}
        onChange={handleSheetChange}
        onDismiss={handleDismiss}
        backdropOpacity={0.45}
        enablePanDownToClose
        backgroundComponent={SheetBackground}
        handleComponent={SheetHandle}
        keyboardBehavior="extend"
        keyboardBlurBehavior="restore"
        accessible={false}
        presentation={presentation}
      >
        <OverlayLayerProvider layer={modalLayer}>
          <CompactSheetBody
            header={header}
            onClose={onClose}
            testID={testID}
            footer={footerView}
            isKeyboardVisible={isKeyboardVisible}
            scrollable={scrollable}
            bodyStyle={bodyStyle}
            contentStyle={contentStyle}
          >
            {children}
          </CompactSheetBody>
        </OverlayLayerProvider>
      </IsolatedBottomSheetModal>
    );
  }

  const desktopStaticStyle = !hasFixedDesktopHeight
    ? styles.desktopStaticContent
    : styles.compactStaticContent;
  const cardInner = (
    <OverlayLayerProvider layer={modalLayer}>
      {header ? (
        <SheetHeaderView
          header={header}
          onClose={onClose}
          isMaximized={isMaximized}
          onToggleMaximize={handleToggleMaximize}
        />
      ) : null}
      <View style={[scrollable ? styles.desktopScrollContainer : desktopStaticStyle, bodyStyle]}>
        {scrollable ? (
          <ScrollView
            style={styles.desktopScroll}
            contentContainerStyle={SCROLL_CONTENT_GROW}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            <SheetContent style={[styles.contentGrow, contentStyle]}>{children}</SheetContent>
          </ScrollView>
        ) : (
          <SheetContent style={[desktopStaticStyle, contentStyle]}>{children}</SheetContent>
        )}
      </View>
      {footerView}
      {showResizeHandles ? <SheetResizeHandles onPointerDown={handleResizePointerDown} /> : null}
      {header ? null : (
        <View style={styles.floatingClose}>
          <SheetHeaderIconButton
            icon={X}
            accessibilityLabel={t("common.actions.close")}
            onPress={onClose}
          />
        </View>
      )}
    </OverlayLayerProvider>
  );

  const desktopContent = (
    <View style={desktopOverlayStyle} testID={testID}>
      <Pressable
        accessibilityLabel={t("common.actions.dismiss")}
        style={ABSOLUTE_FILL_STYLE}
        onPress={handleBackdropPress}
      />
      <View ref={setCardRef} style={desktopCardStyle} role="dialog" aria-modal tabIndex={-1}>
        {cardInner}
      </View>
    </View>
  );

  // On web, use portal to overlay root for consistent stacking with toasts
  if (isWeb && typeof document !== "undefined") {
    if (!shouldRenderWeb) return null;
    return createPortal(desktopContent, getOverlayRoot());
  }

  return (
    // Both native presentations share Gorhom's app-wide stack. Independent RN Modals
    // present from their React ancestor's controller, so a root-owned sibling dialog
    // cannot present while that controller already has a dialog open on iOS.
    <IsolatedBottomSheetModal
      ref={sheetRef}
      contextBridge={contextBridge}
      snapPoints={NATIVE_DIALOG_SNAP_POINTS}
      index={0}
      enableDynamicSizing={false}
      onChange={handleSheetChange}
      onDismiss={handleDismiss}
      handleComponent={null}
      backgroundStyle={styles.nativeDialogBackground}
      enablePanDownToClose={false}
      enableHandlePanningGesture={false}
      enableContentPanningGesture={false}
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      accessible={false}
      presentation={presentation}
    >
      <View style={styles.nativeDialogSurface}>{desktopContent}</View>
    </IsolatedBottomSheetModal>
  );
}
