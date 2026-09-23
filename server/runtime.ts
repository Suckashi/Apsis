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
  executionContext?: string;
  probe?: { nonce: string; called: () => void };
  agent?: AgentDefinition;
  permissions?: RunPermissions;
  source?: { sessionId: string; runId: string };
  recordOperation?: (operation: ToolOperation) => Promise<void>;
  store: Store;
  workspace: Workspace;
  allowWrites: boolean;
  env?: Environment;
}
export interface RunOptions extends ToolOptions {
  prompt: string;
  emit: (event: RunEvent) => void;
  signal: AbortSignal;
  mode: Session["mode"];
  session: Session;
}

export interface EngineAdapter {
  id: "pi" | "deepagents" | "openai-agents";
  run(options: RunOptions): Promise<RunResult>;
}
