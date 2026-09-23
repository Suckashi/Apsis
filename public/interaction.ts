import { preferences } from "./workflow.ts";

export interface Command {
  id: string;
  label: string;
  hint: string;
  group: string;
  keywords?: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

export function initTheme() {
  const button = document.querySelector<HTMLButtonElement>("#theme-toggle");
  const system = matchMedia("(prefers-color-scheme: dark)");
  const saved = preferences.get("talaria-theme");
  let mode =
    saved === "light" || saved === "dark" || saved === "system"
      ? saved
      : "dark";
  const labels: Record<string, string> = {
    system: "跟隨系統",
    light: "淺色模式",
    dark: "深色模式",
  };
  const apply = () => {
    const dark = mode === "dark" || (mode === "system" && system.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.themePreference = mode;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#070707" : "#ffffff");
    if (!button) return;
    const next =
      mode === "system" ? "light" : mode === "light" ? "dark" : "system";
    button.title = `${labels[mode]}；切換至${labels[next]}`;
    button.setAttribute("aria-label", button.title);
    const label = button.querySelector("[data-theme-label]");
    if (label) label.textContent = labels[mode]!;
    const icon = button.querySelector("[data-theme-icon]");
    if (icon) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "icon");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute(
        "href",
        mode === "system"
          ? "#i-monitor"
          : mode === "dark"
            ? "#i-moon"
            : "#i-sun",
      );
      svg.append(use);
      icon.replaceChildren(svg);
    }
  };
  button?.addEventListener("click", () => {
    mode = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
    preferences.set("talaria-theme", mode);
    apply();
  });
  system.addEventListener("change", apply);
  apply();
}

export function initComposer(prompt: HTMLTextAreaElement, submit: () => void) {
  const mobile = matchMedia("(max-width: 680px), (pointer: coarse)");
  let composing = false;
  let compositionEnded = 0;
  const resize = () => {
    prompt.style.height = "auto";
    if (!prompt.getClientRects().length) return;
    const minimum = parseFloat(getComputedStyle(prompt).minHeight) || 48;
    const height = Math.min(180, Math.max(minimum, prompt.scrollHeight + 2));
    prompt.style.height = `${height}px`;
    prompt.style.overflowY = prompt.scrollHeight > 180 ? "auto" : "hidden";
  };
  const hint = () => {
    const label = document.querySelector("#composer-hint");
    if (label)
      label.textContent = mobile.matches
        ? "Enter 換行"
        : "Enter 傳送 · Shift + Enter 換行";
  };
  prompt.addEventListener("compositionstart", () => {
    composing = true;
  });
  prompt.addEventListener("compositionend", () => {
    composing = false;
    compositionEnded = performance.now();
    resize();
  });
  prompt.addEventListener("keydown", (event) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      event.isComposing ||
      composing ||
      event.keyCode === 229 ||
      performance.now() - compositionEnded < 100
    )
      return;
    if (mobile.matches && !event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    submit();
  });
  prompt.addEventListener("input", resize);
  new ResizeObserver(resize).observe(prompt.parentElement!);
  mobile.addEventListener("change", hint);
  hint();
  resize();
  return { resize, mobile };
}

export function initCommandPalette(
  getCommands: () => Command[],
  onError: (error: unknown) => void,
) {
  const dialog = document.querySelector<HTMLDialogElement>("#command-dialog");
  const search = document.querySelector<HTMLInputElement>("#command-search");
  const results = document.querySelector<HTMLElement>("#command-results");
  if (!dialog || !search || !results) return;
  const shortcut = document.querySelector("#command-open kbd");
  if (shortcut)
    shortcut.textContent = /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘ K"
      : "Ctrl K";
  const count = document.querySelector("#command-count");
  let selected = 0;
  let matches: Command[] = [];
  let previousFocus: HTMLElement | null = null;
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-autocomplete", "list");
  search.setAttribute("aria-controls", results.id);
  search.setAttribute("aria-expanded", "true");
  const select = (index: number, scroll = false) => {
    selected = index;
    for (const [i, row] of [
      ...results.querySelectorAll<HTMLElement>(".command-result"),
    ].entries()) {
      row.classList.toggle("is-selected", i === selected);
      row.setAttribute("aria-selected", String(i === selected));
      if (i === selected) {
        search.setAttribute("aria-activedescendant", row.id);
        if (scroll) row.scrollIntoView({ block: "nearest" });
      }
    }
    if (!matches.length) search.removeAttribute("aria-activedescendant");
  };
  const execute = (index: number) => {
    const command = matches[index];
    if (!command || command.disabled) return;
    dialog.close();
    Promise.resolve().then(command.run).catch(onError);
  };
  const render = () => {
    const words = search.value
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    matches = getCommands()
      .filter((command) => {
        const text =
          `${command.label} ${command.hint} ${command.keywords || ""}`.toLocaleLowerCase();
        return words.every((word) => text.includes(word));
      })
      .slice(0, words.length ? 30 : 12);
    results.replaceChildren();
    let group = "";
    for (const [index, command] of matches.entries()) {
      if (command.group !== group) {
        group = command.group;
        const heading = document.createElement("div");
        heading.className = "command-group-label";
        heading.setAttribute("role", "presentation");
        heading.textContent = group;
        results.append(heading);
      }
      const row = document.createElement("div");
      row.className = "command-result";
      row.id = `command-option-${index}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-disabled", String(!!command.disabled));
      const label = document.createElement("span");
      label.className = "command-result-label";
      label.textContent = command.label;
      const hint = document.createElement("small");
      hint.textContent = command.disabled ? "目前任務完成後可用" : command.hint;
      row.append(label, hint);
      row.addEventListener("click", () => execute(index));
      row.addEventListener("pointermove", () => select(index));
      results.append(row);
    }
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "command-empty";
      empty.textContent = "找不到符合的對話或功能，試試其他關鍵字。";
      results.append(empty);
    }
    if (count) count.textContent = `${matches.length} 個結果`;
    select(
      Math.max(
        0,
        matches.findIndex((command) => !command.disabled),
      ),
    );
    results.scrollTop = 0;
  };
  const open = () => {
    if (dialog.open) {
      dialog.close();
      return;
    }
    previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    search.value = "";
    render();
    dialog.showModal();
    search.focus();
  };
  document.querySelector("#command-open")?.addEventListener("click", open);
  document
    .querySelector("#command-close")
    ?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    const box = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom)
    )
      dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (previousFocus?.isConnected)
      previousFocus.focus({ preventScroll: true });
  });
  search.addEventListener("input", render);
  search.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!matches.length) return;
      let next = selected;
      for (let attempts = 0; attempts < matches.length; attempts++) {
        next =
          (next + (event.key === "ArrowDown" ? 1 : -1) + matches.length) %
          matches.length;
        if (!matches[next]?.disabled) break;
      }
      select(next, true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      execute(selected);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLocaleLowerCase() === "k" &&
      !event.altKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      open();
    }
  });
}
