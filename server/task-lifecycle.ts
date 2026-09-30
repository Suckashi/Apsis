import type { Job } from "../shared/product.ts";
import type { TaskRun, ChatMessage } from "../shared/types.ts";

export function finishUserMessage(
  message: ChatMessage,
  status: "complete" | "failed",
): ChatMessage {
  if (message.role !== "user" || message.status !== "pending")
    throw new Error(
      `Invalid message transition: ${message.status} → ${status}`,
    );
  return { ...message, status };
}

/** Late steering callbacks cannot overwrite an already settled receipt. */
export function finishDelivery(
  message: ChatMessage,
  state: "applied" | "not-applied",
): ChatMessage {
  if (message.delivery?.state !== "pending") return message;
  return {
    ...message,
    delivery: {
      ...message.delivery,
      state,
      updatedAt: new Date().toISOString(),
    },
  };
}

/** Terminal outcomes never resume; retries create a new task. */
export function transitionJob(
  job: Job,
  status: Job["status"],
  error?: string,
): Job {
  const allowed =
    job.status === "queued"
      ? ["running", "cancelled", "interrupted"]
      : job.status === "running"
        ? ["completed", "failed", "cancelled", "interrupted"]
        : [];
  if (!allowed.includes(status))
    throw new Error(`Invalid job transition: ${job.status} → ${status}`);
  return { ...job, status, ...(error === undefined ? {} : { error }) };
}

export function finishRun(
  run: TaskRun,
  status: Exclude<TaskRun["status"], "running">,
  error?: string,
): TaskRun {
  if (run.status !== "running")
    throw new Error(`Invalid run transition: ${run.status} → ${status}`);
  const endedAt = new Date().toISOString();
  return {
    ...run,
    status,
    endedAt,
    ...(error === undefined ? {} : { error }),
    operations: run.operations.map((operation) =>
      operation.status === "started"
        ? { ...operation, status: "unknown", endedAt }
        : operation,
    ),
  };
}

/** Reconcile the journal/transcript commit window after process termination. */
export function recoverRun(run: TaskRun, completionCommitted = true): TaskRun {
  if (
    run.status !== "running" &&
    (run.status !== "completed" || completionCommitted)
  )
    return run;
  return finishRun(
    { ...run, status: "running" },
    "interrupted",
    "服務重新啟動，任務中斷；請先檢查已完成與結果不明的操作。",
  );
}

export function recoverJob(job: Job, run?: TaskRun): Job {
  if (job.status !== "queued" && job.status !== "running") return job;
  if (job.status === "running" && run && run.status !== "running") {
    const recovered = transitionJob(job, run.status, run.error);
    return run.status === "completed"
      ? { ...recovered, result: run.text.slice(0, 16000) }
      : recovered;
  }
  return transitionJob(
    job,
    "interrupted",
    "服務重新啟動，請確認先前操作後重新交辦。",
  );
}
