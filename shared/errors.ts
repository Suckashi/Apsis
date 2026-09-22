export function asError(
  value: unknown,
): Error & { code?: string; status?: number } {
  return value instanceof Error ? value : new Error(String(value));
}
