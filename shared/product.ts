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
}
export interface Approval {
  id: string;
  botId: string;
  runId: string;
  tool: string;
  args: unknown;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
}
export interface Routine {
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
}
export interface Job {
  id: string;
  botId: string;
  prompt: string;
  createdAt: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  error?: string;
  runId?: string;
  replyTo?: string;
}
export interface Artifact {
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
