import { randomUUID } from "node:crypto";

import { readFile, writeFile, stat, copyFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

import { Workspace } from "./workspace.ts";

import type { TaskService } from "./tasks.ts";

import type { Bot, Artifact } from "../shared/product.ts";
import type { WorkLocation } from "../shared/types.ts";

import { ProductDB } from "./product-db.ts";
import { browserExecutable } from "./bot-browser.ts";

import type { BotService } from "./bot-service.ts";
import type { ApprovalService } from "./approval-service.ts";
import { now, fail } from "./product-support.ts";

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
  ) {
    if (runId)
      await this.deps.authorize(
        bot.id,
        runId,
        "publish_file",
        { path, name },
        signal,
      );
    const location = explicitLocation || this.deps.workLocation(bot, runId);
    const resolved = await this.deps.tasks.locations
      .workspace(location)
      .resolve(path);
    const info = await stat(resolved);
    if (!info.isFile()) fail("成果必須是檔案。");
    if (info.size > 20 * 1024 * 1024) fail("成果檔案超過 20 MB。");
    const snapshotPath = `${randomUUID()}/${basename(path)}`;
    if (runId && kind === "result")
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
    this.deps.writableBot(bot.id);
    const artifact = this.deps.db.artifacts.put({
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
      workContextId: runId
        ? this.deps.tasks.runs.records.get(runId)?.workContextId
        : this.deps.tasks.store.conversations.activeId(bot.sessionId),
    });
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
    const path = `results/${randomUUID()}/${basename(a.name).replace(/[^\p{L}\p{N}_ -]/gu, "_") || "document"}.${a.format}`;
    await this.deps.authorize(
      bot.id,
      runId,
      "create_document",
      { ...a, path },
      signal,
    );
    await this.deps.authorize(bot.id, runId, "write_file", { path }, signal);
    signal?.throwIfAborted();
    const file = await this.deps.tasks.locations
      .workspace(this.deps.workLocation(bot, runId))
      .resolve(path, true);
    if (a.format === "docx") {
      const { Document, Packer, Paragraph } = await import("docx");
      await writeFile(
        file,
        await Packer.toBuffer(
          new Document({
            sections: [
              {
                children: a.content
                  .split("\n")
                  .map((text) => new Paragraph(text)),
              },
            ],
          }),
        ),
      );
    }
    if (a.format === "xlsx") {
      const Excel = (await import("exceljs")).default;
      const rows = JSON.parse(a.content);
      if (!Array.isArray(rows) || !rows.every(Array.isArray))
        fail("試算表需為二維 JSON 陣列。");
      const book = new Excel.Workbook();
      book.addWorksheet("Sheet1").addRows(rows);
      await book.xlsx.writeFile(file);
    }
    if (a.format === "pdf") {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({
        executablePath: browserExecutable(),
      });
      try {
        const page = await browser.newPage();
        await page.setContent(
          `<html><meta charset="utf-8"><body></body></html>`,
        );
        await page.locator("body").evaluate((node, text) => {
          node.textContent = text;
          (node as HTMLElement).style.cssText =
            "white-space:pre-wrap;font:16px sans-serif;line-height:1.6";
        }, a.content);
        await page.pdf({
          path: file,
          format: "A4",
          margin: { top: "20mm", bottom: "20mm", left: "20mm", right: "20mm" },
        });
      } finally {
        await browser.close();
      }
    }
    return this.publish(
      bot,
      runId,
      path,
      `${a.name}.${a.format}`,
      "result",
      signal,
    );
  }
}
