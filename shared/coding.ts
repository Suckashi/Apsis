import type { WorkLocation } from "./types.ts";

export interface ConversationWorkspace {
  location: WorkLocation;
  git?: {
    repository: string;
    base: string;
    baseCommit: string;
    branch: string;
    target: string;
  };
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
