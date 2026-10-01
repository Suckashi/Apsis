// Reinspect one completed isolated model run. Does not invoke a model, read user
// credentials, resubmit messages, or control the user's browser.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { convertToHtml } from "mammoth";
import MarkdownIt from "markdown-it";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";

const output = resolve(process.argv[2] || "artifacts/document-model-source");
const prior = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
const directory = resolve(prior.directory);
assert.equal(prior.externalModelTask, true);
assert.equal(prior.jobStatus, "completed");
assert.equal(resolve(directory, ".."), resolve(tmpdir()));
assert.ok(basename(directory).startsWith("apsis-document-model-"));
const source = await readFile(
  resolve("test/fixtures/reading-list-proposal.md"),
  "utf8",
);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, "");
const blocks = new MarkdownIt()
  .parse(source, {})
  .filter((b) => b.type === "inline")
  .map((b) => normalize(b.content));
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async () => {
    throw new Error("Inspection must not submit a task");
  },
});
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({ executablePath: browserExecutable() });
try {
  const jobs = app.product.db.jobs.list();
  assert.equal(jobs.length, 1);
  const job = jobs[0];
  assert.equal(job.status, "completed");
  const artifacts = app.product.db.artifacts.list({ botId: job.botId });
  assert.equal(
    artifacts.length,
    2,
    "The requirement remains exactly two deliverables",
  );
  assert.deepEqual(artifacts.map((a) => a.name).sort(), [
    "共用讀書清單.docx",
    "共用讀書清單.pdf",
  ]);
  const run = app.tasks.runs.records.get(job.runId!)!;
  const reads = run.operations.filter((o) => o.name === "read_document");
  const calls = prior.calls.filter(
    (c: { tool: string }) => c.tool === "create_document",
  );
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      (c: { sourcePath: string; contentSupplied: boolean }) =>
        c.sourcePath === "proposal.md" && c.contentSupplied === false,
    ),
  );
  const workspace = app.tasks.locations.workspace(
    app.product.workLocation(app.product.bots.bot(job.botId), job.runId),
  );
  assert.equal(await workspace.read("proposal.md"), source);
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  const message = page.locator(".message.assistant").last();
  const final = await readFile(join(output, "final.txt"), "utf8");
  await expect(message).toContainText(final.slice(0, 20));
  assert.match(final, /未|沒有|尚未/);
  assert.equal(
    await message.locator(".execution-evidence > details").count(),
    1,
  );
  assert.equal(
    await message.locator(".execution-tools").getAttribute("open"),
    null,
  );
  assert.ok(
    await message.evaluate((el) => {
      const artifact = el.querySelector(".artifact-card");
      const evidence = el.querySelector(".execution-evidence");
      return (
        !!artifact &&
        !!evidence &&
        !!(
          artifact.compareDocumentPosition(evidence) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      );
    }),
    "Delivered cards must precede subordinate execution evidence",
  );
  let pages = 0;
  let headings = 0;
  for (const artifact of artifacts) {
    assert.equal(artifact.document!.sourcePath, "proposal.md");
    assert.equal(artifact.document!.contentHash, hash(source));
    assert.equal(artifact.document!.layoutVerified, false);
    assert.ok(
      reads.some((operation) => operation.target?.includes(artifact.path)),
      `${artifact.name} was read by the model`,
    );
    const downloadEvent = page.waitForEvent("download");
    await message
      .getByRole("link", { name: `下載成果 ${artifact.name}`, exact: true })
      .click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), artifact.name);
    const bytes = await readFile((await download.path())!);
    assert.deepEqual(
      bytes,
      await readFile(
        join(directory, "data", "artifacts", artifact.snapshotPath!),
      ),
    );
    await writeFile(
      join(output, `model-brief.${artifact.name.split(".").at(-1)}`),
      bytes,
    );
    let text: string;
    if (artifact.name.endsWith(".docx")) {
      const html = await convertToHtml(
        { buffer: bytes },
        { styleMap: ["p[style-name='Title'] => h1:fresh"] },
      );
      text = html.value.replace(/<[^>]+>/g, "");
      headings = (html.value.match(/<h[12]>/g) || []).length;
      assert.equal(headings, 6);
    } else {
      const loading = getDocument({ data: new Uint8Array(bytes) });
      try {
        const pdf = await loading.promise;
        pages = pdf.numPages;
        assert.equal(artifact.document!.pageCount, pages);
        text = "";
        for (let n = 1; n <= pages; n++)
          text += (await (await pdf.getPage(n)).getTextContent()).items
            .map((i) => ("str" in i ? i.str : ""))
            .join(" ");
      } finally {
        await loading.destroy();
      }
    }
    for (const block of blocks)
      assert.ok(
        normalize(text).includes(block),
        `${artifact.name} retains ${block}`,
      );
  }
  await page.screenshot({ path: join(output, "verified-desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  await message
    .getByRole("button", { name: "預覽成果 共用讀書清單.docx", exact: true })
    .click();
  await expect(page.locator(".artifact-preview pre")).toContainText("驗收條件");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({ path: join(output, "verified-mobile-preview.png") });
  assert.deepEqual(errors, []);
  const report = {
    ...prior,
    passed: true,
    verificationScope:
      "Document content, source fidelity, downloads, previews and delivery hierarchy only",
    originalVerifierResult: prior.passed,
    originalVerifierError: prior.error,
    ...(prior.handoffVerification
      ? { handoffAcceptancePassed: prior.passed }
      : {}),
    verificationMethod:
      "Reinspection of the same completed model job; no resubmission",
    directSourceConversion: true,
    artifacts: artifacts.map((a) => ({ name: a.name, document: a.document })),
    sourceUnchanged: true,
    preservedTextBlocks: blocks.length,
    pdfPages: pages,
    docxHeadingCount: headings,
    readDocumentCalls: reads.length,
    operations: run.operations.map(({ name, target, status, error }) => ({
      name,
      target,
      status,
      error,
    })),
    eachOutputReadByModel: true,
    isolatedBrowserDownloadsMatch: true,
    singleTopLevelDisclosure: true,
    resultCardsBeforeEvidence: true,
    docxRenderVerified: false,
    pdfVisuallyInspected: false,
    errors,
  };
  delete report.error;
  await writeFile(
    join(output, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      sameModelJob: job.id,
      directSourceConversion: true,
      readDocumentCalls: reads.length,
      files: 2,
      preservedTextBlocks: blocks.length,
      pdfPages: pages,
    }),
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
