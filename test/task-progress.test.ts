import test from "node:test";
import assert from "node:assert/strict";
import type { Bot, Job, Approval } from "../shared/product.ts";
import type { TaskRun, ToolOperation } from "../shared/types.ts";
import { taskPresentation } from "../server/task-progress.ts";

const at = "2026-09-25T00:00:00.000Z";
const bot = (id: string): Bot => ({
  id,
  sessionId: `session-${id}`,
  name: id,
  description: "",
  avatar: "cloud",
  pinned: false,
  hidden: false,
  createdAt: at,
  readAt: at,
});
const run = (id: string, botId = "secretary"): TaskRun => ({
  id,
  sessionId: `session-${botId}`,
  engine: "deepagents",
  agentName: botId,
  model: "test",
  permissions: { files: true, memory: true, skills: true },
  status: "running",
  createdAt: at,
  text: "",
  activity: [],
  operations: [],
});
const job = (
  id: string,
  botId: string,
  runId?: string,
  parentJobId?: string,
): Job => ({
  id,
  botId,
  runId,
  parentJobId,
  rootJobId: parentJobId ? "root" : undefined,
  delegatedBy: parentJobId ? "secretary" : undefined,
  prompt: `工作 ${id}`,
  status: "running",
  createdAt: at,
});
const operation = (
  id: string,
  status: ToolOperation["status"] = "started",
): ToolOperation => ({
  id,
  status,
  name: "read_file",
  target: "folder/report.pdf",
  startedAt: at,
  mutating: false,
});

test("progress shows actual tools, approvals, child work and truthful model waiting", () => {
  const owner = bot("secretary"),
    worker = bot("研究助理");
  const parent = run("r1"),
    child = run("r2", worker.id);
  const jobs = [
    job("root", owner.id, parent.id),
    job("child", worker.id, child.id, "root"),
  ];
  parent.operations = [{ ...operation("delegate"), name: "delegate_task" }];
  child.operations = [operation("read")];
  const present = (approvals: Approval[] = []) =>
    taskPresentation(owner, [parent, child], jobs, [owner, worker], approvals)
      .summaries[0];
  assert.match(present().progress!.label, /研究助理：正在讀取文件 report.pdf/);
  assert.equal(present().progress?.phase, "delegating");
  const approval: Approval = {
    id: "approval",
    botId: worker.id,
    runId: child.id,
    tool: "shell",
    args: {},
    status: "pending",
    createdAt: at,
  };
  assert.equal(present([approval]).progress?.approvalBotId, worker.id);
  assert.equal(present([approval]).progress?.phase, "approval");
  assert.match(present([approval]).progress!.label, /等待你的核准/);
  jobs[1].status = "queued";
  assert.match(present().progress!.label, /等待 研究助理 開始任務/);
  assert.equal(present().progress?.phase, "queued");
  jobs[1].status = "completed";
  parent.operations[0].status = "succeeded";
  parent.operations[0].endedAt = "2026-09-25T00:00:02.000Z";
  parent.progress = { kind: "message", text: "先查看文件", updatedAt: at };
  assert.equal(present().progress!.label, "等待模型回應");
  assert.equal(present().progress?.phase, "waiting");
  parent.progress = { kind: "reply", updatedAt: "2026-09-25T00:00:03.000Z" };
  assert.equal(present().progress!.label, "正在產生回覆");
  assert.equal(present().progress?.phase, "reply");
});

test("run summaries isolate turns, preserve repeated jobs, deduplicate bots and expose partial failure", () => {
  const owner = bot("secretary");
  const first = run("first"),
    second = run("second"),
    nested = run("nested", "a");
  first.operations = [operation("same"), operation("same", "succeeded")];
  first.status = "completed";
  const jobs = [
    job("root", owner.id, first.id),
    job("other", owner.id, second.id),
    job("a1", "a", nested.id, "root"),
    job("a2", "a", undefined, "root"),
    job("b", "b", undefined, "a1"),
    { ...job("unrelated", "c", undefined, "other"), rootJobId: "other" },
  ];
  jobs[2].status = "completed";
  jobs[3].status = "failed";
  jobs[4].status = "completed";
  const result = taskPresentation(
    owner,
    [first, second, nested],
    jobs,
    [owner, bot("a"), bot("b"), bot("c")],
    [],
  );
  const summary = result.summaries[0];
  assert.equal(summary.operationCount, 1);
  assert.equal(summary.delegationCount, 3);
  assert.equal(summary.botCount, 2);
  assert.equal(summary.completedBotCount, 1);
  assert.equal(summary.warning, "1 項協作未成功");
  assert.deepEqual(
    result.records(first).delegations.map((j) => j.id),
    ["a1", "a2", "b"],
  );
  assert.deepEqual(
    result.records(second).delegations.map((j) => j.id),
    ["unrelated"],
  );
  const workerView = taskPresentation(
    bot("a"),
    [first, second, nested],
    jobs,
    [owner, bot("a"), bot("b")],
    [],
  );
  assert.deepEqual(
    workerView.records(nested).delegations.map((j) => j.id),
    ["a1", "b"],
  );
  assert.equal(workerView.records(nested).delegations[0].outgoing, false);
});

test("unlinked records remain visible and terminal uncertainty is not success", () => {
  const owner = bot("secretary"),
    task = run("old");
  const older = { ...job("legacy", "a"), delegatedBy: owner.id };
  task.status = "interrupted";
  task.operations = [operation("op", "unknown")];
  const result = taskPresentation(owner, [task], [older], [owner], []);
  assert.equal(result.unlinked[0].id, older.id);
  assert.equal(result.unlinked[0].peerName, "已刪除的 Bot");
  assert.equal(result.summaries[0].warning, "有操作結果不明");
  assert.equal(result.summaries[0].progress, undefined);
});

test("reloaded runs sort chronologically and finished parallel work clears stale commentary", () => {
  const owner = bot("secretary"),
    first = run("first"),
    latest = run("latest");
  latest.createdAt = "2026-09-25T00:01:00.000Z";
  latest.operations = [
    { ...operation("long", "succeeded"), endedAt: "2026-09-25T00:01:10.000Z" },
    { ...operation("short", "succeeded"), endedAt: "2026-09-25T00:01:02.000Z" },
  ];
  latest.progress = {
    kind: "message",
    text: "working",
    updatedAt: "2026-09-25T00:01:05.000Z",
  };
  const result = taskPresentation(owner, [latest, first], [], [owner], []);
  assert.deepEqual(
    result.summaries.map((r) => r.id),
    ["first", "latest"],
  );
  assert.equal(result.summaries[1].progress?.label, "等待模型回應");
});
