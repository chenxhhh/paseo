import { Platform } from "react-native";
import { BaseAnimationBuilder, FadeIn, FadeOut } from "react-native-reanimated";
import { isWeb } from "@/constants/platform";

/**
 * Reanimated's entering/exiting layout animations are disabled on two platforms:
 *
 * - Android: the dispatchDraw crash tracked in react-native-reanimated#8422.
 * - Web: reanimated's `reattachElementToAncestor` (layoutReanimation/web/domUtils.js) re-appends
 *   the node that React is unmounting, then calls `parent.removeChild(child)` from the
 *   `animationend` handler. When the parent is itself unmounted or re-keyed in the same frame,
 *   the child is no longer a descendant and the DOM throws
 *   "Failed to execute 'removeChild' on 'Node'".
 *
 * Web loses only short fades; the crash is not worth the effect.
 */
export const shouldDisableEntryExitAnimations = isWeb || Platform.OS === "android";

type EntryExitAnimationBuilder = InstanceType<typeof BaseAnimationBuilder>;

/** `FadeIn` that resolves to `undefined` (no animation) where entry/exit animations are off. */
export function entryExitFadeIn(durationMs: number): EntryExitAnimationBuilder | undefined {
  return shouldDisableEntryExitAnimations ? undefined : FadeIn.duration(durationMs);
}

/** `FadeOut` that resolves to `undefined` (no animation) where entry/exit animations are off. */
export function entryExitFadeOut(durationMs: number): EntryExitAnimationBuilder | undefined {
  return shouldDisableEntryExitAnimations ? undefined : FadeOut.duration(durationMs);
}
