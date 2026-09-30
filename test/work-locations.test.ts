import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  stat,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { createTools } from "../server/tools.ts";
import { scopedState } from "../server/agents.ts";
import type { RunOptions } from "../server/runtime.ts";
import type { Job } from "../shared/product.ts";

async function until(fn: () => boolean) {
  const end = Date.now() + 8000;
  while (!fn()) {
    assert.ok(Date.now() < end, "timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
async function fixture(
  t: test.TestContext,
  runner: (o: RunOptions) => Promise<{ text: string }> = async () => ({
    text: "done",
  }),
) {
  const dir = await mkdtemp(join(tmpdir(), "apsis-work-locations-"));
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    runner,
  });
  const c = await app.connections.save({
    name: "fixture",
    provider: "openai-compatible",
    model: "fixture",
    url: "http://127.0.0.1:1/v1",
    modelSettings: { fixture: { contextWindowTokens: 128000 } },
  });
  await app.connections.setDefault({ connectionId: c.id, model: c.model });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  t.after(async () => {
    await app.product.close();
    app.server.closeAllConnections();
    await new Promise<void>((r) => app.server.close(() => r()));
  });
  const request = async (path: string, method = "GET", data?: unknown) => {
    const response = await fetch(base + "/api/v2" + path, {
      method,
      headers: { "X-Apsis-Client": "1", "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { response, data: await response.json() };
  };
  const finish = async () => {
    await until(() => !app.product.execution.active.size);
  };
  return { ...app, dir, base, request, finish };
}
async function call(o: RunOptions, name: string, args: unknown) {
  return createTools(o)
    .find((t) => t.name === name)!
    .execute(randomUUID(), args, o.signal);
}

test("HTML preview scopes opaque-origin asset access and keeps application APIs private", async (t) => {
  const f = await fixture(t);
  const bot = await f.product.bots.create();
  const location = f.product.workLocation(bot);
  await f.product.files.save(
    location.id,
    "site/展示 頁.HTML",
    "<h1>Preview</h1>",
    null,
  );
  await f.product.files.save(
    location.id,
    "site/style.css",
    "h1 { color: red }",
    null,
  );
  await f.product.files.save(location.id, "site/.env", "PRIVATE=value", null);
  const { data } = await f.request(
    `/work-locations/${location.id}/content?path=${encodeURIComponent("site/展示 頁.HTML")}`,
  );
  assert.ok(data.previewUrl);
  const response = await fetch(f.base + data.previewUrl);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "text/html; charset=utf-8",
  );
  assert.equal(await response.text(), "<h1>Preview</h1>");
  const csp = response.headers.get("content-security-policy")!;
  assert.match(csp, /sandbox allow-scripts/);
  assert.doesNotMatch(csp, /allow-same-origin/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const opaque = { Origin: "null", "Sec-Fetch-Site": "cross-site" };
  const assetUrl = new URL("style.css", f.base + data.previewUrl);
  const css = await fetch(assetUrl, { headers: opaque });
  assert.equal(css.status, 200);
  assert.equal(css.headers.get("access-control-allow-origin"), "null");
  assert.equal(await css.text(), "h1 { color: red }");
  assert.equal(
    (await fetch(new URL(".env", assetUrl), { headers: opaque })).status,
    415,
  );
  assert.equal(
    (
      await fetch(
        f.base +
          data.previewUrl.replace(
            /\/html\/[a-f0-9]+\//,
            `/html/${"0".repeat(48)}/`,
          ),
        { headers: opaque },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(f.base + data.previewUrl, {
        headers: {
          Origin: "https://untrusted.example",
          "Sec-Fetch-Site": "cross-site",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(
        f.base +
          `/api/v2/work-locations/${location.id}/content?path=site/style.css`,
        { headers: opaque },
      )
    ).status,
    403,
  );
  const prefix = data.previewUrl.split("/site/")[0];
  assert.equal(
    (
      await fetch(f.base + prefix + "/..%2f..%2foutside.html", {
        headers: opaque,
      })
    ).status,
    403,
  );
  const other = f.product.workLocation(await f.product.bots.create());
  assert.equal(
    (
      await fetch(f.base + data.previewUrl.replace(location.id, other.id), {
        headers: opaque,
      })
    ).status,
    404,
  );
  assert.equal(
    (await fetch(f.base + data.previewUrl, { method: "POST", headers: opaque }))
      .status,
    403,
  );
});

test("plain chat stays lazy; new tasks isolate files, history and memory while retaining one transcript", async (t) => {
  const seen: RunOptions[] = [];
  const f = await fixture(t, async (o) => {
    seen.push(o);
    if (o.prompt !== "chat") {
      await call(o, "write_file", { path: "same.txt", content: o.prompt });
      await call(o, "remember", { content: o.prompt });
    }
    return { text: "answer " + o.prompt };
  });
  const bot = await f.product.bots.create();
  const first = f.product.workLocation(bot);
  await f.product.jobs.submit(bot.id, { prompt: "chat", requestId: "chat" });
  await f.finish();
  await assert.rejects(stat(first.path), { code: "ENOENT" });
  await f.product.jobs.submit(bot.id, {
    prompt: "alpha-secret",
    requestId: "alpha",
  });
  await f.finish();
  assert.equal(
    await readFile(join(first.path, "same.txt"), "utf8"),
    "alpha-secret",
  );
  const oldContext = f.tasks.store.conversations.activeId(bot.sessionId);
  f.product.messages.newContext(bot.id);
  const second = f.product.workLocation(bot);
  assert.notEqual(first.path, second.path);
  await f.product.jobs.submit(bot.id, {
    prompt: "beta-secret",
    requestId: "beta",
  });
  await f.finish();
  assert.equal(
    await readFile(join(first.path, "same.txt"), "utf8"),
    "alpha-secret",
  );
  assert.equal(
    await readFile(join(second.path, "same.txt"), "utf8"),
    "beta-secret",
  );
  assert.equal(f.product.queries.detail(bot.id).session.messages.length, 6);
  assert.deepEqual(
    scopedState(
      f.store.skillState(),
      seen.at(-1)!.agent,
      second.memoryKey,
    ).memories.map((m) => m.content),
    ["beta-secret"],
  );
  const history = await call(
    {
      ...seen.at(-1)!,
      executeAuthorizedTool: undefined,
      authorize: undefined,
      checkToolPermission: undefined,
    },
    "search_history",
    { query: "alpha-secret" },
  );
  assert.equal(
    history.content[0].type === "text" && history.content[0].text,
    "[]",
  );
  const stale = await f.request(`/bots/${bot.id}/messages`, "POST", {
    prompt: "wrong task",
    requestId: "stale",
    workContextId: oldContext,
  });
  assert.equal(stale.response.status, 409);
});

test("delegation and routines inherit the work location and never the recipient's current folder", async (t) => {
  let workerId = "";
  const f = await fixture(t, async (o) => {
    if (o.prompt === "delegate")
      await call(o, "delegate_task", { botId: workerId, prompt: "child" });
    else await call(o, "write_file", { path: "result.txt", content: o.prompt });
    return { text: "done" };
  });
  const owner = await f.product.bots.create("owner"),
    worker = await f.product.bots.create("worker");
  workerId = worker.id;
  const own = f.product.workLocation(owner),
    other = f.product.workLocation(worker);
  await f.product.jobs.submit(owner.id, {
    prompt: "delegate",
    requestId: "root",
  });
  await f.finish();
  assert.equal(await readFile(join(own.path, "result.txt"), "utf8"), "child");
  await assert.rejects(stat(other.path), { code: "ENOENT" });
  assert.equal(f.product.workLocation(worker).id, other.id);
  const routine = await f.product.routines.routine(owner.id, {
    name: "routine",
    prompt: "scheduled",
    cron: "0 9 * * *",
  });
  f.product.messages.newContext(owner.id);
  const current = f.product.workLocation(owner);
  const result = await f.request(`/routines/${routine.id}/test`, "POST", {});
  assert.equal(result.response.status, 200);
  await f.finish();
  assert.equal(
    await readFile(join(own.path, "result.txt"), "utf8"),
    "scheduled",
  );
  await assert.rejects(stat(current.path), { code: "ENOENT" });
  const jobs = f.product.db.all<Job>("job");
  assert.ok(jobs.every((j) => j.location?.id === own.id));
});

test("file CRUD preserves drafts on conflict, paginates, handles dotfiles and restores without overwrite", async (t) => {
  const f = await fixture(t),
    bot = await f.product.bots.create(),
    location = f.product.workLocation(bot);
  const base = `/work-locations/${location.id}`;
  let r = await f.request(base + "/content", "PUT", {
    path: ".gitignore",
    content: "node_modules",
    revision: null,
  });
  assert.equal(r.response.status, 200);
  const revision = r.data.revision;
  await writeFile(join(location.path, ".gitignore"), "external");
  r = await f.request(base + "/content", "PUT", {
    path: ".gitignore",
    content: "draft",
    revision,
  });
  assert.equal(r.response.status, 409);
  assert.equal(
    await readFile(join(location.path, ".gitignore"), "utf8"),
    "external",
  );
  const latest = (await f.request(base + "/content?path=.gitignore")).data;
  assert.equal(
    (
      await f.request(base + "/move", "POST", {
        path: ".gitignore",
        to: "notes.txt",
        revision: latest.revision,
      })
    ).response.status,
    200,
  );
  assert.equal(
    (await f.request(base + "/trash", "POST", { path: "notes.txt" })).response
      .status,
    200,
  );
  const trash = (await f.request(base + "/trash")).data;
  await writeFile(join(location.path, "notes.txt"), "new file");
  assert.equal(
    (await f.request(base + "/restore", "POST", { id: trash[0].id })).response
      .status,
    409,
  );
  assert.equal(
    (
      await f.request(base + "/restore", "POST", {
        id: trash[0].id,
        path: "restored.txt",
      })
    ).response.status,
    200,
  );
  assert.equal(
    await readFile(join(location.path, "restored.txt"), "utf8"),
    "external",
  );
  for (const path of [
    "../escape.txt",
    ".git/config",
    ".apsis/settings.toml",
    "NUL.txt",
    "x/../escape",
  ])
    assert.notEqual(
      (
        await f.request(base + "/content", "PUT", {
          path,
          content: "x",
          revision: null,
        })
      ).response.status,
      200,
    );
  await Promise.all(
    Array.from({ length: 205 }, (_, i) =>
      writeFile(join(location.path, `${i}.txt`), ""),
    ),
  );
  const page = (await f.request(base + "/files")).data;
  assert.equal(page.entries.length, 200);
  assert.equal(page.next, 200);
  assert.ok(
    (await f.request(base + "/files?offset=200")).data.entries.length >= 7,
  );
  const external = join(f.dir, "external");
  await mkdir(external);
  await symlink(external, join(location.path, "link"), "junction");
  assert.notEqual(
    (
      await f.request(base + "/content", "PUT", {
        path: "link/no.txt",
        content: "bad",
        revision: null,
      })
    ).response.status,
    200,
  );
  await assert.rejects(stat(join(external, "no.txt")), { code: "ENOENT" });
});

test("busy folders block manual writes, published snapshots survive source edits and new contexts", async (t) => {
  let release!: () => void;
  const f = await fixture(t, async (o) => {
    await call(o, "write_file", { path: "result.md", content: "original" });
    await call(o, "publish_file", { path: "result.md", name: "result.md" });
    await new Promise<void>((r) => (release = r));
    return { text: "done" };
  });
  const bot = await f.product.bots.create(),
    location = f.product.workLocation(bot);
  await f.product.jobs.submit(bot.id, { prompt: "hold", requestId: "hold" });
  await until(() => !!release);
  const base = `/work-locations/${location.id}`;
  const file = (await f.request(base + "/content?path=result.md")).data;
  assert.equal(
    (
      await f.request(base + "/content", "PUT", {
        path: "result.md",
        revision: file.revision,
        content: "manual",
      })
    ).response.status,
    409,
  );
  release();
  await f.finish();
  assert.equal(
    (
      await f.request(base + "/content", "PUT", {
        path: "result.md",
        revision: file.revision,
        content: "manual",
      })
    ).response.status,
    200,
  );
  const artifact = f.product.queries.detail(bot.id).artifacts[0];
  f.product.messages.newContext(bot.id);
  const downloaded = await fetch(f.base + `/api/v2/artifacts/${artifact.id}`);
  assert.equal(await downloaded.text(), "original");
});

test("project binding freezes on submit and only explicit owner actions promote memory", async (t) => {
  const f = await fixture(t, async (o) => {
    await call(o, "remember", { content: "project fact" });
    return { text: "done" };
  });
  const bot = await f.product.bots.create(),
    context = f.product.queries.detail(bot.id).session.context!;
  const project = (
    await f.request("/projects", "POST", {
      name: "Research",
      description: "Shared source notes",
    })
  ).data;
  assert.equal(
    (
      await f.request(`/bots/${bot.id}/work-location`, "PUT", {
        contextId: context.id,
        projectId: project.id,
      })
    ).response.status,
    200,
  );
  await f.product.jobs.submit(bot.id, {
    prompt: "remember",
    requestId: "remember",
  });
  await f.finish();
  assert.equal(
    (
      await f.request(`/bots/${bot.id}/work-location`, "PUT", {
        contextId: context.id,
        projectId: "workspace",
      })
    ).response.status,
    409,
  );
  const memory = f.product.queries.detail(bot.id).memories[0];
  assert.equal(memory.scopeKey, `project:${project.id}`);
  const promoted = await f.request(`/bots/${bot.id}/memories`, "POST", {
    id: memory.id,
    revision: memory.revision,
    content: memory.content,
    scopeKey: "global",
  });
  assert.equal(promoted.response.status, 200);
  f.product.messages.newContext(bot.id);
  assert.equal(f.product.queries.detail(bot.id).memories[0].id, memory.id);
});

test("linked folders are optional projects; system roots stay protected through ancestor registrations", async (t) => {
  const f = await fixture(t),
    bot = await f.product.bots.create();
  const context = f.product.queries.detail(bot.id).session.context!;
  const root = join(f.dir, "repository");
  assert.equal(f.store.directory, await realpath(join(f.dir, "data")));
  await mkdir(join(root, ".git"), { recursive: true });
  let result = await f.request(`/bots/${bot.id}/work-location`, "PUT", {
    contextId: context.id,
    path: root,
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.location.kind, "folder");
  assert.equal(result.data.location.projectId, undefined);
  assert.equal(f.tasks.projects.list().length, 1);
  assert.equal(
    (
      await f.request("/projects", "POST", {
        name: "internal",
        path: join(root, ".git"),
      })
    ).response.status,
    403,
  );
  const parent = (
    await f.request("/projects", "POST", { name: "parent", path: f.dir })
  ).data;
  assert.equal(
    (
      await f.request("/projects", "POST", {
        name: "credentials",
        path: join(f.dir, "data"),
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await f.request(
        `/work-locations/project-${parent.id}/content?path=data/state.json`,
      )
    ).response.status,
    403,
  );
  const big = Buffer.alloc(1024 * 1024 + 1, 65);
  await writeFile(join(root, "big.txt"), big);
  const file = (
    await f.request(
      `/work-locations/${result.data.location.id}/content?path=big.txt`,
    )
  ).data;
  assert.equal(file.editable, false);
  assert.equal(file.revision.length, 64);
  result = await f.request(
    `/work-locations/${result.data.location.id}/move`,
    "POST",
    { path: "big.txt", to: "large.txt", revision: file.revision },
  );
  assert.equal(result.response.status, 200);
  assert.equal((await stat(join(root, "large.txt"))).size, big.length);
});

test("project memories are shared within a project; bot preferences and other projects stay isolated", async (t) => {
  const f = await fixture(t, async (o) => {
    await call(o, "remember", { content: "Shared project fact" });
    return { text: "done" };
  });
  const a = await f.product.bots.create("a"),
    b = await f.product.bots.create("b");
  const p = await f.tasks.projects.add({ name: "Shared" });
  for (const bot of [a, b]) {
    const context = f.product.queries.detail(bot.id).session.context!;
    await f.request(`/bots/${bot.id}/work-location`, "PUT", {
      contextId: context.id,
      projectId: p.id,
    });
  }
  await f.product.jobs.submit(a.id, {
    prompt: "store fact",
    requestId: "project-fact",
  });
  await f.finish();
  assert.equal(
    f.product.queries.detail(b.id).memories[0].content,
    "Shared project fact",
  );
  await f.product.jobs.submit(b.id, {
    prompt: "same fact",
    requestId: "same-fact",
  });
  await f.finish();
  assert.equal(
    f.store.state.memories.filter((m) => m.scopeKey === `project:${p.id}`)
      .length,
    1,
  );
  await f.request(`/bots/${a.id}/memories`, "POST", {
    content: "Only A preference",
    scopeKey: "global",
  });
  assert.equal(f.product.queries.detail(b.id).memories.length, 1);
  f.product.messages.newContext(b.id);
  assert.equal(f.product.queries.detail(b.id).memories.length, 0);
});

test("delegated deliveries appear in the original bot and old snapshots can be explicitly brought into a new task", async (t) => {
  let workerId = "";
  const f = await fixture(t, async (o) => {
    if (o.prompt === "delegate")
      await call(o, "delegate_task", { botId: workerId, prompt: "publish" });
    else {
      await call(o, "write_file", {
        path: "result.md",
        content: "Published version",
      });
      await call(o, "publish_file", { path: "result.md", name: "Delivery" });
    }
    return { text: "done" };
  });
  const owner = await f.product.bots.create(),
    worker = await f.product.bots.create();
  workerId = worker.id;
  await f.product.jobs.submit(owner.id, {
    prompt: "delegate",
    requestId: "delegated-delivery",
  });
  await f.finish();
  const artifact = f.product.queries.detail(owner.id).artifacts[0];
  assert.equal(artifact.deliveredFrom, worker.id);
  assert.equal(
    artifact.snapshotPath,
    f.product.queries.detail(worker.id).artifacts[0].snapshotPath,
  );
  await writeFile(
    join(artifact.location!.path, artifact.path),
    "Changed source",
  );
  const context = f.product.messages.newContext(owner.id);
  const result = await f.request(
    `/bots/${owner.id}/artifact-reference`,
    "POST",
    { contextId: context.id, artifactId: artifact.id },
  );
  assert.equal(result.response.status, 200);
  assert.equal(
    await readFile(join(context.location!.path, result.data.path), "utf8"),
    "Published version",
  );
  assert.equal(
    (
      await f.request(`/bots/${worker.id}/artifact-reference`, "POST", {
        contextId: f.product.queries.detail(worker.id).session.context!.id,
        artifactId: artifact.id,
      })
    ).response.status,
    404,
  );
});

test("attachments follow a pre-submit location change and sending fixes the location", async (t) => {
  const f = await fixture(t),
    bot = await f.product.bots.create();
  const context = f.product.queries.detail(bot.id).session.context!;
  const upload = await fetch(
    `${f.base}/api/v2/bots/${bot.id}/attachments?contextId=${context.id}`,
    {
      method: "POST",
      headers: { "X-Apsis-Client": "1", "X-File-Name": "source.txt" },
      body: "Source contents",
    },
  );
  assert.equal(upload.status, 201);
  const artifact = await upload.json();
  assert.equal(
    f.product.queries.detail(bot.id).session.context!.locationLockedAt,
    undefined,
  );
  const project = await f.tasks.projects.add({ name: "Later selected" });
  const bind = await f.request(`/bots/${bot.id}/work-location`, "PUT", {
    contextId: context.id,
    projectId: project.id,
  });
  assert.equal(bind.response.status, 200);
  assert.equal(
    await readFile(join(project.path, artifact.path), "utf8"),
    "Source contents",
  );
  assert.equal(
    f.product.queries.detail(bot.id).artifacts[0].location!.projectId,
    project.id,
  );
  await f.product.jobs.submit(bot.id, {
    prompt: "read source",
    requestId: "attachment-submit",
    workContextId: context.id,
  });
  await f.finish();
  assert.equal(
    (
      await f.request(`/bots/${bot.id}/work-location`, "PUT", {
        contextId: context.id,
        projectId: "workspace",
      })
    ).response.status,
    409,
  );
});
