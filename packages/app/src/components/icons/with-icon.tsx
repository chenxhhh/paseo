import Svg, { Path } from "react-native-svg";

interface WithIconProps {
  size?: number;
  color?: string;
}

export function WithIcon({ size = 16, color = "currentColor" }: WithIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path
        d="M21 12C21 17.45 16.71 17.45 12 12C7.29 6.55 3 6.55 3 12C3 17.45 7.29 17.45 12 12C16.71 6.55 21 6.55 21 12Z"
        fill={color}
      />
    </Svg>
  );
}
