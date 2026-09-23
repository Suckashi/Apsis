import type { ToolOperation } from "../shared/types.ts";
export type Evidence = NonNullable<ToolOperation["evidence"]>;
export const evidenceLimit = 24000;
export function boundedEvidence(value: Evidence): Evidence {
  const truncated =
    !!value.truncated ||
    (value.output?.length || 0) > evidenceLimit ||
    (value.patch?.length || 0) > evidenceLimit ||
    (value.command?.length || 0) > evidenceLimit;
  return {
    ...value,
    command: value.command?.slice(0, evidenceLimit),
    output: value.output?.slice(0, evidenceLimit),
    patch: value.patch?.slice(0, evidenceLimit),
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
