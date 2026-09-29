import type { WorkLocation } from "./types.ts";

export interface CodingTask {
  id: string;
  botId: string;
  sessionId: string;
  contextId: string;
  title: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  location: WorkLocation;
  git?: {
    repository: string;
    base: string;
    baseCommit: string;
    branch: string;
    target: string;
  };
  mode: "work" | "plan";
  phase:
    | "queued"
    | "working"
    | "planning"
    | "plan-ready"
    | "review"
    | "blocked"
    | "stopped"
    | "done";
  plan: string;
  planVersion: number;
  replyVersion: number;
  readVersion: number;
  jobId?: string;
  error?: string;
  summary?: string;
  pullRequest?: PullRequestLink;
  requestFingerprint?: string;
}
export interface GitChange {
  path: string;
  status: string;
  binary?: boolean;
  before?: string;
  after?: string;
  truncated?: boolean;
}
export interface GitOverview {
  branch: string;
  base: string;
  baseCommit: string;
  target: string;
  files: GitChange[];
  commits: { hash: string; parents: string[]; subject: string; refs: string }[];
  graph: string;
}

export interface PullRequestLink {
  url: string;
  provider: "github" | "gitlab" | "azure";
  status: string;
  checkedAt: string;
  fingerprint?: string;
  followUps: number;
  error?: string;
}
