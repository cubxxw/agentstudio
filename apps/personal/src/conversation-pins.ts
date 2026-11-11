export function normalizePins(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))] : [];
}

export function togglePin(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
}

export function movePin(ids: string[], id: string, direction: -1 | 1): string[] {
  const from = ids.indexOf(id), to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
