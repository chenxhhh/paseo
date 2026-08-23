// This file exists for TypeScript resolution.
// The actual implementations are in:
// - board-canvas.native.tsx (iOS/Android)
// - board-canvas.web.tsx (Web)
// Metro's platform-specific extensions will pick the right one at runtime.

export * from "./board-canvas.native";
