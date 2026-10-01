import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { convertToHtml } from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import MarkdownIt from "markdown-it";
import { createApp } from "../server/app.ts";
import { appDirectories } from "../server/app-directories.ts";
import { Connections } from "../server/connections.ts";
import { runDeep } from "../server/engines/deep.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import type { AgentTool } from "../server/tools.ts";
import type { Artifact } from "../shared/product.ts";

// Invokes the configured external model with fictional fixture content. Normal
// provider usage applies. Credentials stay in memory; user conversations/settings
// are neither copied nor changed. This is not control of the user's Chrome.
const connections = await new Connections(appDirectories().dataDir).init();
const handoff = process.argv.includes("--handoff");
const attempt = process.argv.find((value) => value.startsWith("--attempt="))?.slice(10);
assert.ok(!attempt || /^\d+$/.test(attempt), "Attempt must be numeric.");
const positional = process.argv
  .slice(2)
  .filter((value) => value !== "--handoff" && !value.startsWith("--attempt="));
const selected = positional[0]
  ? connections.selection(positional[0], positional[1])
  : connections.defaultSelection();
assert.ok(selected, "請先配置可執行的模型。");
const row = connections
  .view()
  .find((item) => item.id === selected.connectionId)!;
const env = connections.environment(selected.connectionId, selected.model);
const secrets = [
  env.OPENAI_API_KEY,
  env.ANTHROPIC_API_KEY,
  env.COMPATIBLE_API_KEY,
].filter((value): value is string => !!value);
const redact = (value: string) =>
  secrets.reduce(
    (text, secret) => text.replaceAll(secret, "[redacted]"),
    value,
  );
const directory = await mkdtemp(join(tmpdir(), "apsis-document-model-"));
const output = resolve(
  handoff
    ? `artifacts/document-model-handoff${attempt ? `/attempt-${attempt}` : ""}`
    : "artifacts/document-model-source",
);
await mkdir(output, { recursive: true });
const content = await readFile(
  resolve("test/fixtures/reading-list-proposal.md"),
  "utf8",
);
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const prompt = `請完成這個文件交付測試。
工作資料夾已有 proposal.md，內容是虛構的共用讀書清單提案。
讀取該檔案，原文完整保留，不新增、改寫或刪減內容。
把既有 proposal.md 直接轉換成 Word（DOCX）和 PDF，兩份檔名都用「共用讀書清單」。原文必須完整保留，標題和清單應具有可讀的層級。
不修改 proposal.md，不另裝工具、不執行 shell、不分派其他 Bot、不建立第三份文件。
使用 read_document 讀回兩份成果，核對書名、作者、狀態、心得、篩選、里程碑與驗收等段落，以及不包含登入、同步、付費和分享的範圍。
PDF 頁數以工具回傳為準。檔案存在或文字讀回不代表版面已通過檢查；沒有渲染／視覺驗證就明確說尚未驗證，尤其 Word 分頁。
完成後簡短回報兩個成果、實際 PDF 頁數、已做的內容檢查與未做的版面驗證。`;
const debugPrompt =
  "我要核對檔案，請列出兩份已交付成果的完整工作區相對路徑、來源檔路徑、完整來源內容雜湊，以及工具實際回傳的 PDF 頁數。不要重新產生、發布或修改任何檔案。";
const allowed = new Set([
  "read_file",
  "list_files",
  "create_document",
  "read_document",
]);
const calls: {
  tool: string;
  contentFormat?: string;
  format?: string;
  document?: unknown;
  sourcePath?: string;
  contentSupplied?: boolean;
}[] = [];
let submitted = 0;
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async (options) => {
    submitted++;
    assert.equal(await options.workspace.read("proposal.md"), content);
    const extraTools = (options.extraTools || [])
      .filter((tool) =>
        (options.prompt === debugPrompt
          ? ["read_document"]
          : ["create_document", "read_document"]
        ).includes(tool.name),
      )
      .map(
        (tool): AgentTool => ({
          ...tool,
          execute: async (id, args, signal) => {
            const input = args as Record<string, string>;
            const result = await tool.execute(id, args, signal);
            const text = result.content.find((block) => block.type === "text");
            const data = text ? JSON.parse(text.text) : undefined;
            calls.push({
              tool: tool.name,
              ...(tool.name === "create_document"
                ? {
                    contentFormat: data?.document?.contentFormat,
                    sourcePath: input.source_path,
                    contentSupplied: input.content !== undefined,
                    format: input.format,
                    document: data?.document,
                  }
                : {}),
            });
            console.log(
              JSON.stringify({
                event: "tool-completed",
                tool: tool.name,
                format: input.format,
              }),
            );
            return result;
          },
        }),
      );
    try {
      return await runDeep({
        ...options,
        env,
        modelSettings: row.modelSettings?.[selected.model],
        agent: options.agent
          ? { ...options.agent, tools: ["read_file", "list_files"] }
          : options.agent,
        extraTools,
        runtimeSettings: { ...options.runtimeSettings!, maxTurns: 12 },
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(360000)]),
        authorize: async (name, args, signal) => {
          if (!allowed.has(name))
            throw new Error("此驗證僅允許讀取來源與原生文件建立／讀回。");
          return options.authorize?.(name, args, signal);
        },
      });
    } catch (error) {
      throw new Error(redact(String(error)));
    }
  },
});
// A non-secret placeholder satisfies the isolated app's readiness check; the
// runner resolves real credentials directly above and never saves them here.
const fixture = await app.connections.save({
  name: "Live model verification",
  provider: row.provider,
  model: selected.model,
  url: "http://127.0.0.1:1/v1",
  apiKey: "fixture-not-a-secret",
  modelSettings: row.modelSettings,
});
await app.connections.setDefault({
  connectionId: fixture.id,
  model: selected.model,
});
const bot = await app.product.bots.create("文件交付驗證");
const workspace = app.tasks.locations.workspace(app.product.workLocation(bot));
await workspace.write("proposal.md", content);
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({ executablePath: browserExecutable() });
const errors: string[] = [];
let report: Record<string, unknown> = {
  externalModelTask: true,
  userChromeControlled: false,
  userConversationOrSettingsChanged: false,
  handoffVerification: handoff,
  model: selected.model,
  provider: row.provider,
  directory,
  fixtureBase: base,
};
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(redact(error.message)));
  await page.goto(base);
  await page
    .getByRole("textbox", { name: "傳送訊息", exact: true })
    .fill(prompt);
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  console.log(
    JSON.stringify({
      event: "submitted",
      model: selected.model,
      fixtureBase: base,
      directory,
    }),
  );
  await writeFile(
    join(output, "running.json"),
    JSON.stringify({ ...report, state: "submitted" }, null, 2),
  );
  const firstJob = () => app.product.db.jobs.list({ botId: bot.id })[0];
  const start = Date.now();
  let seen = "";
  let captured = false;
  while (!firstJob() || ["queued", "running"].includes(firstJob().status)) {
    if (Date.now() - start > 390000) {
      app.tasks.stop(bot.sessionId);
      throw new Error("驗證觀察超過界線，已要求停止隔離任務。");
    }
    const job = firstJob();
    const run = job?.runId ? app.tasks.runs.records.get(job.runId) : undefined;
    const signature = `${job?.status}/${run?.operations.length || 0}`;
    if (seen !== signature) {
      seen = signature;
      console.log(
        JSON.stringify({
          event: "observed",
          status: job?.status,
          operations: run?.operations.length || 0,
        }),
      );
    }
    if (!captured && (run?.operations.length || 0) >= 2) {
      await page.screenshot({ path: join(output, "running.png") });
      captured = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const job = firstJob();
  assert.equal(job.status, "completed", redact(job.error || job.status));
  assert.equal(submitted, 1);
  await page.locator(".message.assistant .message-body").last().waitFor();
  await page.screenshot({ path: join(output, "completed-desktop.png") });
  const final = await page
    .locator(".message.assistant .message-body")
    .last()
    .innerText();
  await writeFile(join(output, "final.txt"), redact(final));
  const ordinaryHandoff = handoff ? {
    characters: final.length,
    concise: final.length <= 450,
    noInternalFields: !/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|source_path|contentHash|layoutVerified|pageCount|create_document|read_document|results\//i.test(final),
  } : undefined;
  const artifacts = app.product.db.artifacts.list({ botId: bot.id });
  assert.equal(artifacts.length, 2, "Must produce exactly DOCX and PDF");
  const created = calls.filter((call) => call.tool === "create_document");
  assert.equal(created.length, 2);
  assert.ok(created.every((call) => call.contentFormat === "markdown"));
  assert.ok(
    created.every(
      (call) =>
        call.sourcePath === "proposal.md" && call.contentSupplied === false,
    ),
    "Existing source must be converted without retyping",
  );
  const readOperations = app.tasks.runs.records
    .get(job.runId!)!
    .operations.filter((operation) => operation.name === "read_document");
  for (const artifact of artifacts)
    assert.ok(
      readOperations.some((operation) =>
        operation.target?.includes(artifact.path),
      ),
      "Each delivered file must actually be read back",
    );
  assert.equal(digest(await workspace.read("proposal.md")), digest(content));
  const normalize = (text: string) =>
    text.normalize("NFKC").replace(/\s+/g, "");
  const blocks = new MarkdownIt()
    .parse(content, {})
    .filter((token) => token.type === "inline")
    .map((token) => normalize(token.content));
  const downloads: Record<string, Buffer> = {};
  for (const format of ["docx", "pdf"]) {
    const artifact = artifacts.find((item: Artifact) =>
      item.name.endsWith(`.${format}`),
    )!;
    const wait = page.waitForEvent("download");
    await page
      .getByRole("link", { name: `下載成果 ${artifact.name}`, exact: true })
      .click();
    const downloaded = await wait;
    const file = await downloaded.path();
    assert.ok(file);
    const bytes = await readFile(file);
    assert.deepEqual(
      bytes,
      await readFile(
        join(directory, "data", "artifacts", artifact.snapshotPath!),
      ),
    );
    downloads[format] = bytes;
    await writeFile(join(output, `model-brief.${format}`), bytes);
  }
  const docx = await convertToHtml(
    { buffer: downloads.docx },
    { styleMap: ["p[style-name='Title'] => h1:fresh"] },
  );
  const docText = normalize(docx.value.replace(/<[^>]+>/g, ""));
  for (const block of blocks)
    assert.ok(docText.includes(block), "DOCX retains source paragraph");
  const loading = getDocument({ data: new Uint8Array(downloads.pdf) });
  let pdfPages = 0;
  let pdfText = "";
  try {
    const pdf = await loading.promise;
    pdfPages = pdf.numPages;
    for (let n = 1; n <= pdfPages; n++) {
      const text = await (await pdf.getPage(n)).getTextContent();
      pdfText += text.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
    }
  } finally {
    await loading.destroy();
  }
  for (const block of blocks)
    assert.ok(
      normalize(pdfText).includes(block),
      "PDF retains source paragraph",
    );
  assert.match(final, /尚未|未進行|未做|未完成|沒有/);
  assert.deepEqual(errors, []);
  let details: Record<string, unknown> | undefined;
  if (handoff) {
    const firstArtifactIds = artifacts.map((a) => a.id).sort();
    await page
      .getByRole("textbox", { name: "傳送訊息", exact: true })
      .fill(debugPrompt);
    await page.getByRole("button", { name: "傳送", exact: true }).click();
    const deadline = Date.now() + 390000;
    let debugJob = app.product.db.jobs
      .list({ botId: bot.id })
      .find((row) => row.id !== job.id);
    while (!debugJob || ["queued", "running"].includes(debugJob.status)) {
      if (Date.now() > deadline) {
        app.tasks.stop(bot.sessionId);
        throw new Error(
          "Technical detail follow-up exceeded the observation boundary",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      debugJob = app.product.db.jobs
        .list({ botId: bot.id })
        .find((row) => row.id !== job.id);
    }
    assert.equal(
      debugJob.status,
      "completed",
      redact(debugJob.error || debugJob.status),
    );
    assert.equal(submitted, 2);
    await page.locator(".message.assistant .message-body").nth(1).waitFor();
    const debug = await page
      .locator(".message.assistant .message-body")
      .nth(1)
      .innerText();
    for (const artifact of artifacts)
      assert.ok(
        debug.includes(artifact.path),
        "Requested full workspace paths stay available",
      );
    assert.ok(
      debug.includes(digest(content)),
      "Requested full source hash stays available",
    );
    assert.match(debug, /proposal\.md/);
    assert.match(debug, /1\s*頁|1\s*page/i);
    assert.deepEqual(
      app.product.db.artifacts
        .list({ botId: bot.id })
        .map((a) => a.id)
        .sort(),
      firstArtifactIds,
      "Detail request must not publish duplicate files",
    );
    assert.equal(digest(await workspace.read("proposal.md")), digest(content));
    await writeFile(join(output, "requested-details.txt"), redact(debug));
    await page.screenshot({
      path: join(output, "requested-details-desktop.png"),
    });
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: join(output, "requested-details-mobile.png"),
    });
    const baseline = await readFile(
      resolve("artifacts/document-model-source/final.txt"),
      "utf8",
    );
    details = {
      ordinaryReplyCharacters: final.length,
      baselineReplyCharacters: baseline.length,
      fullPathsOnRequest: true,
      fullHashOnRequest: true,
      noDuplicatePublications: true,
      sourceUnchanged: true,
      detailReplyCharacters: debug.length,
      distinctSecondModelJob: debugJob.id,
    };
    assert.deepEqual(errors, []);
  }
  report = {
    ...report,
    passed: true,
    jobStatus: job.status,
    submitted,
    operations: app.tasks.runs.records.get(job.runId!)?.operations.length,
    calls,
    artifacts: artifacts.map((a) => ({
      name: a.name,
      mime: a.mime,
      document: a.document,
    })),
    directSourceConversion: true,
    sourceUnchanged: true,
    preservedTextBlocks: blocks.length,
    pdfPages,
    docxHeadingCount: (docx.value.match(/<h[12]>/g) || []).length,
    isolatedBrowserDownloadsMatch: true,
    docxRenderVerified: false,
    pdfVisuallyInspected: false,
    ...(details ? { handoff: details } : {}),
    ...(ordinaryHandoff ? { ordinaryHandoff } : {}),
    errors,
  };
  // Collect delivery fidelity and the explicit-details follow-up even when the
  // ordinary reply is too long. Style failure must not mask either result.
  if (ordinaryHandoff) {
    assert.ok(ordinaryHandoff.concise, `Ordinary handoff should be concise: ${final.length} characters`);
    assert.ok(ordinaryHandoff.noInternalFields, "Ordinary handoff should not repeat internal fields");
  }
  console.log(
    JSON.stringify({
      event: "passed",
      model: selected.model,
      pdfPages,
      preservedTextBlocks: blocks.length,
    }),
  );
} catch (error) {
  report = {
    ...report,
    passed: false,
    submitted,
    calls,
    jobStatus: app.product.db.jobs.list({ botId: bot.id })[0]?.status,
    error: redact(String(error)),
    errors,
  };
  console.error(redact(String(error)));
  process.exitCode = 1;
} finally {
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
