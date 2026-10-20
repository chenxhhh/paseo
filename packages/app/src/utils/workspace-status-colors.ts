import type { ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
} from "@getpaseo/protocol/workspace-labels";
import { identityForeground, identityTint } from "@/styles/identity-colors";

/**
 * Per-color styles for user-status surfaces (lane headers, dots, chips).
 *
 * `useUnistyles` is a restricted import, and inline color objects in JSX props
 * trip the react-perf lint — so the identity palette is materialized once here,
 * the way `workspace-labels/swatch.tsx` does for the label swatches.
 */

// `identityTint` is theme-independent — one hex per name at 10% alpha — so these
// can be built at module load instead of inside a themed StyleSheet.
const LANE_TINTS = Object.fromEntries(
  WORKSPACE_LABEL_COLORS.map((color) => [color, { backgroundColor: identityTint(color) }]),
) as Record<WorkspaceLabelColor, { backgroundColor: string }>;

const themed = StyleSheet.create((theme) => ({
  topViolet: { borderTopColor: identityForeground("violet", theme.colorScheme) },
  topSky: { borderTopColor: identityForeground("sky", theme.colorScheme) },
  topEmerald: { borderTopColor: identityForeground("emerald", theme.colorScheme) },
  topOrange: { borderTopColor: identityForeground("orange", theme.colorScheme) },
  topPink: { borderTopColor: identityForeground("pink", theme.colorScheme) },
  topIndigo: { borderTopColor: identityForeground("indigo", theme.colorScheme) },
  topTeal: { borderTopColor: identityForeground("teal", theme.colorScheme) },
  topRed: { borderTopColor: identityForeground("red", theme.colorScheme) },
  topAmber: { borderTopColor: identityForeground("amber", theme.colorScheme) },
  topBlue: { borderTopColor: identityForeground("blue", theme.colorScheme) },
  dotViolet: { backgroundColor: identityForeground("violet", theme.colorScheme) },
  dotSky: { backgroundColor: identityForeground("sky", theme.colorScheme) },
  dotEmerald: { backgroundColor: identityForeground("emerald", theme.colorScheme) },
  dotOrange: { backgroundColor: identityForeground("orange", theme.colorScheme) },
  dotPink: { backgroundColor: identityForeground("pink", theme.colorScheme) },
  dotIndigo: { backgroundColor: identityForeground("indigo", theme.colorScheme) },
  dotTeal: { backgroundColor: identityForeground("teal", theme.colorScheme) },
  dotRed: { backgroundColor: identityForeground("red", theme.colorScheme) },
  dotAmber: { backgroundColor: identityForeground("amber", theme.colorScheme) },
  dotBlue: { backgroundColor: identityForeground("blue", theme.colorScheme) },
}));

const TOP_BY_COLOR: Record<WorkspaceLabelColor, ViewStyle> = {
  violet: themed.topViolet,
  sky: themed.topSky,
  emerald: themed.topEmerald,
  orange: themed.topOrange,
  pink: themed.topPink,
  indigo: themed.topIndigo,
  teal: themed.topTeal,
  red: themed.topRed,
  amber: themed.topAmber,
  blue: themed.topBlue,
};

const DOT_BY_COLOR: Record<WorkspaceLabelColor, ViewStyle> = {
  violet: themed.dotViolet,
  sky: themed.dotSky,
  emerald: themed.dotEmerald,
  orange: themed.dotOrange,
  pink: themed.dotPink,
  indigo: themed.dotIndigo,
  teal: themed.dotTeal,
  red: themed.dotRed,
  amber: themed.dotAmber,
  blue: themed.dotBlue,
};

export function laneTintStyle(color: WorkspaceLabelColor) {
  return LANE_TINTS[color];
}

export function laneTopStyle(color: WorkspaceLabelColor) {
  return TOP_BY_COLOR[color];
}

export function statusDotStyle(color: WorkspaceLabelColor) {
  return DOT_BY_COLOR[color];
}
