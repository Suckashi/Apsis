import { createHash, randomUUID } from "node:crypto";

import { readFile, writeFile, stat, copyFile, open } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

import { Workspace } from "./workspace.ts";

import type { TaskService } from "./tasks.ts";

import type { Bot, Artifact } from "../shared/product.ts";
import type { WorkLocation } from "../shared/types.ts";

import { ProductDB } from "./product-db.ts";

import type { BotService } from "./bot-service.ts";
import type { ApprovalService } from "./approval-service.ts";
import { now, fail } from "./product-support.ts";
import { capturePublishedBundle } from "./published-bundle.ts";

interface Dependencies {
  authorize: ApprovalService["authorize"];
  db: ProductDB;
  notify: (botId?: string, jobId?: string) => void;
  tasks: TaskService;
  workLocation: (bot: Bot, runId?: string) => WorkLocation;
  writableBot: BotService["writableBot"];
}

export class ArtifactService {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  async publish(
    bot: Bot,
    runId: string | undefined,
    path: string,
    name: string,
    kind: Artifact["kind"] = "result",
    signal?: AbortSignal,
    explicitLocation?: WorkLocation,
    document?: Omit<NonNullable<Artifact["document"]>, "revision">,
    assets?: unknown,
  ) {
    if (runId)
      await this.deps.authorize(
        bot.id,
        runId,
        "publish_file",
        { path, name, ...(assets !== undefined ? { assets } : {}) },
        signal,
      );
    const location = explicitLocation || this.deps.workLocation(bot, runId);
    const resolved = await this.deps.tasks.locations
      .workspace(location)
      .resolve(path);
    const info = await stat(resolved);
    if (!info.isFile()) fail("成果必須是檔案。");
    if (info.size > 20 * 1024 * 1024) fail("成果檔案超過 20 MB。");
    let snapshotPath = `${randomUUID()}/${basename(path)}`;
    if (runId && kind === "result" && assets === undefined)
      await this.deps.authorize(
        bot.id,
        runId,
        "write_file",
        { path: `published/${snapshotPath}` },
        signal,
      );
    signal?.throwIfAborted();
    const snapshots = new Workspace(
      join(this.deps.tasks.store.directory, "artifacts"),
      true,
    );
    let bundle: Artifact["bundle"];
    let cleanup: (() => Promise<void>) | undefined;
    if (assets !== undefined) {
      if (kind !== "result") fail("只有成果可一併發布網頁資源。");
      const captured = await capturePublishedBundle(
        this.deps.tasks.locations.workspace(location),
        snapshots,
        path,
        assets,
        (tool, args) =>
          runId
            ? this.deps.authorize(bot.id, runId, tool, args, signal)
            : Promise.resolve(),
        signal,
      );
      snapshotPath = captured.snapshotPath;
      bundle = captured.bundle;
      cleanup = captured.cleanup;
    } else
      await copyFile(resolved, await snapshots.resolve(snapshotPath, true));
    const mime =
      (
        {
          ".pdf": "application/pdf",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".md": "text/markdown",
          ".txt": "text/plain",
          ".csv": "text/csv",
          ".docx":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ".xlsx":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        } as Record<string, string>
      )[extname(path).toLowerCase()] || "application/octet-stream";
    let artifact: Artifact;
    try {
      signal?.throwIfAborted();
      this.deps.writableBot(bot.id);
      // Allocate after the asynchronous copy; no await between reading revisions
      // and saving. Concurrent publications cannot receive the same revision.
      const revision = document
        ? 1 +
          Math.max(
            0,
            ...this.deps.db.artifacts
              .list({ botId: bot.id, runId })
              .filter((a) => a.document?.seriesId === document.seriesId)
              .map((a) => a.document!.revision),
          )
        : undefined;
      artifact = this.deps.db.artifacts.put({
        id: randomUUID(),
        botId: bot.id,
        runId,
        name: name.slice(0, 200) || basename(path),
        path,
        mime,
        createdAt: now(),
        kind,
        location,
        snapshotPath,
        ...(bundle ? { bundle } : {}),
        ...(document ? { document: { ...document, revision: revision! } } : {}),
        workContextId: runId
          ? this.deps.tasks.runs.records.get(runId)?.workContextId
          : this.deps.tasks.store.conversations.activeId(bot.sessionId),
      });
    } catch (error) {
      await cleanup?.();
      throw error;
    }
    if (kind === "result" && runId) {
      let job = this.deps.db.jobs
        .list()
        .find((row) => row.botId === bot.id && row.runId === runId);
      const visited = new Set<string>();
      while (job?.parentJobId && !visited.has(job.parentJobId)) {
        visited.add(job.parentJobId);
        job = this.deps.db.jobs.get(job.parentJobId);
        if (!job) break;
        this.deps.db.artifacts.put({
          ...artifact,
          id: randomUUID(),
          botId: job.botId,
          runId: job.runId,
          workContextId: job.workContextId,
          deliveredFrom: bot.id,
        });
        this.deps.notify(job.botId);
      }
    }
    this.deps.notify(bot.id);
    return artifact;
  }
  async readDocument(path: string, workspace = this.deps.tasks.workspace) {
    const file = await workspace.resolve(path);
    if ((await stat(file)).size > 20 * 1024 * 1024) fail("文件超過 20 MB。");
    const ext = extname(file).toLowerCase();
    if (ext === ".docx")
      return (
        await (await import("mammoth")).extractRawText({ path: file })
      ).value.slice(0, 100000);
    if (ext === ".xlsx") {
      const Excel = (await import("exceljs")).default;
      const book = new Excel.Workbook();
      await book.xlsx.readFile(file);
      return book.worksheets.map((s) => ({
        name: s.name,
        rows: s.getSheetValues().slice(0, 1000),
      }));
    }
    if (ext === ".pdf") {
      const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loading = pdf.getDocument({
        data: new Uint8Array(await readFile(file)),
        useSystemFonts: true,
      });
      const doc = await loading.promise;
      try {
        const pages = [];
        for (let i = 1; i <= Math.min(doc.numPages, 100); i++) {
          const text = await (await doc.getPage(i)).getTextContent();
          pages.push(
            text.items.map((item) => ("str" in item ? item.str : "")).join(" "),
          );
        }
        return pages.join("\n").slice(0, 100000);
      } finally {
        await loading.destroy();
      }
    }
    return (await readFile(file, "utf8")).slice(0, 100000);
  }
  async createDocument(
    bot: Bot,
    runId: string,
    a: Record<string, string>,
    signal?: AbortSignal,
  ) {
    if (!["docx", "xlsx", "pdf"].includes(a.format)) fail("不支援的文件格式。");
    if (typeof a.name !== "string") fail("請提供文件名稱。");
    if (
      (a.content !== undefined && typeof a.content !== "string") ||
      (a.source_path !== undefined && typeof a.source_path !== "string")
    )
      fail("content 與 source_path 必須是文字。");
    if ((typeof a.content === "string") === (typeof a.source_path === "string"))
      fail("請提供 content 或 source_path，兩者擇一。");
    if (a.source_path !== undefined && !a.source_path.trim())
      fail("請提供來源檔案的相對路徑。");
    if (
      a.content_format !== undefined &&
      a.content_format !== "plain" &&
      a.content_format !== "markdown"
    )
      fail("content_format 必須是 plain 或 markdown。");
    const contentFormat =
      a.content_format === "markdown" ||
      (a.content_format === undefined &&
        /\.(md|markdown)$/i.test(a.source_path || ""))
        ? "markdown"
        : "plain";
    const baseName =
      basename(a.name.replaceAll("\\", "/"))
        .replace(/\.(docx|pdf|xlsx)$/i, "")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .trim()
        .replace(/[. ]+$/, "") || "document";
    const name = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(baseName)
      ? `document-${baseName}`
      : Array.from(baseName).slice(0, 100).join("");
    const path = `results/${randomUUID()}/${name}.${a.format}`;
    await this.deps.authorize(
      bot.id,
      runId,
      "create_document",
      { ...a, path },
      signal,
    );
    const workspace = this.deps.tasks.locations.workspace(
      this.deps.workLocation(bot, runId),
    );
    let content = a.content;
    if (a.source_path !== undefined) {
      await this.deps.authorize(
        bot.id,
        runId,
        "read_file",
        { path: a.source_path },
        signal,
      );
      signal?.throwIfAborted();
      const source = await workspace.resolve(a.source_path);
      const handle = await open(source, "r");
      try {
        const info = await handle.stat();
        if (!info.isFile()) fail("來源必須是文字檔案。");
        if (info.size > 256_000) fail("來源文件超過 256 KB 上限。");
        // Bound the read even if the file grows after stat. Never truncate source.
        const bytes = Buffer.alloc(256_001);
        let length = 0;
        while (length < bytes.length) {
          signal?.throwIfAborted();
          const chunk = await handle.read(
            bytes,
            length,
            bytes.length - length,
            null,
          );
          if (!chunk.bytesRead) break;
          length += chunk.bytesRead;
        }
        if (length > 256_000) fail("來源文件超過 256 KB 上限。");
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(
            bytes.subarray(0, length),
          );
        } catch {
          fail("來源文件必須是 UTF-8 文字。");
        }
        if (content.includes("\0")) fail("來源文件必須是 UTF-8 文字。");
      } finally {
        await handle.close();
      }
    }
    if (Buffer.byteLength(content) > 256_000)
      fail("文件內容超過 256 KB 上限。");
    let rows: unknown[][] | undefined;
    if (a.format === "xlsx") {
      rows = JSON.parse(content);
      if (!Array.isArray(rows) || !rows.every(Array.isArray))
        fail("試算表需為二維 JSON 陣列。");
    }
    await this.deps.authorize(bot.id, runId, "write_file", { path }, signal);
    signal?.throwIfAborted();
    const file = await workspace.resolve(path, true);
    let pageCount: number | undefined;
    if (a.format === "docx") {
      const { exportDocx } = await import("./document-export.ts");
      const buffer = await exportDocx(content, name, contentFormat);
      signal?.throwIfAborted();
      await writeFile(file, buffer);
    }
    if (a.format === "xlsx") {
      const Excel = (await import("exceljs")).default;
      const book = new Excel.Workbook();
      book.addWorksheet("Sheet1").addRows(rows!);
      await book.xlsx.writeFile(file);
    }
    if (a.format === "pdf") {
      const { exportPdf } = await import("./document-export.ts");
      pageCount = await exportPdf(file, content, name, contentFormat, signal);
    }
    const artifact = await this.publish(
      bot,
      runId,
      path,
      `${name}.${a.format}`,
      "result",
      signal,
      undefined,
      {
        seriesId: createHash("sha256")
          .update(JSON.stringify([bot.id, runId, `${name}.${a.format}`]))
          .digest("hex"),
        contentHash: createHash("sha256").update(content).digest("hex"),
        contentFormat: a.format === "xlsx" ? "json-rows" : contentFormat,
        ...(a.source_path !== undefined ? { sourcePath: a.source_path } : {}),
        ...(pageCount !== undefined ? { pageCount } : {}),
        layoutVerified: false,
      },
    );
    return {
      ...artifact,
      document: {
        ...artifact.document!,
        note: "檔案已產生；內容與排版仍需讀回及檢查。DOCX／PDF 的 Markdown 圖片只保留說明文字。",
      },
    };
  }
}
