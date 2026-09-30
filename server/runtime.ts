import type {
  AgentDefinition,
  Environment,
  Session,
  RunEvent,
  RunPermissions,
  ToolOperation,
} from "../shared/types.ts";
import type { Store } from "./store.ts";
import type { Workspace } from "./workspace.ts";
/** Resolve on enqueue; acknowledge only when included in the next model turn. */
export type SteerHandler = (
  text: string,
  onApplied?: () => Promise<void>,
) => Promise<void>;
export interface ToolOptions {
  memoryKey?: string;
  historyContextId?: string;
  checkToolPermission?: (
    name: string,
    args: unknown,
    signal?: AbortSignal,
    receipt?: AuthorizationReceipt,
  ) => void | AuthorizationReceipt | Promise<void | AuthorizationReceipt>;
  executeAuthorizedTool?: <T>(
    name: string,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ) => Promise<T>;
  runtimeSettings?: import("../shared/settings.ts").RuntimeSettings;
  modelSettings?: {
    displayName?: string;
    maxOutputTokens?: number;
    contextWindowTokens?: number;
  };
  extraTools?: import("./tools.ts").AgentTool[];
  authorize?: (
    name: string,
    args: unknown,
    signal?: AbortSignal,
  ) => Promise<void | AuthorizationReceipt>;
  registerSteer?: (steer: SteerHandler) => void;
  maxTurns?: number;
  executionContext?: string;
  probe?: { nonce: string; called: () => void };
  agent?: AgentDefinition;
  permissions?: RunPermissions;
  source?: { sessionId: string; runId: string; messageId?: string };
  recordOperation?: (operation: ToolOperation) => Promise<void>;
  store: Store;
  workspace: Workspace;
  allowWrites: boolean;
  env?: Environment;
}
export interface AuthorizationReceipt {
  matchedRuleIds?: string[];
  fingerprint: string;
  reason: string;
  dangerousCommand?: string;
}
export interface RunOptions extends ToolOptions {
  prompt: string;
  emit: (event: RunEvent) => void;
  signal: AbortSignal;
  session: Session;
}
