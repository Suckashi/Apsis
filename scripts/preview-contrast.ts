import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { AxeBuilder } from "@axe-core/playwright";

/** Retain clipped-text uncertainty and check actual painted contrast independently. */
export async function reviewPreviewContrast(
  page: Page,
  result: Awaited<ReturnType<AxeBuilder["analyze"]>>,
  name: string,
) {
  const paintedText = await page.locator(".file-content > .markdown").evaluate(
    (markdown, reviewFooter) => {
      const body = markdown.parentElement!;
      const previousScroll = body.scrollTop;
      const port = body.getBoundingClientRect();
      const parse = (value: string) => value.match(/[\d.]+/g)!.map(Number);
      const tableScroll = Array.from(
        markdown.querySelectorAll<HTMLElement>(".markdown-table"),
      ).map((element) => ({ element, left: element.scrollLeft }));
      const luminance = (rgb: number[]) =>
        rgb
          .slice(0, 3)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const review = [
        ...markdown.querySelectorAll<HTMLElement>(
          "h1,h2,h3,h4,h5,h6,p,li,th,td",
        ),
        ...body.querySelectorAll<HTMLElement>(":scope > p"),
      ].map((element) => {
        const before = element.getBoundingClientRect();
        body.scrollTop +=
          before.top - port.top - port.height / 2 + before.height / 2;
        const table = element.closest<HTMLElement>(".markdown-table");
        if (table) {
          const cell = element.getBoundingClientRect(),
            tablePort = table.getBoundingClientRect();
          table.scrollLeft +=
            cell.left - tablePort.left - tablePort.width / 2 + cell.width / 2;
        }
        const rect = element.getBoundingClientRect();
        const foreground = getComputedStyle(element).color;
        let backdrop: Element | null = element;
        while (
          backdrop &&
          parse(getComputedStyle(backdrop).backgroundColor)[3] === 0
        )
          backdrop = backdrop.parentElement;
        const background = getComputedStyle(backdrop!).backgroundColor;
        const a = luminance(parse(foreground)),
          b = luminance(parse(background));
        const top = Math.max(rect.top, port.top, 0),
          bottom = Math.min(rect.bottom, port.bottom, innerHeight);
        const horizontal = table?.getBoundingClientRect() || port;
        const left = Math.max(rect.left, port.left, horizontal.left, 0),
          right = Math.min(
            rect.right,
            port.right,
            horizontal.right,
            innerWidth,
          );
        const points = [];
        if (bottom > top + 2 && right > left + 2)
          for (const fraction of [0.25, 0.5, 0.75])
            points.push(
              element.contains(
                document.elementFromPoint(
                  left + (right - left) / 2,
                  top + (bottom - top) * fraction,
                ),
              ),
            );
        return {
          tag: element.tagName,
          foreground,
          background,
          contrastRatio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          opaque:
            (parse(foreground)[3] ?? 1) === 1 &&
            (parse(background)[3] ?? 1) === 1,
          points: points.length,
          visibleTextOnTop: points.every(Boolean),
        };
      });
      body.scrollTop = previousScroll;
      for (const item of tableScroll) item.element.scrollLeft = item.left;
      if (reviewFooter) {
        const summary = body
          .closest(".details")!
          .querySelector<HTMLElement>(":scope > .cw-deliveries > summary")!;
        const rect = summary.getBoundingClientRect(),
          style = getComputedStyle(summary);
        const foreground = style.color,
          background = style.backgroundColor;
        const a = luminance(parse(foreground)),
          b = luminance(parse(background));
        const hits = [];
        for (const x of [0.1, 0.3, 0.5, 0.7, 0.9])
          for (const y of [0.2, 0.5, 0.8])
            hits.push(
              summary.contains(
                document.elementFromPoint(
                  rect.left + rect.width * x,
                  rect.top + rect.height * y,
                ),
              ),
            );
        review.push({
          tag: summary.tagName,
          foreground,
          background,
          contrastRatio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          opaque:
            (parse(foreground)[3] ?? 1) === 1 &&
            (parse(background)[3] ?? 1) === 1,
          points: hits.length,
          visibleTextOnTop: hits.every(Boolean),
        });
      }
      return review;
    },
    result.incomplete.some((finding) =>
      finding.nodes.some((node) =>
        node.target.includes(".cw-deliveries > summary"),
      ),
    ),
  );
  for (const item of paintedText)
    assert.ok(
      item.opaque &&
        item.contrastRatio >= 4.5 &&
        item.points > 0 &&
        item.visibleTextOnTop,
      `${name}: actual painted text`,
    );
  assert.ok(paintedText.some((item) => item.points > 0));
  // Retain every raw finding; uncertain contrast on scroll-clipped text gets
  // separate opaque-color and browser hit-order evidence, never a fake zero.
  for (const finding of result.incomplete) {
    assert.equal(finding.id, "color-contrast");
    for (const node of finding.nodes) {
      assert.ok(
        node.any.some(
          (check) =>
            (check.data as { messageKey?: string })?.messageKey ===
              "elmPartiallyObscured" ||
            ((check.data as { messageKey?: string })?.messageKey ===
              "elmPartiallyObscuring" &&
              node.target.includes(".cw-deliveries > summary")),
        ),
      );
      for (const target of node.target) {
        assert.equal(typeof target, "string");
        const targetReview = await page
          .locator(target as string)
          .evaluateAll((nodes) =>
            nodes.map((element) => ({
              tag: element.tagName,
              reading:
                !!element.closest(".file-content > .markdown") ||
                element.matches(".file-content > p"),
              footer: element.matches(".cw-deliveries > summary"),
            })),
          );
        assert.ok(
          targetReview.length > 0 &&
            targetReview.every(
              (node) =>
                (/^(H[1-6]|P|LI|TH|TD)$/.test(node.tag) && node.reading) ||
                (node.tag === "SUMMARY" && node.footer),
            ),
          `${name}: ${String(target)} ${JSON.stringify(targetReview)}`,
        );
      }
    }
  }
  return paintedText;
}
