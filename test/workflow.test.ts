import assert from "node:assert/strict";
import test from "node:test";
import { modeRequirement } from "../public/workflow.ts";
import { exportConversation } from "../shared/export.ts";

test("mode setup distinguishes demo from configured Pi execution", () => {
  assert.equal(modeRequirement("demo", {}), null);
  assert.match(modeRequirement("pi", {})!, /模型/);
  assert.equal(modeRequirement("pi", { piReady: true }), null);
});

test("conversation export preserves content and failure status, without internal model transcripts", () => {
  const output = exportConversation({
    id: "test",
    title: "開發計畫",
    mode: "pi",
    createdAt: "2026-09-22",
    messages: [
      {
        id: "u",
        role: "user",
        content: "保留換行\n第二行",
        status: "complete",
      },
      {
        id: "a",
        role: "assistant",
        content: "```ts\nconst ready = true;\n```",
        status: "failed",
      },
    ],
  });
  assert.match(output, /# 開發計畫/);
  assert.match(output, /保留換行\n第二行/);
  assert.match(output, /Agent（failed）/);
  assert.match(output, /```ts\nconst ready = true;\n```/);
});
