import type { AgentMessage } from "@earendil-works/pi-agent-core";

export type Provider = "openai" | "anthropic" | "ollama";
export type Mode = "demo" | "pi" | "hybrid" | "hermes";
export type Environment = Record<string, string | undefined>;
export interface Memory {
  id: string;
  content: string;
  createdAt?: string;
}
export interface Skill extends Memory {
  name: string;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "complete" | "failed" | "error";
  activity?: string[];
}
export interface Session {
  id: string;
  title: string;
  mode: Mode;
  createdAt: string;
  messages: ChatMessage[];
  piMessages: AgentMessage[];
}
export type SessionView = Omit<Session, "piMessages"> & { running?: boolean };
export type SessionSummary = Omit<Session, "piMessages" | "messages"> & {
  count: number;
  running: boolean;
};
export interface StoreState {
  sessions: Session[];
  memories: Memory[];
  skills: Skill[];
}
export type RunEvent =
  | { type: "delta" | "activity" | "error"; text: string; tool?: string }
  | { type: "done" };
export interface RunResult {
  text: string;
  piMessages?: AgentMessage[];
}
export interface Status {
  provider: string;
  model: string;
  piReady: boolean;
  hermesReady: boolean;
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
  };
  hermes: { url: string; model: string; credential: CredentialState };
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
