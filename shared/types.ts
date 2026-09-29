export type Provider =
  | "openai"
  | "anthropic"
  | "ollama"
  | "openai-compatible"
  | "codex";
export type Mode = "deepagents" | "codex";
export type AgentEngine = Mode;
export interface AgentDefinition {
  connectionId?: string;
  version?: number;
  id: string;
  name: string;
  description: string;
  instructions: string;
  engine: AgentEngine;
  provider: Provider;
  model: string;
  tools: string[];
  skillIds: string[];
  memoryScope: "private" | "shared";
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}
export type Environment = Record<string, string | undefined>;
export interface Memory {
  /** Undefined is legacy data; never implicitly promote it to global memory. */
  scopeKey?: string;
  tier?: "core" | "reference";
  locked?: boolean;
  revision?: number;
  enabled?: boolean;
  updatedAt?: string;
  source?: {
    sessionId?: string;
    runId?: string;
    messageId?: string;
    kind: "agent" | "manual";
  };
  revisions?: {
    content: string;
    at: string;
    revision?: number;
    source?: Memory["source"];
    tier?: Memory["tier"];
    locked?: boolean;
    enabled?: boolean;
  }[];
  mergedInto?: string;
  agentId?: string;
  id: string;
  content: string;
  createdAt?: string;
}
export interface Skill extends Memory {
  name: string;
  description?: string;
  skillDirectory?: string;
}
export interface ChatMessage {
  /** Delivery into a later model turn is independent of task completion. */
  delivery?: {
    kind: "steer";
    state: "pending" | "applied" | "not-applied";
    updatedAt: string;
  };
  createdAt?: string;
  workContextId?: string;
  sequence?: number;
  runId?: string;
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "complete" | "failed" | "error";
  activity?: string[];
}
export interface Session {
  workContextId?: string;
  project?: Project;
  agent?: AgentDefinition;
  connectionId?: string;
  provider?: Provider;
  model?: string;
  engineState?: unknown;
  source?: "web" | "telegram";
  id: string;
  title: string;
  mode: Mode;
  createdAt: string;
  messages: ChatMessage[];
}
export type SessionView = Omit<Session, "engineState"> & {
  olderCursor?: number;
  context?: WorkContext;
  activeRunId?: string;
  running?: boolean;
  live?: { text: string; activity: string[] };
};
export type SessionSummary = Omit<Session, "engineState" | "messages"> & {
  count: number;
  running: boolean;
};
export interface StoreState {
  projects?: Project[];
  schemaVersion?: number;
  agents?: AgentDefinition[];
  sessions: Session[];
  memories: Memory[];
  skills: Skill[];
}
export interface SubagentActivity {
  id: string;
  name?: string;
  task: string;
  status: "running" | "completed" | "failed" | "cancelled";
  progress?: string;
  resultSummary?: string;
  startedAt: string;
  endedAt?: string;
}
export interface ExecutionTodo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}
export type ExecutionEvidence =
  | { kind: "subagent"; activity: SubagentActivity }
  | { kind: "planning"; todos: ExecutionTodo[]; subagentId?: string };
export type RunEvent =
  | { type: "execution"; evidence: ExecutionEvidence }
  | { type: "commentary"; id: string; text: string }
  | { type: "delta" | "activity" | "error"; text: string; tool?: string }
  | { type: "progress"; text?: string }
  | { type: "operation" }
  | { type: "done" };
export interface RunResult {
  usage?: { inputTokens: number; outputTokens: number };
  engineState?: unknown;
  text: string;
}
export interface RunPermissions {
  shell?: boolean;
  files: boolean;
  memory: boolean;
  skills: boolean;
}
export interface ToolOperation {
  subagentId?: string;
  authorization?: {
    reason: string;
    dangerousCommand?: string;
    matchedRuleIds?: string[];
  };
  evidence?: {
    command?: string;
    output?: string;
    patch?: string;
    exitCode?: number | null;
    truncated?: boolean;
  };
  id: string;
  name: string;
  status: "started" | "succeeded" | "failed" | "unknown";
  startedAt: string;
  endedAt?: string;
  target?: string;
  mutating: boolean;
  error?: string;
}
export type RunTimelineEntry =
  | (ExecutionEvidence & { id: string; at: string })
  | { kind: "commentary"; id: string; at: string; text: string }
  | { kind: "operation"; id: string; at: string; operationId: string };
export interface TaskRun {
  location?: WorkLocation;
  timeline?: RunTimelineEntry[];
  workContextId?: string;
  progress?: { kind: "message" | "reply"; text?: string; updatedAt: string };
  project?: Project;
  recoveryRunIds?: string[];
  id: string;
  sessionId: string;
  engine: AgentEngine;
  agentName: string;
  connectionId?: string;
  model: string;
  permissions: RunPermissions;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  createdAt: string;
  endedAt?: string;
  text: string;
  activity: string[];
  operations: ToolOperation[];
  error?: string;
  usage?: RunResult["usage"];
}
export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
}
export interface WorkLocation {
  id: string;
  name: string;
  path: string;
  kind: "task" | "worktree" | "folder" | "project" | "legacy";
  projectId?: string;
  memoryKey: string;
}
export interface ModelConnection {
  configRevision?: string;
  contextProfiles?: Record<
    string,
    { tokens?: number; source: "manual" | "default" }
  >;
  id: string;
  name: string;
  provider: Provider;
  model: string;
  models?: string[];
  modelSettings?: Record<
    string,
    {
      displayName?: string;
      maxOutputTokens?: number;
      contextWindowTokens?: number;
    }
  >;
  vendor?: string;
  url?: string;
  credentialConfigured: boolean;
  archived?: boolean;
  verification?: {
    engine: AgentEngine;
    model: string;
    at: string;
    ok: boolean;
    streaming: boolean;
    tools: boolean;
    message: string;
  };
}
export interface ContextUsage {
  inputTokens: number;
  inputBudget: number;
  windowTokens: number;
  source: "provider" | "estimate";
  omittedCoreIds: string[];
  updatedAt: string;
}
export interface WorkContext {
  git?: import("./coding.ts").ConversationWorkspace["git"];
  pullRequest?: import("./coding.ts").PullRequestLink;
  location?: WorkLocation;
  locationLockedAt?: string;
  id: string;
  sessionId: string;
  kind: "chat" | "routine" | "delegation";
  createdAt: string;
  endedAt?: string;
  usage?: ContextUsage;
}
export interface ConnectionSelection {
  connectionId: string;
  model: string;
}
export type Api = <T = unknown>(
  path: string,
  options?: RequestInit,
) => Promise<T>;
export interface WorkspaceFile {
  name: string;
  type: "directory" | "file";
}
