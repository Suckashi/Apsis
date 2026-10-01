import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

async function sources(root: string): Promise<string> {
  const hashes: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/\.(ts|js|json)$/.test(entry.name))
        hashes.push(
          path +
            ":" +
            createHash("sha256")
              .update(await readFile(path))
              .digest("hex"),
        );
    }
  };
  await visit(join(root, "server"));
  await visit(join(root, "shared"));
  return hashes.join("\n");
}

/** Compare source bytes, ignoring generated work and metadata-only file events. */
export async function watchDevelopmentSources(
  root: string,
  changed: () => void,
  intervalMs = 1000,
) {
  let previous = await sources(root),
    candidate = previous,
    reading = false,
    closed = false;
  const timer = setInterval(async () => {
    if (reading || closed) return;
    reading = true;
    try {
      const current = await sources(root);
      if (closed) return;
      if (current === previous) candidate = previous;
      else if (current !== candidate) candidate = current;
      else {
        // Editors may truncate and rewrite a file between reads. Wait for
        // matching snapshots before restarting on the completed source edit.
        previous = current;
        changed();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.error(error);
    } finally {
      reading = false;
    }
  }, intervalMs);
  return () => {
    closed = true;
    clearInterval(timer);
  };
}
