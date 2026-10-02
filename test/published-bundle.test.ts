import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  mkdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import {
  capturePublishedBundle,
  bundleLimit,
} from "../server/published-bundle.ts";
import { Workspace } from "../server/workspace.ts";
import JSZip from "jszip";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "apsis-published-bundle-"));
  const app = await createApp({
    dataDir: join(directory, "data"),
    workspaceDir: join(directory, "work"),
  });
  t.after(() => app.product.close());
  app.product.settings.update(
    { approvalMode: "auto" },
    app.product.settings.read().revision,
  );
  const bot = await app.product.bots.create("網頁交付");
  const workspace = app.tasks.locations.workspace(
    app.product.workLocation(bot),
  );
  await workspace.write(
    "site/展示 頁.html",
    '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="assets/style.css"><h1>已發布版本</h1>',
  );
  await workspace.write("site/assets/style.css", "h1 { color: purple }");
  await workspace.write("site/data/中文.json", '{"label":"原始資料"}');
  const root = join(app.tasks.store.directory, "artifacts");
  const assets = ["site/assets/style.css", "site/data/中文.json"];
  const publish = (list: unknown = assets, signal?: AbortSignal) =>
    app.product.artifacts.publish(
      bot,
      "bundle-run",
      "site/展示 頁.html",
      "完整網頁.html",
      "result",
      signal,
      undefined,
      undefined,
      list,
    );
  return { app, bot, workspace, root, assets, publish, directory };
}

test("explicit web assets form immutable snapshots and a Unicode ZIP readable by an independent reader", async (t) => {
  const f = await fixture(t);
  const artifact = await f.publish();
  assert.equal(artifact.bundle!.files.length, 3);
  assert.deepEqual(
    artifact.bundle!.files.map((file) => file.path),
    ["site/展示 頁.html", ...f.assets],
  );
  const original = new Map(
    await Promise.all(
      artifact.bundle!.files.map(
        async (file) =>
          [file.path, await readFile(join(f.root, file.snapshotPath))] as const,
      ),
    ),
  );
  await f.workspace.write("site/展示 頁.html", "已修改工作檔");
  await f.workspace.write("site/assets/style.css", "changed");
  for (const file of artifact.bundle!.files)
    assert.deepEqual(
      await readFile(join(f.root, file.snapshotPath)),
      original.get(file.path),
    );
  // An independent ZIP decoder checks the directory, CRCs, UTF-8 names and
  // exact bytes. No Python or OS-specific archive utility is needed.
  const archive = join(f.root, artifact.bundle!.archivePath);
  const decoded = await JSZip.loadAsync(await readFile(archive), {
    checkCRC32: true,
  });
  assert.deepEqual(Object.keys(decoded.files), [...original.keys()]);
  for (const [path, data] of original)
    assert.deepEqual(await decoded.file(path)!.async("nodebuffer"), data);
});

test("a Markdown assets error explains the single-file retry, which publishes a result card", async (t) => {
  const f = await fixture(t);
  await f.workspace.write("site/plan.md", "# 青禾讀書會\n");
  const publishMarkdown = (assets?: string[]) =>
    f.app.product.artifacts.publish(
      f.bot,
      "markdown-run",
      "site/plan.md",
      "plan.md",
      "result",
      undefined,
      undefined,
      undefined,
      assets,
    );
  await assert.rejects(
    publishMarkdown(["site/assets/style.css"]),
    /assets 只適用於 HTML 網頁.*省略 assets.*path 與 name.*publish_file/,
  );
  assert.equal(f.app.product.db.artifacts.list().length, 0);
  const artifact = await publishMarkdown();
  assert.equal(artifact.mime, "text/markdown");
  assert.equal(artifact.bundle, undefined);
  assert.ok(artifact.snapshotPath);
  assert.equal(
    (await readFile(join(f.root, artifact.snapshotPath))).toString("utf8"),
    "# 青禾讀書會\n",
  );
});

test("bundle validation rejects malformed, duplicate, traversal, protected, missing and directory assets before publication", async (t) => {
  const f = await fixture(t);
  for (const assets of [
    null,
    "[]",
    [],
    [1],
    Array.from({ length: 64 }, (_, n) => `file-${n}.txt`),
    ["site/展示 頁.html"],
    ["./site/assets/style.css", "site/assets/style.css"],
    ["site/assets/style.css", "SITE/assets/style.css"],
    ["/site/assets/style.css"],
    ["../outside.txt"],
    [".git/config"],
    [".apsis/secret"],
    ["site/assets"],
    ["missing.css"],
  ])
    await assert.rejects(f.publish(assets));
  const outside = join(f.directory, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "must not be copied");
  await symlink(outside, join(f.workspace.root, "site", "escape"), "junction");
  await assert.rejects(f.publish(["site/escape/secret.txt"]));
  assert.equal(f.app.product.db.artifacts.list().length, 0);
  assert.deepEqual(await readdir(f.root).catch(() => []), []);
});

test("every included asset respects publish, read and snapshot-write policy and cancellation", async (t) => {
  const f = await fixture(t);
  for (const [tool, path] of [
    ["read_file", "site/assets/style.css"],
    ["publish_file", "site/data/中文.json"],
    ["write_file", undefined],
  ]) {
    f.app.product.settings.update(
      {
        permissionRules: [
          {
            id: "deny-bundle",
            scope: "global",
            tool: tool!,
            ...(path ? { path } : {}),
            effect: "deny",
          },
        ],
      },
      f.app.product.settings.read().revision,
    );
    await assert.rejects(
      f.publish(),
      (error: unknown) => (error as { status?: number }).status === 403,
    );
  }
  f.app.product.settings.update(
    { permissionRules: [] },
    f.app.product.settings.read().revision,
  );
  await assert.rejects(f.publish(f.assets, AbortSignal.abort()));
  assert.equal(f.app.product.db.artifacts.list().length, 0);
  assert.deepEqual(await readdir(f.root).catch(() => []), []);
});

test("a failed artifact record removes its staged bundle without changing source files", async (t) => {
  const f = await fixture(t);
  f.app.product.db.db.exec(
    "CREATE TRIGGER fail_bundle_record BEFORE INSERT ON records WHEN NEW.kind='artifact' BEGIN SELECT RAISE(ABORT, 'bundle-store-test'); END",
  );
  await assert.rejects(f.publish(), /bundle-store-test/);
  assert.equal(f.app.product.db.artifacts.list().length, 0);
  assert.deepEqual(await readdir(f.root).catch(() => []), []);
  assert.match(await f.workspace.read("site/assets/style.css"), /purple/);
});

test("a capture write failure removes only its partial staging directory", async (t) => {
  const f = await fixture(t);
  const snapshots = new Workspace(f.root, true);
  const originalResolve = snapshots.resolve.bind(snapshots);
  let written = false;
  snapshots.resolve = async (path, create) => {
    if (create && path?.endsWith("/files/site/assets/style.css")) {
      written = true;
      throw new Error("capture-write-test");
    }
    return originalResolve(path, create);
  };
  await assert.rejects(
    capturePublishedBundle(
      f.workspace,
      snapshots,
      "site/展示 頁.html",
      f.assets,
      async () => {},
    ),
    /capture-write-test/,
  );
  assert.equal(written, true);
  assert.deepEqual(await readdir(f.root), []);
  assert.match(await f.workspace.read("site/展示 頁.html"), /已發布版本/);
});

test("bundle size limits and capture cancellation preserve sources and produce no visible artifact", async (t) => {
  const f = await fixture(t);
  await writeFile(
    await f.workspace.resolve("site/large.bin", true),
    Buffer.alloc(bundleLimit),
  );
  await assert.rejects(f.publish(["site/large.bin"]), /20 MB/);
  const controller = new AbortController();
  await assert.rejects(
    capturePublishedBundle(
      f.workspace,
      new Workspace(f.root, true),
      "site/展示 頁.html",
      f.assets,
      async (tool) => {
        if (tool === "write_file") controller.abort();
      },
      controller.signal,
    ),
  );
  assert.equal(f.app.product.db.artifacts.list().length, 0);
  assert.deepEqual(await readdir(f.root).catch(() => []), []);
  assert.match(await f.workspace.read("site/assets/style.css"), /purple/);
});

test("bundle preview capability exposes declared snapshots only and reference carries every resource to a new topic", async (t) => {
  const f = await fixture(t);
  const artifact = await f.publish();
  await f.workspace.write("site/unpublished.txt", "private live file");
  await f.workspace.write("site/assets/style.css", "live changed CSS");
  f.app.server.listen(0, "127.0.0.1");
  await once(f.app.server, "listening");
  t.after(async () => {
    f.app.server.closeAllConnections();
    await new Promise<void>((resolve) => f.app.server.close(() => resolve()));
  });
  const base = `http://127.0.0.1:${(f.app.server.address() as AddressInfo).port}`;
  const preview = await (
    await fetch(`${base}/api/v2/artifacts/${artifact.id}/preview`)
  ).json();
  assert.equal(preview.kind, "html");
  assert.match(preview.content, /已發布版本/);
  const entry = new URL(preview.previewUrl, base);
  const view = await fetch(`${base}/api/v2/artifacts/${artifact.id}/view`, {
    redirect: "manual",
  });
  assert.equal(view.status, 302);
  assert.equal(new URL(view.headers.get("location")!, base).href, entry.href);
  const css = new URL("assets/style.css", entry);
  const htmlResponse = await fetch(entry, { headers: { Origin: "null" } });
  assert.match(
    htmlResponse.headers.get("content-security-policy")!,
    /sandbox allow-scripts allow-forms/,
  );
  assert.match(
    htmlResponse.headers.get("content-security-policy")!,
    /form-action 'none'/,
  );
  const response = await fetch(css, {
    headers: { Origin: "null", "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /purple/);
  assert.equal(response.headers.get("access-control-allow-origin"), "null");
  assert.equal(
    (
      await fetch(new URL("unpublished.txt", entry), {
        headers: { Origin: "null" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(new URL("../../../../api/v2/bots", entry), {
        headers: { Origin: "null" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(css, { headers: { Origin: "https://example.invalid" } }))
      .status,
    403,
  );
  assert.equal(
    (
      await fetch(
        css
          .toString()
          .replace(/\/html\/[a-f0-9]{48}\//, "/html/" + "0".repeat(48) + "/"),
        { headers: { Origin: "null" } },
      )
    ).status,
    404,
  );
  const download = await fetch(`${base}/api/v2/artifacts/${artifact.id}`);
  assert.equal(download.headers.get("content-type"), "application/zip");
  assert.match(download.headers.get("content-disposition")!, /\.zip/);
  assert.deepEqual(
    Buffer.from(await download.arrayBuffer()),
    await readFile(join(f.root, artifact.bundle!.archivePath)),
  );
  const context = f.app.product.messages.newContext(f.bot.id);
  const reference = await fetch(
    `${base}/api/v2/bots/${f.bot.id}/artifact-reference`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Apsis-Client": "1" },
      body: JSON.stringify({ artifactId: artifact.id, contextId: context.id }),
    },
  );
  assert.equal(reference.status, 200);
  const ref = await reference.json();
  const copied = f.app.tasks.locations.workspace(
    f.app.tasks.locations.get(ref.locationId),
  );
  const prefix = ref.path.slice(0, -artifact.bundle!.entry.length);
  for (const file of artifact.bundle!.files)
    assert.deepEqual(
      await readFile(await copied.resolve(prefix + file.path)),
      await readFile(join(f.root, file.snapshotPath)),
    );
  f.app.product.db.artifacts.remove(artifact.id);
  assert.equal(
    (await fetch(css, { headers: { Origin: "null" } })).status,
    404,
    "deleted artifact revokes its capability",
  );
});
