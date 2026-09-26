import type {
  AgentDefinition,
  Environment,
  Session,
  RunEvent,
  RunResult,
  RunPermissions,
  ToolOperation,
} from "../shared/types.ts";
import type { Store } from "./store.ts";
import type { Workspace } from "./workspace.ts";
export interface ToolOptions {
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
  registerSteer?: (steer: (text: string) => Promise<void>) => void;
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
  mode: Session["mode"];
  session: Session;
}
