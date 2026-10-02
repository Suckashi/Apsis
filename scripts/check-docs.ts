import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const lock = JSON.parse(
  await readFile(resolve(root, "package-lock.json"), "utf8"),
);
assert.equal(manifest.license, "Apache-2.0", "Project license metadata");
assert.equal(lock.version, manifest.version, "Lockfile version");
assert.equal(
  lock.packages[""].version,
  manifest.version,
  "Root package version",
);
assert.equal(lock.packages[""].license, manifest.license, "Lockfile license");

const tag = `v${manifest.version}`;
const args = process.argv.slice(2);
if (args.length) {
  assert.equal(args.length, 2, "Usage: check-docs.ts [--release v<version>]");
  assert.equal(args[0], "--release");
  assert.match(
    args[1],
    /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)?$/,
  );
  assert.equal(args[1], tag, "Release tag must match package version");
}

const docs = [
  "README.md",
  "README.zh-TW.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "THIRD_PARTY_NOTICES.md",
  "CHANGELOG.md",
  "docs/README.md",
  "docs/getting-started.md",
  "docs/getting-started.zh-TW.md",
  "docs/releases.md",
  "docs/roadmap.md",
  "docs/alpha-acceptance.md",
  "docs/architecture.md",
  "docs/bot-workspace.md",
  ...(await readdir(resolve(root, "docs/releases")))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/releases/${name}`),
];
const failures: string[] = [];
let links = 0;
for (const doc of docs) {
  const source = await readFile(resolve(root, doc), "utf8");
  // Entry guides use ordinary inline Markdown links/images. External links and
  // fragments are not network-checked; local targets must exist in the source.
  for (const match of source.matchAll(
    /!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
  )) {
    const href = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) continue;
    const target = decodeURIComponent(href.split(/[?#]/, 1)[0]);
    if (!target) continue;
    links++;
    await access(resolve(dirname(resolve(root, doc)), target)).catch(() => {
      failures.push(`${doc}: missing ${href}`);
    });
  }
  if (
    /^(?:README(?:\.zh-TW)?|docs\/getting-started(?:\.zh-TW)?)\.md$/.test(doc)
  ) {
    if (!source.includes(`git clone --branch ${tag} `))
      failures.push(`${doc}: installation tag must be ${tag}`);
  }
}
await access(resolve(root, `docs/releases/${manifest.version}.md`));
const license = await readFile(resolve(root, "LICENSE"), "utf8");
assert.ok(license.includes("Version 2.0, January 2004"), "Apache license text");
await access(resolve(root, "NOTICE"));
assert.deepEqual(failures, [], failures.join("\n"));
console.log(
  `Documentation OK: ${docs.length} current/release documents, ${links} local links; ${tag}, Apache-2.0.`,
);
