import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { extractRawText, convertToHtml } from "mammoth";
import MarkdownIt from "markdown-it";
import { createApp } from "../server/app.ts";
import { artifactDeliveries } from "../shared/artifact-deliveries.ts";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "apsis-document-delivery-"));
  const app = await createApp({
    dataDir: join(directory, "data"),
    workspaceDir: join(directory, "work"),
  });
  t.after(() => app.product.close());
  const bot = await app.product.bots.create("文件測試");
  const workspace = app.tasks.locations.workspace(
    app.product.workLocation(bot),
  );
  const create = (
    args: Record<string, string>,
    run = "run-a",
    signal?: AbortSignal,
  ) => app.product.artifacts.createDocument(bot, run, args, signal);
  const snapshot = (path: string) =>
    readFile(join(directory, "data", "artifacts", path));
  return { app, directory, bot, workspace, create, snapshot };
}

test("source conversion retains every proposal block without changing the source", async (t) => {
  const f = await fixture(t);
  const source = await readFile(
    resolve("test/fixtures/reading-list-proposal.md"),
    "utf8",
  );
  await f.workspace.write("proposal.md", source);
  const a = await f.create({
    format: "docx",
    name: "共用讀書清單.docx",
    source_path: "proposal.md",
  });
  assert.equal(a.name, "共用讀書清單.docx");
  assert.equal(a.document.sourcePath, "proposal.md");
  assert.equal(a.document.contentFormat, "markdown");
  assert.equal(
    a.document.contentHash,
    createHash("sha256").update(source).digest("hex"),
  );
  assert.equal(a.document.layoutVerified, false);
  assert.equal(await f.workspace.read("proposal.md"), source);
  const html = await convertToHtml(
    { buffer: await f.snapshot(a.snapshotPath!) },
    { styleMap: ["p[style-name='Title'] => h1:fresh"] },
  );
  assert.equal((html.value.match(/<h[12]>/g) || []).length, 6);
  const text = html.value.replace(/<[^>]+>/g, "").replace(/\s+/g, "");
  const blocks = new MarkdownIt()
    .parse(source, {})
    .filter((b) => b.type === "inline");
  assert.equal(blocks.length, 32);
  for (const block of blocks)
    assert.ok(text.includes(block.content.replace(/\s+/g, "")), block.content);
  assert.equal(
    f.app.product.db.artifacts.get(a.id)!.document!.contentHash,
    a.document.contentHash,
  );
});

test("source validation and denied reads fail before creating any result", async (t) => {
  const f = await fixture(t);
  await f.workspace.write("source.md", "# 保留原文");
  await writeFile(join(f.workspace.root, "large.txt"), "x".repeat(256_001));
  await writeFile(
    join(f.workspace.root, "binary.txt"),
    Buffer.from([0xff, 0xfe]),
  );
  await writeFile(join(f.workspace.root, "nul.txt"), "a\0b");
  const invalid = [
    { content: "inline", source_path: "source.md" },
    {},
    { source_path: "" },
    { source_path: "../outside.md" },
    { source_path: resolve("test/fixtures/reading-list-proposal.md") },
    { source_path: "binary.txt" },
    { source_path: "nul.txt" },
    { source_path: "large.txt" },
    { content: "x".repeat(256_001) },
    { content: "inline", source_path: 42 },
  ];
  for (const input of invalid)
    await assert.rejects(
      f.create({ format: "docx", name: "blocked", ...input } as Record<
        string,
        string
      >),
    );
  await assert.rejects(
    f.create(
      { format: "docx", name: "cancelled", source_path: "source.md" },
      "run-a",
      AbortSignal.abort(),
    ),
  );
  f.app.product.settings.update({
    revision: f.app.product.settings.read().revision,
    permissionRules: [
      {
        id: "deny-source",
        scope: "global",
        tool: "read_file",
        path: "source.md",
        effect: "deny",
      },
    ],
  });
  for (const source_path of ["source.md", "./source.md", ".\\source.md"])
    await assert.rejects(
      f.create({ format: "docx", name: "denied", source_path }),
      (error: unknown) => (error as { status?: number }).status === 403,
    );
  assert.equal(await f.workspace.read("source.md"), "# 保留原文");
  assert.ok(!(await readdir(f.workspace.root)).includes("results"));
  assert.equal(f.app.product.db.artifacts.list().length, 0);
});

test("current-directory aliases resolve correctly while traversal and system files stay blocked", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.workspace.list("."), []);
  assert.deepEqual(await f.workspace.list("././"), []);
  await f.workspace.write("source.md", "# 原文");
  assert.equal(await f.workspace.resolve("."), await f.workspace.resolve(""));
  assert.deepEqual(await f.workspace.list("."), await f.workspace.list(""));
  assert.equal(await f.workspace.read("./source.md"), "# 原文");
  const converted = await f.create({
    format: "docx",
    name: "相對路徑",
    source_path: "./source.md",
  });
  assert.match(
    (
      await extractRawText({
        buffer: await f.snapshot(converted.snapshotPath!),
      })
    ).value,
    /原文/,
  );
  for (const path of [
    "../source.md",
    "./../source.md",
    "./.git/config",
    "./.apsis/settings.toml",
    "NUL.txt",
  ])
    await assert.rejects(f.workspace.resolve(path));
});

test("revisions preserve independent snapshots, concurrent revision numbers and run boundaries", async (t) => {
  const f = await fixture(t);
  const first = await f.create({
    format: "docx",
    name: "報告",
    content: "第一份原文",
  });
  const original = await f.snapshot(first.snapshotPath!);
  const later = await Promise.all(
    ["修訂甲", "修訂乙"].map((content) =>
      f.create({ format: "docx", name: "報告", content }),
    ),
  );
  assert.deepEqual(later.map((a) => a.document.revision).sort(), [2, 3]);
  assert.ok(
    later.every((a) => a.document.seriesId === first.document.seriesId),
  );
  assert.deepEqual(await f.snapshot(first.snapshotPath!), original);
  assert.match(
    (await extractRawText({ buffer: original })).value,
    /第一份原文/,
  );
  for (let n = 0; n < later.length; n++)
    assert.match(
      (
        await extractRawText({
          buffer: await f.snapshot(later[n].snapshotPath!),
        })
      ).value,
      n ? /修訂乙/ : /修訂甲/,
    );
  const separate = await f.create(
    { format: "docx", name: "報告", content: "另一回合" },
    "run-b",
  );
  assert.equal(separate.document.revision, 1);
  assert.notEqual(separate.document.seriesId, first.document.seriesId);
  await f.workspace.write("ordinary.txt", "一般發布");
  const ordinary = await f.app.product.artifacts.publish(
    f.bot,
    "run-a",
    "ordinary.txt",
    "報告.docx",
  );
  assert.equal(ordinary.document, undefined);
  const groups = artifactDeliveries([first, ...later, separate, ordinary]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].latest.document?.revision, 3);
  assert.equal(groups[0].previous.length, 2);
  assert.equal(groups[1].previous.length, 0);
  assert.equal(groups[2].latest.id, ordinary.id);
  // Even a reused series identifier must not merge another Bot or run.
  assert.equal(
    artifactDeliveries([
      first,
      { ...first, id: "other-bot", botId: "other" },
      { ...first, id: "other-run", runId: "other" },
    ]).length,
    3,
  );
});

test("source JSON rows and explicit plain text preserve existing format contracts", async (t) => {
  const f = await fixture(t);
  await f.workspace.write(
    "rows.json",
    JSON.stringify([
      ["欄位", "值"],
      ["狀態", "已讀"],
    ]),
  );
  const sheet = await f.create({
    format: "xlsx",
    name: "書單",
    source_path: "rows.json",
  });
  assert.equal(sheet.document.contentFormat, "json-rows");
  assert.match(
    JSON.stringify(
      await f.app.product.artifacts.readDocument(sheet.path, f.workspace),
    ),
    /已讀/,
  );
  await f.workspace.write("literal.md", "# 原始標記\n**保留星號**");
  const literal = await f.create({
    format: "docx",
    name: "原文",
    source_path: "literal.md",
    content_format: "plain",
  });
  assert.match(
    (await extractRawText({ buffer: await f.snapshot(literal.snapshotPath!) }))
      .value,
    /# 原始標記[\s\S]*\*\*保留星號\*\*/,
  );
});
