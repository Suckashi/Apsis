import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";
import type { Job } from "../shared/product.ts";

// Opt-in live Ollama test. Uses isolated Bot data, never the user's conversations.
const directory = await mkdtemp(join(tmpdir(), "apsis-delegation-live-"));
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
});
const product = app.product!;
try {
  const connection = await app.tasks.connections!.save({
    name: "Live Ollama",
    provider: "ollama",
    model: process.env.OLLAMA_MODEL || "qwen3.5:9b",
    url: process.env.OLLAMA_URL || "http://127.0.0.1:11434",
  });
  await app.tasks.connections!.setDefault({
    connectionId: connection.id,
    model: connection.model,
  });
  const worker = await product.create("計算助理", {
    description: "完成交辦的簡單算術並回報數字。",
  });
  const secretary = await product.create("秘書", {
    description:
      "使用 list_bots 尋找計算助理，再用 delegate_task 派工，收到結果後回覆使用者。",
  });
  const job = await product.submit(secretary.id, {
    requestId: "live-secretary",
    prompt: "請找計算助理，派他計算 17 乘以 19，拿到實際結果後告訴我答案。",
  });
  const deadline = Date.now() + 120000;
  while (product.active.size && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(product.active.size, 0, "Live delegation timed out");
  const parent = product.db.get<Job>("job", job.id)!;
  const child = product.db
    .all<Job>("job")
    .find((j) => j.parentJobId === job.id && j.botId === worker.id);
  assert.equal(child?.status, "completed", JSON.stringify({ parent, child }));
  assert.match(child!.result || "", /323/);
  assert.equal(parent.status, "completed");
  assert.match(parent.result || "", /323/);
  console.log(
    JSON.stringify(
      {
        model: connection.model,
        delegated: true,
        childResult: child!.result,
        secretaryReply: parent.result,
      },
      null,
      2,
    ),
  );
} finally {
  for (const bot of product.snapshot().bots) app.tasks.stop(bot.sessionId);
  await product.close();
}
