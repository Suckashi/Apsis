import type { AgentMessage } from "@earendil-works/pi-agent-core";

export type Provider = "openai" | "anthropic" | "ollama" | "openai-compatible";
export type Mode = "demo" | "pi";
export type AgentEngine = "pi" | "deepagents" | "openai-agents";
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
  enabled?: boolean;
  updatedAt?: string;
  source?: { sessionId?: string; runId?: string; kind: "agent" | "manual" };
  revisions?: { content: string; at: string }[];
  mergedInto?: string;
  agentId?: string;
  id: string;
  content: string;
  createdAt?: string;
}
export interface Skill extends Memory {
  name: string;
}
export interface ChatMessage {
  runId?: string;
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "complete" | "failed" | "error";
  activity?: string[];
}
export interface Session {
  project?: Project;
  runtimeState?: { engine: AgentEngine; version: 1; data: unknown };
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
  piMessages: AgentMessage[];
}
export type SessionView = Omit<
  Session,
  "piMessages" | "engineState" | "runtimeState"
> & {
  activeRunId?: string;
  running?: boolean;
  live?: { text: string; activity: string[] };
};
export type SessionSummary = Omit<
  Session,
  "piMessages" | "engineState" | "runtimeState" | "messages"
> & {
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
export type RunEvent =
  | { type: "delta" | "activity" | "error"; text: string; tool?: string }
  | { type: "done" };
export interface RunResult {
  runtimeState?: Session["runtimeState"];
  usage?: { inputTokens: number; outputTokens: number };
  engineState?: unknown;
  text: string;
  piMessages?: AgentMessage[];
}
export interface RunPermissions {
  shell?: boolean;
  files: boolean;
  memory: boolean;
  skills: boolean;
}
export interface ToolOperation {
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
export interface TaskRun {
  project?: Project;
  recoveryRunIds?: string[];
  id: string;
  sessionId: string;
  engine: AgentEngine | "demo";
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
}
export interface ModelConnection {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  models?: string[];
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
export interface ConnectionSelection {
  connectionId: string;
  model: string;
}
export interface Status {
  provider: string;
  model: string;
  piReady: boolean;
  version?: string;
  workspace?: string;
  running?: number;
}
export interface CredentialState {
  configured: boolean;
  source: "none" | "local" | "environment";
}
export interface SettingsView {
  pi: {
    provider: string;
    model: string;
    credentials: Record<Exclude<Provider, "ollama">, CredentialState>;
    ollamaUrl: string;
    compatibleUrl: string;
  };
  models: Record<string, { id: string; name: string }[]>;
  defaults: Record<Provider, string>;
}
export type Api = <T = unknown>(
  path: string,
  options?: RequestInit,
) => Promise<T>;
export interface WorkspaceFile {
  name: string;
  type: "directory" | "file";
}
export interface TelegramView {
  configured: boolean;
  enabled: boolean;
  allowWrites: boolean;
  groupId: string;
  ownerId: string;
  username: string;
  status: "disabled" | "connecting" | "connected" | "error";
  error: string;
  running: number;
  pairingExpiresAt: string;
}
