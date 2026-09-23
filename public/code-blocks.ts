let initialized = false;

/** One delegated listener also handles code blocks replaced during streaming. */
export function initCodeBlocks(notify: (message: string) => void): void {
  if (initialized) return;
  initialized = true;
  const copying = new WeakSet<HTMLButtonElement>();
  const resets = new WeakMap<
    HTMLButtonElement,
    ReturnType<typeof setTimeout>
  >();

  document.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button.copy-code[data-copy-code]");
    if (!(button instanceof HTMLButtonElement) || copying.has(button)) return;
    const code = button.closest(".code-block")?.querySelector("pre > code");
    if (!code) return;

    // Keep keyboard focus on the action while the Clipboard API is pending.
    // In particular, never trim leading indentation or the final newline.
    const text = code.textContent || "";
    copying.add(button);
    button.setAttribute("aria-busy", "true");
    const previousReset = resets.get(button);
    if (previousReset) clearTimeout(previousReset);

    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "已複製";
      button.setAttribute("aria-label", "程式碼已複製");
      button.dataset.copied = "true";
      notify("程式碼已複製");
    } catch {
      button.textContent = "複製失敗";
      button.setAttribute("aria-label", "複製失敗，重新複製程式碼");
      delete button.dataset.copied;
      notify("無法存取剪貼簿，請選取程式碼後手動複製。");
    } finally {
      copying.delete(button);
      button.removeAttribute("aria-busy");
      resets.set(
        button,
        setTimeout(() => {
          button.textContent = "複製";
          button.setAttribute("aria-label", "複製程式碼");
          delete button.dataset.copied;
          resets.delete(button);
        }, 2000),
      );
    }
  });
}
