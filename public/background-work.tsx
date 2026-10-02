import { useWorkRequest } from "./use-work-request.ts";
import { AssistantPresence } from "./assistant-presence.tsx";
import { useState } from "react";
import type { BotDetail } from "../shared/api.ts";
import type { Job } from "../shared/product.ts";
import { api } from "./chat-api.ts";
import { uiText } from "./settings-dictionary.ts";
import { Markdown } from "./chat-visuals.tsx";

export function BackgroundWork({
  detail,
  refresh,
  connected,
}: {
  connected: boolean;
  detail: BotDetail;
  refresh: () => Promise<unknown>;
}) {
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const submission = useWorkRequest(
    detail.bot.id,
    "/work",
    (request) => `/work/${request.requestId}`,
  );
  const work = detail.jobs.filter(
    (j) => j.sessionId && j.sessionId !== detail.bot.sessionId,
  );
  async function act(operation: () => Promise<unknown>) {
    setError("");
    try {
      await operation();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="background-work" aria-label={uiText("背景工作")}>
      <h2>{uiText("背景工作")}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            if (await submission.send({ prompt })) setPrompt("");
          });
        }}
      >
        <label htmlFor="background-prompt">{uiText("交辦獨立工作")}</label>
        <textarea
          id="background-prompt"
          value={submission.pending?.prompt ?? prompt}
          readOnly={!!submission.pending}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={16000}
          rows={3}
        />
        <button
          disabled={
            submission.busy || !(submission.pending?.prompt ?? prompt).trim()
          }
        >
          {uiText("開始背景工作")}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {!work.length && <p>{uiText("工作會在這裡更新，你可以繼續聊天。")}</p>}
      {work
        .slice()
        .reverse()
        .map((job) => (
          <WorkCard
            key={job.id}
            job={job}
            act={act}
            artifacts={detail.artifacts.filter((a) => a.runId === job.runId)}
            presence={
              <AssistantPresence
                avatar={detail.bot.avatar}
                status={
                  job.status === "running" && !job.runId ? "queued" : job.status
                }
                progress={
                  detail.runSummaries.find((r) => r.id === job.runId)?.progress
                }
                connected={connected}
                background
              />
            }
          />
        ))}
      {detail.approvals
        .filter(
          (a) => a.status === "pending" && a.sessionId !== detail.bot.sessionId,
        )
        .map((approval) => (
          <details key={approval.id} open className="work-approval">
            <summary>
              {uiText("等待你的核准")} · {approval.tool}
            </summary>
            {approval.location?.path && (
              <p className="work-approval-location">
                {uiText("工作位置：")}
                {approval.location.path}
              </p>
            )}
            <p>{approval.impact}</p>
            <p>
              {detail.jobs
                .find((j) => j.id === approval.jobId)
                ?.prompt.slice(0, 100)}
            </p>
            <pre>{JSON.stringify(approval.args, null, 2)}</pre>
            <button
              onClick={() =>
                void act(() =>
                  api(`/approvals/${approval.id}`, "POST", { approved: true }),
                )
              }
            >
              {uiText("核准一次")}
            </button>
            <button
              onClick={() =>
                void act(() =>
                  api(`/approvals/${approval.id}`, "POST", { approved: false }),
                )
              }
            >
              {uiText("拒絕")}
            </button>
          </details>
        ))}
    </section>
  );
}
function WorkCard({
  job,
  act,
  presence,
  artifacts,
}: {
  artifacts: import("../shared/product.ts").Artifact[];
  presence: import("react").ReactNode;
  job: Job;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [steer, setSteer] = useState("");
  const [record, setRecord] = useState<unknown>();
  const active = ["running", "queued"].includes(job.status);
  const control = { sessionId: job.sessionId, runId: job.runId };
  const steering = useWorkRequest(
    `${job.id}:${job.runId}:steer`,
    `/work/${job.id}/steer`,
    (request) => `/work/${job.id}/steer/${request.requestId}`,
  );
  return (
    <details className="work-card" data-job-id={job.id}>
      <summary>
        <strong>{job.prompt.slice(0, 90)}</strong>
        {presence}
      </summary>
      {job.result && <Markdown text={job.result} />}
      {artifacts.map((a) => (
        <p key={a.id}>
          <a href={`/api/v2/artifacts/${a.id}`} download>
            {a.name}
          </a>
        </p>
      ))}
      {job.error && <p role="status">{job.error}</p>}
      {active && (
        <button
          onClick={() =>
            void act(() => api(`/work/${job.id}/stop`, "POST", control))
          }
        >
          {uiText("停止這項工作")}
        </button>
      )}
      {job.status === "running" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              if (await steering.send({ ...control, prompt: steer }))
                setSteer("");
            });
          }}
        >
          <label>
            {uiText("補充這項工作")}
            <input
              value={steering.pending?.prompt ?? steer}
              readOnly={!!steering.pending}
              onChange={(e) => setSteer(e.target.value)}
            />
          </label>
          <button
            disabled={
              steering.busy || !(steering.pending?.prompt ?? steer).trim()
            }
          >
            {uiText("傳送")}
          </button>
        </form>
      )}
      <details>
        <summary>{uiText("執行細節")}</summary>
        <p>
          Job: {job.id}
          <br />
          Session: {job.sessionId}
          <br />
          Run: {job.runId}
        </p>
        <button
          onClick={() =>
            void act(async () => setRecord(await api(`/work/${job.id}`)))
          }
        >
          {uiText("載入紀錄")}
        </button>
        {record !== undefined && <pre>{JSON.stringify(record, null, 2)}</pre>}
      </details>
    </details>
  );
}
