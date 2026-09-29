import type { ProductDB } from "./product-db.ts";
import type { Store } from "./store.ts";

/** Discard the retired task model before any jobs can resume. */
export async function discardCodingTasks(db: ProductDB, store: Store) {
  const tasks = db.all<{ id: string; sessionId: string; contextId: string }>(
    "coding-task",
  );
  if (!tasks.length) return;
  const ids = new Set(tasks.map((t) => t.id));
  const contexts = new Set(tasks.map((t) => t.contextId));
  const jobs = db.all<{
    id: string;
    taskId?: string;
    parentJobId?: string;
    rootJobId?: string;
    workContextId?: string;
    runId?: string;
  }>("job");
  const retiredJobs = new Set(
    jobs.filter((j) => ids.has(j.taskId || "")).map((j) => j.id),
  );
  for (let changed = true; changed; ) {
    changed = false;
    for (const job of jobs)
      if (
        !retiredJobs.has(job.id) &&
        (retiredJobs.has(job.parentJobId || "") ||
          retiredJobs.has(job.rootJobId || ""))
      ) {
        retiredJobs.add(job.id);
        changed = true;
      }
  }
  const runIds = new Set<string>();
  for (const job of jobs)
    if (retiredJobs.has(job.id)) {
      if (job.workContextId) contexts.add(job.workContextId);
      if (job.runId) runIds.add(job.runId);
    }
  const sessions = new Set(tasks.map((task) => task.sessionId));
  await store.mutate((state) => {
    state.sessions = state.sessions.filter(
      (session) => !sessions.has(session.id),
    );
  });
  db.transaction(() => {
    for (const kind of [
      "coding-task",
      "job",
      "artifact",
      "approval",
      "web-verification",
      "session-allow",
    ]) {
      for (const row of db.all<{
        id: string;
        taskId?: string;
        workContextId?: string;
        runId?: string;
      }>(kind)) {
        if (
          kind === "coding-task" ||
          retiredJobs.has(row.id) ||
          ids.has(row.taskId || "") ||
          contexts.has(row.workContextId || "") ||
          runIds.has(row.runId || "")
        ) {
          db.remove(kind, row.id);
        }
      }
    }
  });
}
