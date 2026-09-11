import { isWeb } from "@/constants/platform";

/**
 * Props that keep a purely decorative <Svg> out of the accessibility tree.
 *
 * On web, react-native-svg spreads rest props onto the DOM <svg> element, where the
 * RN-specific accessibility props leak through as unknown attributes (each with a
 * React dev warning); the standard `aria-hidden` attribute works there instead.
 * Native codegen SVG views do not translate `aria-hidden` (that mapping lives in
 * RN's View), so the RN accessibility props are kept for native.
 */
export const decorativeSvgProps = isWeb
  ? ({ "aria-hidden": true } as const)
  : ({
      accessibilityElementsHidden: true,
      importantForAccessibility: "no-hide-descendants",
    } as const);
