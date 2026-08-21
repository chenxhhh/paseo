import type { StreamFrameChildOrder } from "./strategy";

export function orderUserMessageCollapseHeader<T>(
  frameOrder: StreamFrameChildOrder,
  message: T,
  header: T,
): [T, T] {
  if (frameOrder === "footer-then-content") {
    return [header, message];
  }
  return [message, header];
}
