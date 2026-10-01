import type {
  Approval,
  Artifact,
  Bot,
  Connector,
  Draft,
  Job,
  Routine,
} from "./product.ts";
import type {
  DelegationRecord,
  RunSummary,
  TaskProgress,
} from "./task-progress.ts";
import type {
  ConnectionSelection,
  Memory,
  ModelConnection,
  Project,
  SessionView,
  Skill,
  TaskRun,
} from "./types.ts";
import type { DocumentNode } from "./document-preview.ts";

/** Public HTTP contracts. Browser code never imports backend service types. */
export type ArtifactPreview =
  | {
      kind: "text" | "markdown" | "html" | "document";
      content: string;
      truncated: boolean;
      previewUrl?: string;
      document?: DocumentNode[];
    }
  | { kind: "image" }
  | { kind: "pdf" }
  | { kind: "download" };

export interface BotSummary extends Bot {
  chatRunning: boolean;
  status: "waiting" | "working" | "error" | "idle";
  lastMessage: string;
  updatedAt: string;
  unread: boolean;
}
export type ConnectorView = Pick<
  Connector,
  "id" | "name" | "url" | "enabled"
> & { credentialConfigured: boolean };
export interface Snapshot {
  projects: Project[];
  bots: BotSummary[];
  connections: ModelConnection[];
  defaultModel: ConnectionSelection | null;
  connectors: ConnectorView[];
  skills: Skill[];
  skillDiagnostics: { path: string; message: string }[];
  computerOwner?: string;
}
export interface BotDetail {
  bot: Bot;
  session: SessionView;
  contextSetupError?: string;
  quotes: Record<string, string | undefined>;
  runSummaries: RunSummary[];
  currentProgress?: TaskProgress;
  unlinkedDelegations: DelegationRecord[];
  drafts: Draft[];
  jobs: Job[];
  delegations: (Job & { targetName: string; waitingApproval: boolean })[];
  approvals: Approval[];
  artifacts: Artifact[];
  routines: Routine[];
  memories: Memory[];
  runs: TaskRun[];
  browserUrl?: string;
  computerOwner?: string;
}
export interface FileReference {
  locationId: string;
  path: string;
  revision: string;
}
export interface SendMessageRequest {
  requestId: string;
  prompt: string;
  workContextId?: string;
  replyTo?: string;
  retryOf?: string;
  fileReferences?: FileReference[];
  artifactIds?: string[];
}

export type BotPreferencesRequest = Partial<
  Pick<
    Bot,
    | "name"
    | "description"
    | "avatar"
    | "connectionId"
    | "model"
    | "connectorIds"
    | "permissionMode"
    | "permissionRules"
  >
>;
export type BotCreateRequest = BotPreferencesRequest & { templateId?: string };
export type BotUpdateRequest = BotPreferencesRequest &
  Partial<Pick<Bot, "pinned" | "hidden">> & {
    read?: boolean;
    readMessageId?: string;
  };
export type TemplateRequest = BotPreferencesRequest & { name: string };
export type RoutineRequest = Pick<Routine, "name" | "prompt" | "cron"> &
  Partial<Pick<Routine, "timezone" | "enabled" | "projectId" | "branch">>;
