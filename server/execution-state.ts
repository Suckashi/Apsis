import { RunSlots } from "./run-slots.ts";
import type { Settings } from "../shared/settings.ts";
import type { ChatMessage } from "../shared/types.ts";
import type { SteerHandler } from "./runtime.ts";

/** Shared coordination for queues, permissions and message delivery; never persisted. */
export class ExecutionState {
  readonly jobSettings = new Map<string, Settings>();
  readonly slots = new RunSlots();
  readonly jobControllers = new Map<string, AbortController>();
  readonly active = new Set<string>();
  readonly deleting = new Set<string>();
  readonly cancelledDelegations = new Set<string>();
  readonly steers = new Map<string, SteerHandler>();
  readonly pending = new Map<string, (approved: boolean) => void>();
  readonly preparingLocations = new Set<string>();
  readonly incoming = new Map<
    string,
    { fingerprint: string; promise: Promise<unknown> }
  >();
  readonly steeringRequests = new Map<
    string,
    { prompt: string; request: Promise<ChatMessage> }
  >();
  closed = false;
}
