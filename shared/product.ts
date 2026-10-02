import type { PermissionRule } from "./settings.ts";

export interface Bot {
  id: string;
  sessionId: string;
  name: string;
  description: string;
  avatar: string;
  pinned: boolean;
  hidden: boolean;
  createdAt: string;
  readAt: string;
  connectionId?: string;
  model?: string;
  deletedAt?: string;
  connectorIds?: string[];
  permissionMode?: "workspace" | "readonly";
  permissionRules?: PermissionRule[];
}
export interface BotTemplate {
  id: string;
  name: string;
  description: string;
  avatar: string;
  connectionId?: string;
  model?: string;
  connectorIds: string[];
  permissionMode: "workspace" | "readonly";
  permissionRules: PermissionRule[];
}
export interface Approval {
  sessionId?: string;
  jobId?: string;
  impact?: string;
  workContextId?: string;
  location?: import("./types.ts").WorkLocation;
  matchedRuleIds?: string[];
  reason?: string;
  dangerousCommand?: string;
  rememberAllowed?: boolean;
  fingerprint?: string;
  id: string;
  botId: string;
  runId: string;
  tool: string;
  args: unknown;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
}
export interface Routine {
  projectId?: string;
  branch?: string;
  location?: import("./types.ts").WorkLocation;
  blockedReason?: string;
  id: string;
  botId: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  nextAt: string;
  lastAt?: string;
  history: { at: string; jobId: string }[];
  permissionBotIds?: string[];
}
export interface Job {
  /** Execution owner; independent work never shares the main chat session. */
  sessionId?: string;
  completionMessageId?: string;
  location?: import("./types.ts").WorkLocation;
  fileReferences?: { locationId: string; path: string; revision: string }[];
  /** Set only when enqueuing work after the collection feature is initialized. */
  retryOf?: string;
  workContextId?: string;
  contextKind?: "chat" | "routine" | "delegation";
  id: string;
  botId: string;
  prompt: string;
  createdAt: string;
  status:
    "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  error?: string;
  dismissedAt?: string;
  runId?: string;
  replyTo?: string;
  delegatedBy?: string;
  delegatedByName?: string;
  parentJobId?: string;
  rootJobId?: string;
  delegationPath?: string[];
  permissionBotIds?: string[];
  result?: string;
}
export interface Artifact {
  bundle?: {
    entry: string;
    files: { path: string; snapshotPath: string }[];
    archivePath: string;
    totalBytes: number;
  };
  document?: {
    seriesId: string;
    revision: number;
    contentFormat: "plain" | "markdown" | "json-rows";
    contentHash: string;
    sourcePath?: string;
    pageCount?: number;
    layoutVerified: false;
  };
  deliveredFrom?: string;
  location?: import("./types.ts").WorkLocation;
  workContextId?: string;
  snapshotPath?: string;
  id: string;
  botId: string;
  runId?: string;
  name: string;
  path: string;
  mime: string;
  createdAt: string;
  kind: "attachment" | "result";
}
export interface Connector {
  id: string;
  name: string;
  url: string;
  token?: string;
  headers?: Record<string, string>;
  bearerTokenEnvVar?: string;
  startupTimeoutMs?: number;
  toolTimeoutMs?: number;
  enabled: boolean;
}
export interface Draft {
  id: string;
  botId: string;
  runId: string;
  title: string;
  connectorId: string;
  tool: string;
  arguments: string;
  status: "draft" | "sending" | "sent" | "discarded" | "unknown";
  createdAt: string;
  result?: string;
}
