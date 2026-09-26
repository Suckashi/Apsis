import type { ToolOperation } from "../shared/types.ts";
export type Evidence = NonNullable<ToolOperation["evidence"]>;
export const evidenceLimit = 24000;
export function boundedEvidence(
  value: Evidence,
  limit = evidenceLimit,
): Evidence {
  limit = Number.isFinite(limit)
    ? Math.max(1, Math.floor(limit))
    : evidenceLimit;
  const truncated =
    !!value.truncated ||
    (value.output?.length || 0) > limit ||
    (value.patch?.length || 0) > limit ||
    (value.command?.length || 0) > limit;
  return {
    ...value,
    command: value.command?.slice(0, limit),
    output: value.output?.slice(0, limit),
    patch: value.patch?.slice(0, limit),
    truncated,
  };
}
export class ToolExecutionError extends Error {
  evidence: Evidence;
  constructor(message: string, evidence: Evidence) {
    super(message);
    this.evidence = evidence;
  }
}
