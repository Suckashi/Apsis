import { crc32 } from "node:zlib";
import { randomUUID } from "node:crypto";
import { open, writeFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Workspace } from "./workspace.ts";
import { fail } from "./product-support.ts";
import type { Artifact } from "../shared/product.ts";

export const bundleLimit = 20 * 1024 * 1024;
export const bundleFileLimit = 64;

// PKWARE APPNOTE: uncompressed entries, UTF-8 names, CRC-32, central directory.
// The bounded bundle never needs ZIP64 and introduces no runtime dependency.
export function storedZip(entries: { path: string; data: Buffer }[]) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    if (name.length > 65535) fail("檔案名稱過長。");
    const checksum = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0x21, 12); // 1980-01-01; deterministic archive metadata.
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(entry.data.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    header.copy(record, 6, 4, 28);
    record.writeUInt32LE(offset, 42);
    local.push(header, name, entry.data);
    central.push(record, name);
    offset += header.length + name.length + entry.data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export async function capturePublishedBundle(
  workspace: Workspace,
  snapshots: Workspace,
  entry: string,
  assets: unknown,
  authorize: (tool: string, args: { path: string }) => Promise<unknown>,
  signal?: AbortSignal,
) {
  if (!/\.html?$/i.test(entry))
    fail(
      "assets 只適用於 HTML 網頁。若要發布 Markdown 或其他單一檔案，請省略 assets，使用相同的 path 與 name 重試 publish_file。",
    );
  if (
    !Array.isArray(assets) ||
    assets.length < 1 ||
    assets.length >= bundleFileLimit ||
    assets.some((path) => typeof path !== "string")
  )
    fail("assets 需為 1–63 個工作區相對檔案路徑。");
  const assetPaths = assets as string[];
  const paths = [entry, ...assetPaths].map((path: string) =>
    path
      .replaceAll("\\", "/")
      .split("/")
      .filter((part) => part && part !== ".")
      .join("/"),
  );
  if (new Set(paths.map((path) => path.toLowerCase())).size !== paths.length)
    fail("網頁資源路徑不可重複。");
  const captured: { path: string; data: Buffer }[] = [];
  let total = 0;
  for (let index = 0; index < paths.length; index++) {
    signal?.throwIfAborted();
    // Validate the original path too: normalization must never erase a leading
    // slash, drive prefix, parent traversal or protected workspace boundary.
    const original = index === 0 ? entry : assetPaths[index - 1];
    const file = await workspace.resolve(original);
    await authorize("publish_file", { path: original });
    await authorize("read_file", { path: original });
    const handle = await open(file, "r");
    try {
      const info = await handle.stat();
      if (!info.isFile()) fail("網頁資源必須是檔案。");
      if (info.size + total > bundleLimit) fail("網頁與資源總大小超過 20 MB。");
      if (index === 0 && info.size > 1024 * 1024)
        fail("網頁主檔超過 1 MB 預覽上限。");
      const buffer = Buffer.alloc(
        Math.min(bundleLimit - total + 1, info.size + 1),
      );
      let read = 0;
      while (read < buffer.length) {
        signal?.throwIfAborted();
        const chunk = await handle.read(
          buffer,
          read,
          buffer.length - read,
          null,
        );
        if (!chunk.bytesRead) break;
        read += chunk.bytesRead;
      }
      const after = await handle.stat();
      if (
        read !== info.size ||
        after.size !== info.size ||
        after.mtimeMs !== info.mtimeMs
      )
        fail("網頁資源在發布時已變更，請完成修改後重試。", 409);
      total += read;
      captured.push({ path: paths[index], data: buffer.subarray(0, read) });
    } finally {
      await handle.close();
    }
  }
  const id = randomUUID();
  const files = captured.map(({ path }) => ({
    path,
    snapshotPath: `${id}/files/${path}`,
  }));
  const archivePath = `${id}/download.zip`;
  for (const file of [...files, { snapshotPath: archivePath }])
    await authorize("write_file", { path: `published/${file.snapshotPath}` });
  signal?.throwIfAborted();
  const archive = storedZip(captured);
  // Only this fresh capture's staging directory may be removed on failure.
  const stage = await snapshots.resolve(id, true);
  if (dirname(stage) !== resolve(snapshots.root)) fail("無效的成果暫存位置。");
  const cleanup = async () => {
    const target = await snapshots.resolve(id, true);
    if (
      target !== stage ||
      !Workspace.contains(snapshots.root, target) ||
      dirname(target) !== resolve(snapshots.root)
    )
      fail("無效的成果暫存位置。");
    await rm(target, { recursive: true, force: true });
  };
  try {
    for (let index = 0; index < files.length; index++) {
      signal?.throwIfAborted();
      await writeFile(
        await snapshots.resolve(files[index].snapshotPath, true),
        captured[index].data,
      );
    }
    await writeFile(await snapshots.resolve(archivePath, true), archive);
    signal?.throwIfAborted();
  } catch (error) {
    await cleanup();
    throw error;
  }
  return {
    snapshotPath: files[0].snapshotPath,
    bundle: {
      entry: paths[0],
      files,
      archivePath,
      totalBytes: total,
    } satisfies NonNullable<Artifact["bundle"]>,
    cleanup,
  };
}
