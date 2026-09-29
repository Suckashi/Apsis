import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { git } from "./git-workspaces.ts";
const exec = promisify(execFile);
export type { PullRequestLink } from "../shared/coding.ts";
export interface PullRequestState {
  status: string;
  actionable: boolean;
  evidence: unknown;
  fingerprint: string;
}
export function identifyPullRequest(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("請使用 Git 平台上的 HTTPS PR 網址。");
  let match = url.pathname.match(/^\/(.+)\/pull\/(\d+)\/?$/);
  if (match)
    return {
      provider: "github" as const,
      url,
      repository: match[1],
      number: match[2],
    };
  match = url.pathname.match(/^\/(.+)\/-\/merge_requests\/(\d+)\/?$/);
  if (match)
    return {
      provider: "gitlab" as const,
      url,
      repository: match[1],
      number: match[2],
    };
  match = url.pathname.match(/^\/(.+)\/_git\/([^/]+)\/pullrequest\/(\d+)\/?$/i);
  if (
    match &&
    (url.hostname === "dev.azure.com" ||
      url.hostname.endsWith(".visualstudio.com"))
  )
    return {
      provider: "azure" as const,
      url,
      repository: `${match[1]}/_git/${match[2]}`,
      number: match[3],
    };
  throw new Error(
    "無法辨識 PR 網址，請使用 GitHub、GitLab 或 Azure DevOps PR 連結。",
  );
}
export async function validatePullRequest(root: string, raw: string) {
  const ref = identifyPullRequest(raw),
    remote = (await git(root, "remote", "get-url", "origin")).trim();
  let remoteHost = "",
    remotePath = "";
  if (remote.includes("://")) {
    const u = new URL(remote);
    remoteHost = u.hostname;
    remotePath = u.pathname;
  } else {
    const m = remote.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
    if (m) {
      remoteHost = m[1];
      remotePath = m[2];
    }
  }
  remotePath = decodeURIComponent(remotePath)
    .replace(/^\//, "")
    .replace(/\.git$/, "");
  // Azure SSH remotes use a v3 path rather than the HTTP /_git/ form.
  if (remoteHost === "ssh.dev.azure.com") {
    remoteHost = "dev.azure.com";
    remotePath = remotePath.replace(
      /^v3\/([^/]+)\/([^/]+)\/(.+)$/,
      "$1/$2/_git/$3",
    );
  }
  if (
    remoteHost.toLowerCase() !== ref.url.hostname.toLowerCase() ||
    remotePath.toLowerCase() !==
      decodeURIComponent(ref.repository).toLowerCase()
  )
    throw new Error("PR 不屬於此任務 origin repository。");
  return ref;
}
async function cli(command: string, args: string[], root: string) {
  try {
    return JSON.parse(
      (
        await exec(command, args, {
          cwd: root,
          windowsHide: true,
          timeout: 25000,
          maxBuffer: 2 * 1024 * 1024,
          env: {
            ...process.env,
            GH_PROMPT_DISABLED: "1",
            GIT_TERMINAL_PROMPT: "0",
          },
        })
      ).stdout,
    );
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new Error(
      code === "ENOENT"
        ? `請先安裝並登入 ${command}，才能追蹤 PR。`
        : `${command} 無法讀取 PR；請檢查登入、權限和網路。`,
    );
  }
}
export async function readPullRequest(
  root: string,
  raw: string,
): Promise<PullRequestState> {
  const ref = await validatePullRequest(root, raw);
  let status = "",
    actionable = false,
    evidence: unknown;
  if (ref.provider === "github") {
    const r = await cli(
      "gh",
      [
        "pr",
        "view",
        raw,
        "--json",
        "url,state,headRefOid,reviewDecision,latestReviews,statusCheckRollup,comments",
      ],
      root,
    );
    status = r.state;
    const failures = (r.statusCheckRollup || []).filter((c: any) =>
      ["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED"].includes(
        c.conclusion || c.state,
      ),
    );
    actionable =
      status === "OPEN" &&
      (failures.length > 0 || r.reviewDecision === "CHANGES_REQUESTED");
    evidence = {
      head: r.headRefOid,
      failures,
      reviews: r.latestReviews,
      comments: r.comments,
    };
  } else if (ref.provider === "gitlab") {
    const r = await cli("glab", ["mr", "view", raw, "--output", "json"], root);
    status = r.state;
    const notes = await cli(
      "glab",
      [
        "api",
        `projects/${encodeURIComponent(ref.repository)}/merge_requests/${ref.number}/notes`,
        "--hostname",
        ref.url.hostname,
      ],
      root,
    );
    actionable =
      status === "opened" &&
      (r.head_pipeline?.status === "failed" ||
        r.blocking_discussions_resolved === false);
    evidence = { head: r.sha, pipeline: r.head_pipeline, notes };
  } else {
    const token = process.env.AZURE_DEVOPS_EXT_PAT;
    if (!token)
      throw new Error("請設定 AZURE_DEVOPS_EXT_PAT 以讀取 Azure DevOps PR。");
    const api =
      ref.url.origin +
      "/" +
      ref.repository.replace("/_git/", "/_apis/git/repositories/") +
      `/pullRequests/${ref.number}`;
    const get = async (url: string) => {
      const r = await fetch(url, {
        headers: {
          Authorization: "Basic " + Buffer.from(":" + token).toString("base64"),
        },
        redirect: "error",
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) throw new Error(`Azure DevOps 無法讀取 PR (${r.status})。`);
      return r.json();
    };
    const [r, checks, threads] = await Promise.all([
      get(api + "?api-version=7.1"),
      get(api + "/statuses?api-version=7.1"),
      get(api + "/threads?api-version=7.1"),
    ]);
    status = r.status;
    const failures = (checks.value || []).filter((c: any) =>
      ["failed", "error"].includes(c.state),
    );
    actionable =
      status === "active" &&
      (failures.length > 0 || (r.reviewers || []).some((v: any) => v.vote < 0));
    evidence = {
      head: r.lastMergeSourceCommit?.commitId,
      failures,
      reviewers: r.reviewers,
      threads: threads.value,
    };
  }
  return {
    status,
    actionable,
    evidence,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(evidence))
      .digest("hex"),
  };
}
