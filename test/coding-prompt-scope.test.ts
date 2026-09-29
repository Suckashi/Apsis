import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../server/app.ts";
import { agentContext } from "../server/context.ts";
import type { CodingTask } from "../shared/coding.ts";
import type { Job } from "../shared/product.ts";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "apsis-coding-prompt-"));
  const app = await createApp({
    dataDir: join(directory, "data"),
    workspaceDir: join(directory, "work"),
    runner: async () => {
      throw new Error("Prompt contract test must never invoke a runner");
    },
  });
  clearInterval(app.product.timer);
  const bot = await app.product.create("Builder");
  const session = await app.tasks.create();
  const task: CodingTask = {
    id: randomUUID(),
    botId: bot.id,
    sessionId: session.id,
    contextId: app.tasks.store.conversations.activeId(session.id),
    title: "Local implementation",
    prompt: "只在本地實作和驗證，不要 push 或 PR",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    location: app.product.workLocation(bot),
    mode: "work",
    phase: "working",
    plan: "",
    planVersion: 0,
    replyVersion: 0,
    readVersion: 0,
  };
  app.product.db.put("coding-task", task);
  app.product.db.put<Job>("job", {
    id: randomUUID(),
    botId: bot.id,
    taskId: task.id,
    executionSessionId: session.id,
    prompt: task.prompt,
    createdAt: task.createdAt,
    status: "running",
    runId: randomUUID(),
  });
  return {
    ...app,
    task,
    prompt() {
      const extension = app.tasks.extensions!(session, "fixture-run");
      return agentContext(
        app.tasks.store,
        true,
        session.agent,
        task.prompt,
        undefined,
        extension.executionContext,
      );
    },
    async close() {
      await app.product.close();
      app.product.db.db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

for (const repository of [false, true]) {
  test(`coding system prompt keeps remote publication scoped to user authorization (repository=${repository})`, async (t) => {
    const f = await fixture();
    t.after(f.close);
    if (repository) {
      f.task.git = {
        repository: f.task.location.path,
        base: "main",
        baseCommit: "fixture",
        branch: "work",
        target: "main",
      };
      f.product.db.put("coding-task", f.task);
    }
    const prompt = f.prompt();
    assert.match(
      prompt,
      /Pushing commits, creating or updating a pull request, and remote publication or deployment require the user's explicit authorization for this task/,
    );
    assert.match(
      prompt,
      /Earlier authorization remains valid unless the user narrows or revokes it/,
    );
    assert.match(
      prompt,
      /For local-only work, finish after local implementation and verification/,
    );
    assert.match(
      prompt,
      /Do not push, create a PR, publish remotely or deploy/,
    );
    assert.match(prompt, /A remote workflow is not a required completion step/);
    assert.doesNotMatch(
      prompt,
      /Use available shell\/provider tools and applicable user Skills for tests, CI and PR workflow/,
    );
    if (repository) {
      assert.match(
        prompt,
        /Only if the user authorized a PR workflow, its default target is main/,
      );
      assert.match(
        prompt,
        /After creating an authorized PR.*track_pull_request/,
      );
      assert.match(prompt, /Never claim a PR exists without a returned URL/);
    }
  });
}

test("plan mode still forbids external actions and writes", async (t) => {
  const f = await fixture();
  t.after(f.close);
  f.task.mode = "plan";
  f.product.db.put("coding-task", f.task);
  assert.match(
    f.prompt(),
    /PLAN MODE: research using read tools only\. Do not execute shell, modify code, delegate or perform external actions/,
  );
  assert.doesNotMatch(f.prompt(), /After creating an authorized PR/);
});
