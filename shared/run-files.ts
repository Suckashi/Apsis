import type { TaskRun, WorkLocation } from "./types.ts";

export interface RunFile {
  path: string;
  location: WorkLocation;
  workContextId: string;
}

/** File shortcuts come from successful workspace writes, never model prose. */
export function changedRunFiles(run: TaskRun): RunFile[] {
  if (!run.location || !run.workContextId) return [];
  const root = run.location.path.replaceAll("\\", "/").replace(/\/$/, "");
  const windows = /^[a-z]:\//i.test(root) || root.startsWith("//");
  const compare = (value: string) => (windows ? value.toLowerCase() : value);
  const paths = new Map<string, string>();
  for (const operation of run.operations) {
    if (
      operation.status !== "succeeded" ||
      !/^(write_file|edit_file)$/.test(operation.name) ||
      !operation.target
    )
      continue;
    let path = operation.target.replaceAll("\\", "/");
    if (compare(path).startsWith(compare(root + "/")))
      path = path.slice(root.length + 1);
    if (path.startsWith("/") || /[:\u0000]/.test(path)) continue;
    const parts = path.split("/");
    if (parts.includes("..")) continue;
    path = parts.filter((part) => part && part !== ".").join("/");
    if (path) paths.set(compare(path), path);
  }
  return [...paths.values()].map((path) => ({
    path,
    location: run.location!,
    workContextId: run.workContextId!,
  }));
}
