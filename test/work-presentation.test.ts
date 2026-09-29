import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalPresentation,
  attentionSummary,
  currentWorkStatus,
  operationGroupLabel,
  runOutcome,
} from "../shared/work-presentation.ts";
import type { RunSummary } from "../shared/task-progress.ts";
import { taskProgress, taskText } from "../public/task-locale.ts";

const summary = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  id: "run",
  status: "running",
  createdAt: "2026-09-29T00:00:00.000Z",
  operationCount: 0,
  botCount: 0,
  completedBotCount: 0,
  delegationCount: 0,
  revision: "1",
  ...overrides,
});

test("availability cannot report ready when the selected model is unavailable", () => {
  const presentation = currentWorkStatus({
    connected: true,
    modelIssue: "找不到可用的模型連線",
  });
  assert.equal(presentation.phase, "unavailable");
  assert.equal(presentation.availability, "unavailable");
  assert.equal(presentation.label, "找不到可用的模型連線");
  assert.equal(presentation.attention, true);
});

test("disconnect preserves the last known activity without inventing a stopped task", () => {
  const presentation = currentWorkStatus({
    connected: false,
    active: summary({
      progress: {
        phase: "working",
        label: "正在讀取文件 app.ts",
        updatedAt: "2026-09-29T00:00:00.000Z",
      },
    }),
  });
  assert.equal(presentation.connection, "disconnected");
  assert.equal(presentation.phase, "working");
  assert.equal(presentation.label, "正在讀取文件 app.ts");
  assert.match(presentation.detail!, /可能仍在執行/);
  assert.equal(currentWorkStatus({ connected: false }).phase, "disconnected");
});

test("approval is actionable while running and model setup stays independent", () => {
  const presentation = currentWorkStatus({
    connected: false,
    modelIssue: "missing",
    approvalCount: 1,
    active: summary(),
  });
  assert.equal(presentation.phase, "approval");
  assert.equal(presentation.label, "等待你的核准");
  assert.equal(presentation.availability, "unavailable");
  assert.equal(presentation.connection, "disconnected");
  assert.equal(
    currentWorkStatus({
      connected: true,
      active: summary({
        progress: { phase: "approval", label: "wait", updatedAt: "now" },
      }),
    }).phase,
    "approval",
  );
});

test("a completed run never retains a stale execution phase or proves task success", () => {
  const finished = summary({
    status: "completed",
    progress: { phase: "working", label: "stale", updatedAt: "now" },
  });
  assert.equal(
    currentWorkStatus({ connected: true, active: finished }).phase,
    "ready",
  );
  assert.deepEqual(runOutcome(finished), {
    kind: "completed",
    label: "回覆紀錄",
    quiet: true,
    verification: "unverified",
  });
  const work = runOutcome(summary({ status: "completed", operationCount: 4 }));
  assert.equal(work.label, "回覆結束");
  assert.equal(work.verification, "unverified");
  assert.equal(work.quiet, false);
  const failedOperation = runOutcome(
    summary({ status: "completed", operationCount: 4, warning: "有操作失敗" }),
  );
  assert.equal(failedOperation.verification, "needs-review");
  assert.equal(failedOperation.label, "回覆結束");
  assert.equal(runOutcome(summary({ status: "interrupted" })).quiet, false);
});

test("attention badges show one highest-priority state and count affected tasks once", () => {
  assert.deepEqual(
    attentionSummary([
      { approvalCount: 3, failed: true, running: true },
      { needsInput: true },
      { running: true },
      { unread: true },
    ]),
    { kind: "attention", count: 2, label: "需處理" },
  );
  assert.deepEqual(
    attentionSummary([{ running: true, unread: true }, { running: true }]),
    { kind: "running", count: 2, label: "執行中" },
  );
  assert.equal(attentionSummary([{ unread: true }]).kind, "unread");
  assert.equal(attentionSummary([]).count, 0);
});

test("approval explanation exposes the command, workspace and real effect before raw parameters", () => {
  const command = approvalPresentation({
    tool: "shell",
    args: { command: "npm test" },
    location: {
      id: "workspace",
      kind: "folder",
      name: "Test",
      path: "D:/work",
      memoryKey: "workspace",
    },
  });
  assert.equal(command.action, "執行指令");
  assert.equal(command.target, "npm test");
  assert.match(command.impact, /執行指令/);
  const file = approvalPresentation({
    tool: "edit_file",
    args: { file_path: "src/main.ts" },
  });
  assert.equal(file.target, "src/main.ts");
  assert.match(file.impact, /修改檔案/);
  assert.match(
    approvalPresentation({ tool: "read_file", args: { path: "report.md" } })
      .impact,
    /讀取/,
  );
  assert.match(
    approvalPresentation({ tool: "unknown_tool", args: null }).impact,
    /確認/,
  );
});

test("group summaries use readable actions without exposing commands or raw tool names", () => {
  assert.deepEqual(
    operationGroupLabel([
      { name: "read_file", target: "private.txt" },
      { name: "read_file", target: "other.txt" },
      { name: "shell", target: "secret-command" },
    ]),
    [
      { label: "讀取文件", count: 2 },
      { label: "執行指令", count: 1 },
    ],
  );
});

test("shared status copy translates while preserving arbitrary model text", () => {
  for (const text of [
    "回覆結束",
    "回覆紀錄",
    "等待 Bot 開始",
    "需處理",
    "尚未驗證",
    "技術詳情",
    "本次任務允許相同操作（包含由此任務派工）",
  ])
    assert.notEqual(taskText("en", text), text);
  assert.equal(taskProgress("en", "正在產生回覆"), "Generating reply");
  assert.equal(
    taskProgress("en", "模型自己提供的進度 read_file"),
    "模型自己提供的進度 read_file",
  );
});
