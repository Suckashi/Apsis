import assert from "node:assert/strict";
import test from "node:test";
import { taskStatusLabels, operationLabel } from "../shared/task-progress.ts";
import {
  taskText,
  taskStatus,
  taskProgress,
  taskWarning,
  taskOperation,
  taskElapsed,
  taskCount,
  taskEarlier,
} from "../public/task-locale.ts";

test("task status, actions, accessibility and loading errors are localized", () => {
  for (const status of Object.keys(
    taskStatusLabels,
  ) as (keyof typeof taskStatusLabels)[]) {
    assert.equal(taskStatus("zh-Hant", status), taskStatusLabels[status]);
    assert.doesNotMatch(taskStatus("en", status), /[\u3400-\u9fff]/);
  }
  for (const label of [
    "目前任務進度",
    "前往核准",
    "收合過程",
    "查看過程",
    "任務紀錄",
    "重新載入",
    "正在讀取紀錄…",
    "無法讀取任務紀錄，請重試。",
    "輸出過長，紀錄已截短。",
    "原始活動紀錄",
  ]) {
    assert.equal(taskText("zh-Hant", label), label);
    assert.doesNotMatch(taskText("en", label), /[\u3400-\u9fff]/);
  }
});

test("known progress is translated without rewriting raw messages or names", () => {
  assert.equal(
    taskProgress("en", "等待模型回應"),
    "Waiting for model response",
  );
  assert.equal(taskProgress("en", "正在產生回覆"), "Generating reply");
  assert.equal(taskProgress("en", "正在執行指令"), "Run command…");
  for (const raw of [
    "正在分析我的工作",
    "請寫下：等待模型回應",
    "正在讀取文件 等待模型回應.txt",
    "研究員：這是我的原始進度",
    "toString",
    "constructor",
  ]) {
    assert.equal(taskProgress("en", raw), raw);
  }
  const operation = { name: "read_file", target: "folder/等待模型回應.txt" };
  assert.equal(taskOperation("en", operation), "Read file 等待模型回應.txt");
  assert.equal(taskOperation("zh-Hant", operation), operationLabel(operation));
  assert.equal(
    taskOperation("en", { name: "custom_tool", target: "raw command" }),
    "Use tool",
  );
  assert.equal(
    taskWarning("en", "1 項協作未成功"),
    "1 collaboration did not succeed",
  );
  assert.equal(
    taskWarning("en", "2 項協作未成功"),
    "2 collaborations did not succeed",
  );
  assert.equal(
    taskWarning("en", "有操作結果不明"),
    "Some operation outcomes are unknown",
  );
  assert.equal(
    taskWarning("en", "raw warning 等待模型回應"),
    "raw warning 等待模型回應",
  );
});

test("durations, counts and remaining records support both locales", () => {
  const start = "2026-09-25T00:00:00Z";
  assert.equal(taskElapsed("en", start, Date.parse(start) + 65000), "1m 5s");
  assert.equal(
    taskElapsed("zh-Hant", start, Date.parse(start) + 65000),
    "1 分 5 秒",
  );
  assert.equal(taskElapsed("en", start, Date.parse(start) + 1000), "1s");
  assert.equal(taskElapsed("en", "invalid", 0), "—");
  assert.equal(taskCount("en", 1, "operations"), "1 operation");
  assert.equal(taskCount("en", 0, "operations"), "0 operations");
  assert.equal(taskCount("en", 2, "bots"), "2 Bots collaborating");
  assert.equal(taskCount("en", 1, "completed"), "1 completed");
  assert.equal(taskCount("zh-Hant", 2, "bots"), "2 位 Bot 協作");
  assert.equal(taskEarlier("en", 5), "Show earlier records (5 remaining)");
  assert.equal(taskEarlier("zh-Hant", 5), "顯示更早紀錄（還有 5 筆）");
});
