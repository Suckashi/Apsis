import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { brotliCompress, gzip, constants } from "node:zlib";

const brotli = promisify(brotliCompress),
  gzipAsync = promisify(gzip);
type Encoding = "br" | "gzip" | "identity";
type Asset = { tag: string; bodies: Record<Encoding, Buffer> };

function encoding(header = ""): Encoding | undefined {
  if (!header.trim()) return "identity";
  const weights = new Map(
    header.split(",").map((part) => {
      const [name, ...parameters] = part.trim().toLowerCase().split(";");
      const parameter = parameters.find((value) =>
        value.trim().startsWith("q="),
      );
      const weight = parameter ? Number(parameter.trim().slice(2)) : 1;
      return [
        name,
        Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0,
      ] as const;
    }),
  );
  const choices = (["br", "gzip"] as const)
    .map((name) => ({
      name,
      weight: weights.get(name) ?? weights.get("*") ?? 0,
    }))
    .sort((a, b) => b.weight - a.weight);
  const preferred = choices[0];
  const identity = weights.get("identity") ?? (weights.get("*") === 0 ? 0 : 1);
  if (
    preferred.weight > 0 &&
    !(weights.has("identity") && identity > preferred.weight)
  )
    return preferred.name;
  return identity > 0 ? "identity" : undefined;
}

/** Public static assets only; private API responses and nonce-bearing HTML stay uncached. */
export class StaticAssets {
  private cache = new Map<
    string,
    { revision: string; ready: Promise<Asset> }
  >();
  async serve(
    file: URL,
    type: string,
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    const info = await stat(file);
    const revision = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
    let cached = this.cache.get(file.href);
    if (!cached || cached.revision !== revision) {
      const ready = readFile(file).then(async (body) => {
        const [br, gz] = await Promise.all([
          brotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
          gzipAsync(body),
        ]);
        return {
          tag: createHash("sha256").update(body).digest("hex"),
          bodies: { identity: body, br, gzip: gz },
        };
      });
      cached = { revision, ready };
      this.cache.set(file.href, cached);
      void ready.catch(() => {
        if (this.cache.get(file.href) === cached) this.cache.delete(file.href);
      });
    }
    const choice = encoding(req.headers["accept-encoding"]);
    if (!choice) {
      res.writeHead(406);
      res.end();
      return;
    }
    const asset = await cached.ready;
    const tag = `"${asset.tag}-${choice}"`;
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("ETag", tag);
    res.setHeader("Content-Type", type + "; charset=utf-8");
    if (choice !== "identity") res.setHeader("Content-Encoding", choice);
    if (
      req.headers["if-none-match"]
        ?.split(",")
        .some(
          (value) =>
            value.trim().replace(/^W\//, "") === tag || value.trim() === "*",
        )
    ) {
      res.writeHead(304);
      res.end();
      return;
    }
    res.setHeader("Content-Length", asset.bodies[choice].length);
    res.writeHead(200);
    res.end(req.method === "HEAD" ? undefined : asset.bodies[choice]);
  }
}
