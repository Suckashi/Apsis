import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import { createTools } from "../server/tools.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { RunStore } from "../server/runs.ts";

const directory = await mkdtemp(join(tmpdir(), "apsis-shell-outcome-"));
const output = resolve("artifacts/shell-outcomes");
await mkdir(output, { recursive: true });
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async (options) => {
    // Isolated fixture executes only these fixed commands; no external model calls.
    const shell = createTools({
      ...options,
      permissions: { files: true, shell: true, memory: false, skills: false },
      authorize: async () => ({ fingerprint: "fixture", reason: "yolo-mode" }),
      checkToolPermission: undefined,
      executeAuthorizedTool: undefined,
    }).find((tool) => tool.name === "shell")!;
    if (options.prompt === "known exit") {
      await assert.rejects(
        shell.execute(
          "nonzero",
          {
            command:
              "printf 'retained' > partial.txt; printf 'check failed'; exit 7",
          },
          options.signal,
        ),
        /結束碼：7/,
      );
      assert.equal(
        await readFile(join(options.workspace.root, "partial.txt"), "utf8"),
        "retained",
      );
      return { text: "指令以結束碼 7 失敗；失敗前寫入的 partial.txt 仍保留。" };
    }
    assert.equal(options.prompt, "timeout");
    await assert.rejects(
      shell.execute(
        "timeout",
        { command: "printf 'started'; sleep 30 & wait", timeout: 1 },
        options.signal,
      ),
      /逾時/,
    );
    return { text: "指令已逾時，操作結果不明，先確認現有狀態再決定是否重試。" };
  },
});
const connection = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture",
  url: "http://127.0.0.1:1/v1",
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
const bot = await app.product.bots.create("執行結果驗證");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
try {
  for (const prompt of ["known exit", "timeout"]) {
    await app.product.jobs.submit(bot.id, { requestId: randomUUID(), prompt });
    await expect.poll(() => app.tasks.running.size, { timeout: 10000 }).toBe(0);
  }
  const detail = await (await fetch(`${base}/api/v2/bots/${bot.id}`)).json();
  const runs = detail.runs.sort(
    (a: { createdAt: string }, b: { createdAt: string }) =>
      a.createdAt.localeCompare(b.createdAt),
  );
  assert.deepEqual(
    runs.map((run: { operations: { status: string }[] }) =>
      run.operations.map((operation) => operation.status),
    ),
    [["failed"], ["unknown"]],
  );
  assert.deepEqual(
    detail.runSummaries.map((summary: { warning: string }) => summary.warning),
    ["有操作失敗", "有操作結果不明"],
  );
  const reloaded = await new RunStore(app.tasks.store.directory).init();
  for (const run of runs)
    assert.deepEqual(reloaded.records.get(run.id)?.operations, run.operations);
  const profiles = [];
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    await context.addInitScript(
      ({ botId, theme }) => {
        localStorage.setItem("apsis.bot", botId);
        localStorage.setItem("apsis.theme", theme);
      },
      { botId: bot.id, theme },
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await expect(page.locator(".message.assistant")).toHaveCount(2);
    const messages = page.locator(".message.assistant");
    await expect(
      messages.nth(0).locator(".execution-tools > summary"),
    ).toContainText("有操作失敗");
    await expect(
      messages.nth(0).locator(".execution-tools > summary"),
    ).not.toContainText("有操作結果不明");
    await expect(
      messages.nth(1).locator(".execution-tools > summary"),
    ).toContainText("有操作結果不明");
    await messages.nth(0).locator(".execution-tools > summary").click();
    await expect(messages.nth(0)).toContainText("失敗");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(output, `${theme}.png`) });
    profiles.push({ theme, errors });
    await context.close();
  }
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        profiles,
        partialEffectsRetained: true,
        journalReload: true,
        knownExit: 7,
        timeoutRemainsUnknown: true,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, output }));
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
