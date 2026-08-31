export function mergeWithRemainder(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): string[] {
  const reorderedSet = new Set(input.reorderedVisibleKeys);
  const remainder = input.currentOrder.filter((key) => !reorderedSet.has(key));
  return [...input.reorderedVisibleKeys, ...remainder];
}

export function mergeSubgroupOrder(input: {
  currentOrder: string[];
  reorderedSubgroupKeys: string[];
}): string[] {
  if (input.reorderedSubgroupKeys.length === 0) {
    return input.currentOrder;
  }

  const subgroupSet = new Set(input.reorderedSubgroupKeys);
  const pending = [...input.reorderedSubgroupKeys];
  const next: string[] = [];
  for (const key of input.currentOrder) {
    if (!subgroupSet.has(key)) {
      next.push(key);
      continue;
    }
    const replacement = pending.shift();
    if (replacement !== undefined) {
      next.push(replacement);
    }
  }
  next.push(...pending);
  return next;
}

export function hasVisibleOrderChanged(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): boolean {
  const visibleSet = new Set(input.reorderedVisibleKeys);
  const currentVisible = input.currentOrder.filter((key) => visibleSet.has(key));
  if (currentVisible.length !== input.reorderedVisibleKeys.length) {
    return true;
  }
  return input.reorderedVisibleKeys.some((key, index) => currentVisible[index] !== key);
}
