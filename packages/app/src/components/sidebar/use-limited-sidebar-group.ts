import { useCallback, useMemo, useState } from "react";

export const SIDEBAR_GROUP_INITIAL_VISIBLE_COUNT = 20;

export function limitSidebarGroupItems<T>(input: { items: readonly T[]; expanded: boolean }): T[] {
  if (input.expanded) {
    return input.items.slice();
  }
  return input.items.slice(0, SIDEBAR_GROUP_INITIAL_VISIBLE_COUNT);
}

export function canToggleSidebarGroup(itemCount: number): boolean {
  return itemCount > SIDEBAR_GROUP_INITIAL_VISIBLE_COUNT;
}

export function useLimitedSidebarGroup<T>(items: readonly T[]) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = useMemo(
    () => limitSidebarGroupItems({ items, expanded }),
    [expanded, items],
  );
  const canToggle = canToggleSidebarGroup(items.length);
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);

  return { visibleItems, expanded, canToggle, toggleExpanded };
}
