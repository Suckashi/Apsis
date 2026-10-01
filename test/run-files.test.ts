import assert from "node:assert/strict";
import test from "node:test";
import { changedRunFiles } from "../shared/run-files.ts";
import type { TaskRun, ToolOperation, WorkLocation } from "../shared/types.ts";

test("file shortcuts retain original scope, deduplicate real writes and reject unsafe targets", () => {
  const location = { id: "original", path: "D:/work/project" } as WorkLocation;
  const operation = (
    target: string,
    name = "write_file",
    status: ToolOperation["status"] = "succeeded",
  ): ToolOperation => ({
    id: target + name,
    name,
    target,
    status,
    startedAt: "2026-10-01T00:00:00Z",
    mutating: true,
  });
  const run = {
    location,
    workContextId: "earlier-topic",
    operations: [
      operation("bundle/說明.md"),
      operation("D:\\work\\project\\bundle\\說明.md", "edit_file"),
      operation("bundle/not-written.md", "write_file", "failed"),
      operation("bundle/unsure.md", "write_file", "unknown"),
      operation("bundle/preparing.md", "write_file", "started"),
      operation("bundle/read.md", "read_file"),
      operation("/scratch/private.md", "scratch_write_file"),
      operation("shell-command", "shell"),
      ...[
        "../escape.md",
        "bundle/../../escape.md",
        "D:/work/project-other/file.md",
        "D:/private.md",
        "/etc/passwd",
        "https://example.com/file",
        "bad\0path",
      ].map((path) => operation(path)),
    ],
  } as TaskRun;
  assert.deepEqual(changedRunFiles(run), [
    { path: "bundle/說明.md", location, workContextId: "earlier-topic" },
  ]);
  assert.deepEqual(changedRunFiles({ ...run, location: undefined }), []);
  assert.deepEqual(changedRunFiles({ ...run, workContextId: undefined }), []);
});

test("Linux paths retain case and absolute files must belong to the recorded root", () => {
  const location = { id: "linux", path: "/work/project" } as WorkLocation;
  const run = {
    location,
    workContextId: "topic",
    operations: [
      "/work/project/A.md",
      "/work/project/a.md",
      "/work/PROJECT/private.md",
    ].map((target, i) => ({
      id: String(i),
      target,
      name: "write_file",
      status: "succeeded",
      mutating: true,
      startedAt: "2026-10-01T00:00:00Z",
    })),
  } as TaskRun;
  assert.deepEqual(
    changedRunFiles(run).map((file) => file.path),
    ["A.md", "a.md"],
  );
});
