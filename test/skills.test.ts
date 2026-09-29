import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SkillCatalog } from "../server/skills.ts";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
import { createTools } from "../server/tools.ts";
import { scopedState } from "../server/agents.ts";
import { agentContext } from "../server/context.ts";
import type { AgentDefinition, Skill } from "../shared/types.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "apsis-skills-"));
  const global = join(root, "global");
  const catalog = new SkillCatalog(join(root, "data"), global);
  const put = async (base: string, folder: string, content: string) => {
    const dir = join(base, folder);
    await mkdir(dir, { recursive: true });
    const file = join(dir, "SKILL.md");
    await writeFile(file, content);
    return file;
  };
  return { root, global, catalog, put };
}

test("skills discover both folders, honor local names, parse frontmatter, and refresh edits/removals", async () => {
  const f = await fixture();
  assert.deepEqual(f.catalog.list(), []);
  await f.put(
    f.global,
    "global",
    "---\nname: Review\ndescription: |\n  Global procedure\n---\nGlobal body",
  );
  const local = await f.put(
    f.catalog.local,
    "local",
    "---\nname: Review\ndescription: Local summary\n---\nLocal body",
  );
  await f.put(f.global, "plain", "Plain procedure");
  await f.put(f.global, "invalid", "---\nname: [oops\n---\nbroken");
  const skills = f.catalog.list();
  assert.equal(skills.length, 2);
  const review = skills.find((s) => s.name === "Review")!;
  assert.equal(review.content, "Local body");
  assert.equal(review.description, "Local summary");
  assert.equal(f.catalog.diagnostics.length, 1);
  await writeFile(local, "---\nname: Review\n---\nUpdated body");
  assert.equal((f.catalog.read(review.id) as Skill).content, "Updated body");
  await rm(local);
  assert.throws(() => f.catalog.read(review.id), { status: 404 });
  assert.equal(
    f.catalog.list().find((s) => s.name === "Review")!.content,
    "Global body",
  );
});

test("migration preserves IDs, resumes, never overwrites hand-written skills or resurrects deletions", async () => {
  const f = await fixture();
  await f.put(f.catalog.local, "user", "---\nname: Custom\n---\nHand-written");
  const old: Skill[] = [
    { id: "old-id", name: "Old", content: "Original body" },
    { id: "private", agentId: "bot", name: "Private", content: "Private body" },
  ];
  f.catalog.migrate(old);
  const migrated = f.catalog.list().find((s) => s.id === "old-id")!;
  assert.equal(migrated.content, old[0].content);
  assert.deepEqual(
    JSON.parse(
      await readFile(join(f.catalog.local, ".legacy-backup.json"), "utf8"),
    ),
    old,
  );
  assert.equal(
    f.catalog.list().some((s) => s.id === "private"),
    false,
  );
  await rm(join(f.catalog.local, ".migrated-v1.json"));
  f.catalog.migrate(old); // simulates a crash after publishing files, before the marker
  await writeFile(
    join(migrated.skillDirectory!, "SKILL.md"),
    "---\nname: Old\nx-apsis-id: old-id\n---\nEdited",
  );
  f.catalog.migrate(old);
  assert.equal((f.catalog.read("old-id") as Skill).content, "Edited");
  await rm(join(migrated.skillDirectory!, "SKILL.md"));
  new SkillCatalog(join(f.root, "data"), f.global).migrate(old);
  assert.equal(
    f.catalog.list().some((s) => s.id === "old-id"),
    false,
  );
  assert.equal(
    f.catalog.list().find((s) => s.name === "Custom")!.content,
    "Hand-written",
  );
});

test("resource reads stay inside the chosen skill, including symlink escapes", async () => {
  const f = await fixture();
  const file = await f.put(f.global, "guide", "Guide");
  const skill = f.catalog.list()[0];
  await mkdir(join(skill.skillDirectory!, "references"));
  await writeFile(
    join(skill.skillDirectory!, "references", "notes.md"),
    "Reference",
  );
  assert.deepEqual(f.catalog.read(skill.id, "references/notes.md"), {
    path: "references/notes.md",
    content: "Reference",
  });
  for (const path of [
    "../secret",
    "..\\secret",
    file,
    "C:\\secret",
    "notes.md:stream",
  ])
    assert.throws(() => f.catalog.read(skill.id, path));
  await mkdir(join(f.root, "outside"));
  await writeFile(join(f.root, "outside", "secret.md"), "Secret");
  await symlink(
    join(f.root, "outside"),
    join(skill.skillDirectory!, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => f.catalog.read(skill.id, "escape/secret.md"), {
    status: 403,
  });
  await writeFile(
    join(skill.skillDirectory!, "binary"),
    Buffer.from([0, 1, 2]),
  );
  assert.throws(() => f.catalog.read(skill.id, "binary"), /二進位/);
});

test("every Bot sees shared skills without selection, private skills stay isolated, and tools load fresh resources", async (t) => {
  const f = await fixture();
  const store = await new Store(join(f.root, "data"), f.global).init();
  t.after(() => store.conversations.db.close());
  const workspace = await new Workspace(join(f.root, "work")).init();
  const agent: AgentDefinition = {
    id: "bot-a",
    name: "A",
    description: "",
    instructions: "",
    engine: "deepagents",
    provider: "ollama",
    model: "fixture",
    tools: ["list_skills", "read_skill", "save_skill"],
    skillIds: [],
    memoryScope: "private",
    createdAt: "",
    updatedAt: "",
  };
  await store.mutate((s) =>
    s.skills.push({
      id: "private",
      agentId: agent.id,
      name: "Private",
      content: "Private",
    }),
  );
  await f.put(
    f.global,
    "live",
    "---\nname: Live\ndescription: Short summary\n---\nComplete private-to-prompt body",
  );
  const shared = store.skillState().skills.find((s) => s.name === "Live")!;
  assert.ok(
    scopedState(store.skillState(), agent).skills.some(
      (s) => s.id === shared.id,
    ),
  );
  assert.ok(
    !scopedState(store.skillState(), { ...agent, id: "bot-b" }).skills.some(
      (s) => s.id === "private",
    ),
  );
  const prompt = agentContext(store, false, agent);
  assert.match(prompt, /Short summary/);
  assert.doesNotMatch(prompt, /Complete private-to-prompt body/);
  const tools = createTools({ store, workspace, agent, allowWrites: true });
  const read = tools.find((tool) => tool.name === "read_skill")!;
  await writeFile(join(shared.skillDirectory!, "notes.md"), "Live resource");
  const result = await read.execute("read", {
    id: shared.id,
    path: "notes.md",
  });
  assert.match(JSON.stringify(result), /Live resource/);
  await tools
    .find((tool) => tool.name === "save_skill")!
    .execute("save", { name: "Bot private", content: "For bot A" });
  assert.ok(
    !scopedState(store.skillState(), { ...agent, id: "bot-b" }).skills.some(
      (s) => s.name === "Bot private",
    ),
  );
  const common = createTools({ store, workspace, allowWrites: true }).find(
    (tool) => tool.name === "save_skill",
  )!;
  await common.execute("save-global", {
    name: "Shared saved",
    content: "Reusable",
  });
  assert.ok(store.skills.list().some((s) => s.name === "Shared saved"));
  assert.ok(!store.state.skills.some((s) => s.name === "Shared saved"));
});
