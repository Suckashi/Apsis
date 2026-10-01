import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

// Verify the bytes actually downloaded in Chrome, without the Apsis API or
// preview server. Use isolated profiles and only the declared test ZIP files.
const revised = process.argv.includes("--revised");
const evidence = resolve(
  "artifacts/live-multifile-comparison",
  revised ? "revised" : ".",
);
const output = join(evidence, "offline");
await mkdir(output, { recursive: true });
const manifest: { name: string; sha256: string }[] = JSON.parse(
  await readFile(join(evidence, "download-files.json"), "utf8"),
);
const zip = await JSZip.loadAsync(
  await readFile(
    join(evidence, revised ? "離線待辦清單・修正版.zip" : "離線待辦清單.zip"),
  ),
);
const expected = ["index.html", "styles.css", "app.js"].map(
  (name) => `uiux-multifile-20261001/${name}`,
);
assert.deepEqual(Object.keys(zip.files).sort(), [...expected].sort());
if (revised) {
  const original = await JSZip.loadAsync(
    await readFile(
      resolve("artifacts/live-multifile-comparison/離線待辦清單.zip"),
    ),
  );
  for (const name of expected) {
    const before = await original.file(name)!.async("string");
    const after = await zip.file(name)!.async("string");
    const permitted = name.endsWith("index.html")
      ? before.replace("仍会保留", "仍會保留")
      : name.endsWith("styles.css")
        ? before.replace("--done: #8a929c;", "--done: #606975;")
        : before;
    assert.equal(
      after,
      permitted,
      `${name} contains only the requested correction`,
    );
  }
}
const root = await mkdtemp(join(tmpdir(), "apsis-downloaded-todo-"));
await mkdir(join(root, "uiux-multifile-20261001"));
for (const name of expected) {
  const data = await zip.file(name)!.async("nodebuffer");
  const hash = createHash("sha256").update(data).digest("hex");
  assert.equal(hash, manifest.find((file) => file.name === name)?.sha256);
  await writeFile(join(root, name), data);
}
const reports: object[] = [];
for (const channel of ["chrome", "msedge"] as const) {
  const browser = await chromium.launch({ channel, headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    const external: string[] = [],
      errors: string[] = [];
    await context.route(/^https?:/, (route) => {
      external.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(join(root, expected[0])).href);
    await expect(
      page.getByRole("heading", { name: "離線待辦清單", exact: true }),
    ).toBeVisible();
    if (revised) {
      await expect(page.locator("body")).toContainText("仍會保留");
      await expect(page.locator("body")).not.toContainText("仍会保留");
    }
    const input = page.getByRole("textbox", { name: "新事項", exact: true });
    await input.fill("離線保存驗證");
    await page.getByRole("button", { name: "新增", exact: true }).click();
    await expect(input).toHaveValue("");
    await expect(page.locator("#task-list")).toContainText("離線保存驗證");
    await page
      .getByRole("button", { name: "標記為已完成：離線保存驗證", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "標記為未完成：離線保存驗證",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "未完成", exact: true }).click();
    await expect(page.locator("#task-list .task")).toHaveCount(0);
    await page.getByRole("button", { name: "已完成", exact: true }).click();
    await expect(page.locator("#task-list .task")).toHaveCount(1);
    await page.reload();
    await expect(
      page.getByRole("button", {
        name: "標記為未完成：離線保存驗證",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#task-list")).toContainText("離線保存驗證");
    assert.deepEqual(external, [], "offline artifact needs no network");
    if (revised)
      await expect(page.locator(".task.is-done .task__text")).toHaveCSS(
        "color",
        "rgb(96, 105, 117)",
      );
    assert.deepEqual(errors, []);
    const audit = await new AxeBuilder({ page }).analyze();
    if (revised) {
      assert.deepEqual(
        audit.violations,
        [],
        "revised completed view has no automatic accessibility violations",
      );
      assert.deepEqual(
        audit.incomplete,
        [],
        "retain uncertainty rather than report a clean scan",
      );
    }
    await page.screenshot({
      path: join(output, `${channel}.png`),
      fullPage: true,
    });
    reports.push({
      channel,
      protocol: new URL(page.url()).protocol,
      generatedFromActualDownload: true,
      hashesMatched: true,
      added: true,
      completed: true,
      filtered: true,
      reloadPreserved: true,
      external,
      errors,
      violations: audit.violations,
      incomplete: audit.incomplete,
    });
    await context.close();
  } finally {
    await browser.close();
  }
}
await writeFile(
  join(output, "report.json"),
  JSON.stringify({ reports }, null, 2),
);
console.log(
  JSON.stringify({
    browsers: reports.length,
    offline: true,
    persistence: true,
  }),
);
