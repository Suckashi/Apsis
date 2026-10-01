import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import type { TaskRun } from "../shared/types.ts";
import {
  verificationLaunch,
  verificationDirectory,
} from "./verification-browser.ts";

const directory = await mkdtemp(join(tmpdir(), "apsis-reading-position-"));
const output = resolve(verificationDirectory("artifacts/reading-position"));
await mkdir(output, { recursive: true });
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async () => ({ text: "Fixture only" }),
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
const bot = await app.product.bots.create("閱讀定位驗證");
const location = app.product.workLocation(bot);
const contextId = app.tasks.store.conversations.activeId(bot.sessionId);
const workspace = app.tasks.locations.workspace(location);
let latestRun = "";
for (let index = 0; index < 3; index++) {
  const id = randomUUID();
  latestRun = id;
  const createdAt = new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString();
  const path = `report-${index}.md`;
  await workspace.write(path, "# 虛構驗證檔案");
  const text =
    `第 ${index + 1} 份報告。\n\n` +
    "這是用來檢查閱讀位置的虛構內容。\n\n".repeat(20) +
    "```js\nconst readingFixture = true;\n```\n";
  const run: TaskRun = {
    id,
    sessionId: bot.sessionId,
    workContextId: contextId,
    location,
    engine: "deepagents",
    agentName: bot.name,
    model: "fixture",
    permissions: { files: true, memory: true, skills: true },
    status: "completed",
    createdAt,
    endedAt: createdAt,
    text,
    activity: [],
    operations: [
      {
        id: `${id}-write`,
        name: "write_file",
        target: path,
        mutating: true,
        status: "succeeded",
        startedAt: createdAt,
        endedAt: createdAt,
        evidence: { output: "Fixture file written" },
      },
    ],
  };
  await app.tasks.runs.save(run);
  for (const role of ["user", "assistant"] as const)
    app.tasks.store.conversations.append(
      bot.sessionId,
      {
        id: randomUUID(),
        runId: id,
        role,
        status: "complete",
        createdAt,
        content: role === "assistant" ? text : `檢查第 ${index + 1} 份報告。`,
      },
      contextId,
    );
}
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await verificationLaunch();
let release = () => {};
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const measurements: unknown[] = [];
  for (const mode of ["latest", "top", "older"] as const) {
    const following = mode === "latest";
    let requested = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/runs/${latestRun}`, async (route) => {
      const response = await route.fetch();
      requested = true;
      await gate;
      await route.fulfill({ response });
    });
    if (following) await page.goto(base);
    else {
      await page.locator(".messages").press("Control+End");
      await expect
        .poll(() =>
          page.evaluate(
            (id) =>
              JSON.parse(
                sessionStorage.getItem(`apsis.bot-scroll.${id}`) || "null",
              )?.following,
            bot.id,
          ),
        )
        .toBe(true);
      await page.reload();
    }
    await expect(page.locator(".message.assistant")).toHaveCount(3);
    await expect.poll(() => requested).toBe(true);
    const region = page.locator(".messages");
    const draft = page.getByRole("textbox", { name: "傳送訊息", exact: true });
    await draft.fill("保留這份未送出的草稿");
    await region.press(following ? "Control+End" : "Control+Home");
    const position = () =>
      region.evaluate((element) => ({
        top: element.scrollTop,
        height: element.scrollHeight,
        bottom: element.scrollHeight - element.clientHeight - element.scrollTop,
      }));
    await expect
      .poll(async () => (await position())[following ? "bottom" : "top"])
      .toBeLessThan(2);
    if (mode === "older") {
      await region.press("PageDown");
      let previousTop = -1;
      let stable = 0;
      await expect
        .poll(async () => {
          const { top, bottom } = await position();
          stable =
            top === previousTop && top > 100 && bottom > 100 ? stable + 1 : 0;
          previousTop = top;
          return stable;
        })
        .toBeGreaterThanOrEqual(3);
    }
    const before = await position();
    release();
    await expect(
      page.locator(".message.assistant").last().locator(".run-files > summary"),
    ).toBeVisible();
    await expect
      .poll(async () => (await position()).height)
      .toBeGreaterThan(before.height);
    await expect
      .poll(async () =>
        mode === "older"
          ? Math.abs((await position()).top - before.top)
          : (await position())[following ? "bottom" : "top"],
      )
      .toBeLessThan(2);
    await expect(region).toBeFocused();
    await expect(draft).toHaveValue("保留這份未送出的草稿");
    measurements.push({ mode, before, after: await position() });
    await page.screenshot({
      path: join(output, `${mode}.png`),
    });
    await page.unroute(`**/runs/${latestRun}`);
  }
  const composer = page.getByRole("textbox", { name: "傳送訊息", exact: true });
  await composer.fill("/");
  await composer.press("ArrowDown");
  await expect(page.locator(".suggestions button").first()).toBeFocused();
  const shellPosition = () =>
    page.evaluate(() => ({
      scrollTop: document.querySelector(".app")!.scrollTop,
      headerTop: document.querySelector(".chat-header")!.getBoundingClientRect()
        .top,
    }));
  // Focus-driven browser scrolling must never displace the outer workspace.
  // Exercise that scroll boundary explicitly; the fixture's shorter history
  // does not reproduce every focus geometry of the user's real conversation.
  await page.locator(".app").evaluate((element) => element.scrollTo(0, 300));
  await expect.poll(async () => (await shellPosition()).scrollTop).toBe(0);
  await expect.poll(async () => (await shellPosition()).headerTop).toBe(0);
  await page.keyboard.press("Escape");
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue("/");
  await expect.poll(async () => (await shellPosition()).scrollTop).toBe(0);
  measurements.push({ composerFocusShell: await shellPosition() });
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify({ measurements, errors }, null, 2),
  );
  console.log("Delayed record reading position verification passed.");
} finally {
  release();
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
