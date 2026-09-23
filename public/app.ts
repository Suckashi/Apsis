import type {
  Mode,
  SessionView,
  SessionSummary,
  Memory,
  Skill,
  Status,
  WorkspaceFile,
  RunEvent,
} from "../shared/types.ts";
import { asError } from "../shared/errors.ts";
import { createSettingsUI } from "./settings.ts";
import { createTelegramUI } from "./telegram.ts";
import { $ } from "./dom.ts";
import { modeRequirement, preferences } from "./workflow.ts";
import { renderMarkdown } from "./markdown.ts";
import { initCommandPalette, initComposer, initTheme } from "./interaction.ts";
import { initCodeBlocks } from "./code-blocks.ts";
const state: {
  session: SessionView | null;
  sessions: SessionSummary[];
  busy: boolean;
  view: string;
  status: Partial<Status>;
} = {
  session: null,
  sessions: [],
  busy: false,
  view: "chat",
  status: {},
};
const labels: Record<string, string> = {
  demo: "示範模式",
  pi: "Talaria",
  hybrid: "外部 Hermes 協作",
  hermes: "外部 Hermes",
};
let navigating = false;
let activeReply: HTMLElement | undefined;
const traceOpen = new Set<string>();
let currentAction = "";
let connected = false;
let wasConnected = false;
let loginExpired = false;
initTheme();
function updatePresence() {
  const working =
    state.busy ||
    state.session?.running ||
    state.sessions.some((session) => session.running);
  document.body.dataset.botState = !connected
    ? "offline"
    : working
      ? "working"
      : "idle";
  $("#bot-status").textContent = !connected
    ? loginExpired
      ? "登入已過期，請重新登入"
      : wasConnected
        ? "連線中斷，正在重新連接…"
        : "正在連接工作區…"
    : working
      ? (state.busy || state.session?.running ? currentAction : "") ||
        "正在處理任務"
      : state.status.piReady
        ? "待命中 · 隨時可以傳訊息"
        : "連接模型，開始一起工作";
  $("#bot-preview").textContent = !connected
    ? loginExpired
      ? "重新登入後繼續對話"
      : "重新連接中，草稿已保留"
    : working
      ? (state.busy || state.session?.running ? currentAction : "") ||
        "正在處理任務…"
      : state.sessions.find((session) => session.count > 0)?.title ||
        "準備好，隨時聊聊。";
}
function setConnection(value: boolean, expired = false) {
  connected = value;
  wasConnected ||= value;
  loginExpired = expired;
  document.body.dataset.connection = value
    ? "connected"
    : expired
      ? "expired"
      : "offline";
  $("#connection-state").textContent = value
    ? $("#remote-logout").hidden
      ? "本機連線"
      : "遠端連線 · 已登入"
    : expired
      ? "登入已過期"
      : "連線中斷 · 自動重試中";
  const retry = document.querySelector<HTMLButtonElement>("#connection-retry");
  if (retry) {
    retry.hidden = value;
    retry.textContent = expired ? "重新登入" : "重新連線";
  }
  updatePresence();
  syncComposer();
}
const mobileWorkspace = matchMedia("(max-width: 900px)");
function syncOverlays() {
  const sidebarOpen = document.body.classList.contains("sidebar-open");
  const mobileSidebar = matchMedia("(max-width: 680px)").matches;
  const workspaceOpen =
    !$("#workspace-panel").hidden && mobileWorkspace.matches;
  $("#sidebar").inert = workspaceOpen || (mobileSidebar && !sidebarOpen);
  $("main").inert = mobileSidebar && sidebarOpen;
  $(".topbar").inert = workspaceOpen;
  for (const view of document.querySelectorAll<HTMLElement>("main > .view"))
    if (!view.contains($("#workspace-panel"))) view.inert = workspaceOpen;
  $(".conversation").inert = workspaceOpen;
  const backdrop = document.querySelector<HTMLElement>("#workspace-backdrop");
  if (backdrop) backdrop.hidden = !workspaceOpen;
  $("#workspace-panel").toggleAttribute("aria-modal", workspaceOpen);
  if (workspaceOpen) {
    $("#workspace-panel").setAttribute("role", "dialog");
    $("#workspace-panel").setAttribute("aria-modal", "true");
  } else $("#workspace-panel").removeAttribute("role");
}
function setSidebar(open: boolean) {
  if (open) setWorkspace(false);
  document.body.classList.toggle("sidebar-open", open);
  $("#sidebar-backdrop").hidden = !open;
  $("#open-sidebar").setAttribute("aria-expanded", String(open));
  syncOverlays();
  if (open) $("#close-sidebar").focus();
}
$("#open-sidebar").addEventListener("click", () => setSidebar(true));
$("#close-sidebar").addEventListener("click", () => {
  setSidebar(false);
  $("#open-sidebar").focus();
});
$("#sidebar-backdrop").addEventListener("click", () => {
  setSidebar(false);
  $("#open-sidebar").focus();
});
matchMedia("(max-width: 680px)").addEventListener("change", () =>
  setSidebar(false),
);
setSidebar(false);
function setWorkspace(open: boolean) {
  $("#workspace-panel").hidden = !open;
  $("#toggle-workspace").setAttribute("aria-expanded", String(open));
  syncOverlays();
  if (open) $("#close-workspace").focus();
}
$("#toggle-workspace").addEventListener("click", () =>
  setWorkspace(Boolean($("#workspace-panel").hidden)),
);
$("#close-workspace").addEventListener("click", () => {
  setWorkspace(false);
  $("#toggle-workspace").focus();
});
document.querySelector("#workspace-backdrop")?.addEventListener("click", () => {
  setWorkspace(false);
  $("#toggle-workspace").focus();
});
mobileWorkspace.addEventListener("change", syncOverlays);
document.addEventListener("keydown", (event) => {
  if (document.querySelector<HTMLDialogElement>("#command-dialog")?.open)
    return;
  if (event.key === "Escape") {
    if (document.body.classList.contains("sidebar-open")) {
      setSidebar(false);
      $("#open-sidebar").focus();
    } else if (!$("#workspace-panel").hidden) {
      setWorkspace(false);
      $("#toggle-workspace").focus();
    }
    for (const detail of document.querySelectorAll<HTMLDetailsElement>(
      ".action-menu, .task-options",
    ))
      detail.open = false;
  }
  const trap = document.body.classList.contains("sidebar-open")
    ? $("#sidebar")
    : mobileWorkspace.matches && !$("#workspace-panel").hidden
      ? $("#workspace-panel")
      : null;
  if (event.key === "Tab" && trap) {
    const items = [
      ...trap.querySelectorAll<HTMLElement>(
        "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']",
      ),
    ].filter((el) => el.getClientRects().length);
    const first = items[0],
      last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
});
document.addEventListener("click", (event) => {
  for (const detail of document.querySelectorAll<HTMLDetailsElement>(
    ".action-menu, .task-options",
  ))
    if (!detail.contains(event.target as Node)) detail.open = false;
});
$("#allow-writes").addEventListener("change", updatePermissions);
function updatePermissions() {
  $("#permission-hint").textContent = $("#allow-writes").checked
    ? "已允許修改與保存"
    : "僅讀取工作區";
}
let followOutput = true;
let runTimer: ReturnType<typeof setInterval> | undefined;
const welcomeTemplate = $<HTMLTemplateElement>("#welcome-template");
const composer = initComposer($("#prompt"), () =>
  $("#chat-form").requestSubmit(),
);
function draftKey() {
  return "talaria-draft:" + (state.session?.id || "new");
}
function saveDraft() {
  const text = $("#prompt").value;
  const saved = preferences.set(draftKey(), text);
  $("#draft-status").textContent = text
    ? saved
      ? "草稿已保存在此瀏覽器"
      : "草稿暫存不可用，請先複製內容"
    : "";
  composer.resize();
  syncComposer();
}
function restoreDraft() {
  $("#prompt").value = preferences.get(draftKey()) || "";
  saveDraft();
}
function renderWelcome() {
  $("#messages").replaceChildren(welcomeTemplate.content.cloneNode(true));
  $(".onboarding").hidden = !!state.status.piReady;
}
function scrollLatest(force = false) {
  if (followOutput || force)
    $("#messages").scrollTop = $("#messages").scrollHeight;
}
function updateExport() {
  const link = $<HTMLAnchorElement>("#export-session");
  const disabled =
    state.busy || !!state.session?.running || !state.session?.messages.length;
  link.setAttribute("aria-disabled", String(disabled));
  if (disabled) link.removeAttribute("href");
  else link.href = "/api/sessions/" + state.session!.id + "/export";
}
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string) {
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 5000);
}
initCodeBlocks(toast);
async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/" + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Loom-Client": "1",
        ...options.headers,
      },
    });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      setConnection(false);
    throw error;
  }
  if (response.headers.get("X-Talaria-Shared") === "1")
    $("#remote-logout").hidden = false;
  setConnection(
    response.status !== 401 && response.status < 500,
    response.status === 401,
  );
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "請求失敗。");
  return data;
}
const post = <T = unknown>(path: string, data: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data) });
function showView(view: string) {
  if (state.busy && view !== "chat") {
    toast("請先停止或等待目前任務完成。");
    return;
  }
  if (!["chat", "memories", "skills", "settings"].includes(view)) return;
  state.view = view;
  setSidebar(false);
  setWorkspace(false);
  $("#toggle-workspace").hidden = view !== "chat";
  $("#chat-actions").hidden = view !== "chat";
  history.replaceState(null, "", "#" + view);
  document.querySelectorAll<HTMLElement>(".view").forEach((el) => {
    el.hidden = el.id !== view + "-view";
  });
  document
    .querySelectorAll<HTMLElement>(".nav")
    .forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  document
    .querySelectorAll(".nav")
    .forEach((el) =>
      el.setAttribute(
        "aria-current",
        (el as HTMLElement).dataset.view === view ? "page" : "false",
      ),
    );
  $("#page-name").textContent =
    {
      chat: "Talaria",
      memories: "長期記憶",
      skills: "技能庫",
      settings: "Bot 設定",
    }[view as "chat" | "memories" | "skills" | "settings"] ?? "";
  if (view === "chat") composer.resize();
}
document.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLElement>("[data-view]");
  if (button) showView(button.dataset.view || "chat");
});
window.addEventListener("hashchange", () =>
  showView(location.hash.slice(1) || "chat"),
);
$("#toggle-history").addEventListener("click", () => {
  const open = $("#toggle-history").getAttribute("aria-expanded") !== "true";
  $("#toggle-history").setAttribute("aria-expanded", String(open));
  $("#history-panel").classList.toggle("open", open);
});
$("#session-search").addEventListener("input", renderSessions);
let sessionRenderKey = "";
function renderSessions() {
  const query = $<HTMLInputElement>("#session-search")
    .value.trim()
    .toLocaleLowerCase();
  updatePresence();
  const sessions = state.sessions.filter(
    (session) =>
      (session.count > 0 || session.running) &&
      session.title.toLocaleLowerCase().includes(query),
  );
  const key = JSON.stringify([query, state.busy, state.session?.id, sessions]);
  if (key === sessionRenderKey) return;
  sessionRenderKey = key;
  $("#sessions").replaceChildren();
  if (!sessions.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = query
      ? "沒有符合的對話，試試其他關鍵字。"
      : "你的下一個想法，從這裡開始。";
    $("#sessions").append(p);
  }
  for (const item of sessions) {
    const button = document.createElement("button");
    button.className = "session-button";
    button.classList.toggle("selected", item.id === state.session?.id);
    const title = document.createElement("span");
    title.textContent = item.title;
    const meta = document.createElement("small");
    const date = new Date(item.createdAt);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const day =
      date.toDateString() === today.toDateString()
        ? "今天"
        : date.toDateString() === yesterday.toDateString()
          ? "昨天"
          : date.toLocaleDateString("zh-TW", {
              month: "numeric",
              day: "numeric",
            });
    meta.textContent =
      (item.source === "telegram" ? "Telegram · " : "Web · ") +
      (item.running ? "正在處理…" : `${day} · ${item.count} 則訊息`);
    button.append(title, meta);
    button.setAttribute(
      "aria-current",
      item.id === state.session?.id ? "true" : "false",
    );
    button.title = item.title + " · " + labels[item.mode];
    button.disabled = state.busy;
    button.addEventListener("click", () =>
      loadSession(item.id).catch((error: unknown) =>
        toast(asError(error).message),
      ),
    );
    $("#sessions").append(button);
  }
}
const messageSources = new WeakMap<HTMLElement, string>();
function setMessageContent(content: HTMLElement, text: string) {
  messageSources.set(content, text);
  if (content.classList.contains("markdown"))
    content.innerHTML = renderMarkdown(text);
  else content.textContent = text;
}
function addMessage(role: "user" | "assistant", text: string, error = false) {
  const item = document.createElement("article");
  item.className = "message " + role + (error ? " error" : "");
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "你" : "✳";
  const body = document.createElement("div");
  body.className = "message-body";
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent =
    role === "user" ? "你" : labels[state.session?.mode || $("#mode").value];
  const content = document.createElement("div");
  content.className =
    "message-content" + (role === "assistant" ? " markdown" : "");
  setMessageContent(content, text);
  const copy = document.createElement("button");
  copy.className = "copy-message quiet-button";
  copy.textContent = "複製";
  copy.setAttribute(
    "aria-label",
    "複製" + (role === "user" ? "你的訊息" : "Talaria 回覆"),
  );
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(messageSources.get(content) || "");
      toast("已複製訊息。");
    } catch {
      toast("無法存取剪貼簿，請選取訊息文字複製。");
    }
  });
  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.append(copy);
  body.append(label, content, actions);
  item.append(avatar, body);
  $("#messages").append(item);
  if (role === "assistant") activeReply = content;
  return content;
}
function renderConversation() {
  activeReply = undefined;
  if (!state.session) {
    renderWelcome();
    $("#session-title").textContent = "與 Talaria 的新話題";
    $("#background-stop").hidden = true;
    $("#resume-bot").hidden = true;
    updateMode();
    updateExport();
    updatePresence();
    syncComposer();
    return;
  }
  $("#messages").replaceChildren();
  if (!state.session.messages.length) renderWelcome();
  for (const m of state.session.messages) {
    const content = addMessage(
      m.role,
      m.content,
      m.status === "error" || m.status === "failed",
    );
    if (m.role === "assistant") {
      content.dataset.traceKey = m.id;
      for (const text of m.activity || []) addActivity(text, content, false);
      finishTrace(content, m.status === "error" || m.status === "failed");
    }
  }
  if (state.session.running && state.session.live) {
    const content = addMessage(
      "assistant",
      state.session.live.text || "正在處理任務…",
    );
    content.dataset.traceKey = state.session.id + ":live";
    content.dataset.live = "true";
    for (const text of state.session.live.activity)
      addActivity(text, content, true);
  }
  $("#background-stop").hidden = !state.session.running || state.busy;
  $("#resume-bot").hidden = state.session.mode !== "pi";
  $("#session-title").textContent = state.session.title;
  $("#mode").value = state.session.mode;
  updateMode();
  followOutput = true;
  if (state.session.messages.length) scrollLatest(true);
  else $("#messages").scrollTop = 0;
  $("#jump-latest").hidden = true;
  updateExport();
  updatePresence();
  syncComposer();
}
function updateMode() {
  const mode = $("#mode").value as Mode;
  for (const option of $("#mode").options) {
    if (option.value === "hybrid" || option.value === "hermes")
      option.hidden = !state.status.hermesReady && option.value !== mode;
  }
  $("#composer-model").textContent =
    mode === "pi" ? state.status.model || "尚未連接模型" : labels[mode];
  const requirement = modeRequirement(mode, state.status, true);
  $("#mode-setup").hidden = !requirement;
  $("#mode-banner").classList.toggle("needs-setup", Boolean(requirement));
  $("#mode-banner").textContent =
    requirement ||
    (mode === "demo"
      ? "示範模式 · 不會呼叫 AI，也不會消耗 API 額度"
      : mode === "hybrid"
        ? "Pi 主導任務，必要時委派 Hermes；修改與遠端工具需由你開啟。"
        : mode === "hermes"
          ? "Hermes 在 gateway 主機執行，完成後回傳結果。"
          : "Talaria · 自動選用工具與技能，與 bot 共用記憶；預設僅讀取工作區。");
}
async function loadSession(id: string) {
  if (state.busy || navigating) return;
  saveDraft();
  navigating = true;
  try {
    state.session = await api<SessionView>("sessions/" + id);
  } finally {
    navigating = false;
  }
  restoreDraft();
  $("#run-status").textContent = "已載入對話";
  $("#allow-writes").checked = false;
  updatePermissions();
  currentAction = "";
  preferences.set("loom-session", id);
  renderConversation();
  renderSessions();
  showView("chat");
  if (state.session.running) toast("任務正在執行，此頁會自動更新進度。");
}
async function newSession(preserveMode = false) {
  if (state.busy || navigating || document.body.dataset.ready !== "true")
    return;
  saveDraft();
  state.session = null;
  if (!preserveMode) $("#mode").value = state.status.piReady ? "pi" : "demo";
  preferences.remove("loom-session");
  restoreDraft();
  $("#run-status").textContent = "新話題，一樣記得你。";
  $("#allow-writes").checked = false;
  updatePermissions();
  currentAction = "";
  renderConversation();
  renderSessions();
  showView("chat");
  $("#prompt").focus({ preventScroll: true });
}
$("#new-session").addEventListener("click", () =>
  newSession().catch((e: unknown) => toast(asError(e).message)),
);
$("#mode").addEventListener("change", async () => {
  updateMode();
  if (state.session && state.session.mode !== $("#mode").value) {
    try {
      await newSession(true);
      toast("已切換回覆模式，準備好新的話題。");
    } catch (cause) {
      const e = asError(cause);
      toast(e.message);
    }
  }
});
document.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLElement>(
    "[data-prompt]",
  );
  if (!button || state.busy || document.body.dataset.ready !== "true") return;
  $("#prompt").value = button.dataset.prompt || "";
  saveDraft();
  $("#prompt").focus();
});
$("#prompt").addEventListener("input", saveDraft);
$("#messages").addEventListener("scroll", () => {
  const el = $("#messages");
  followOutput = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  $("#jump-latest").hidden = followOutput;
});
$("#jump-latest").addEventListener("click", () => {
  followOutput = true;
  scrollLatest(true);
});
function activityLabel(text: string) {
  const tools: Record<string, string> = {
    list_files: "查看工作區檔案",
    read_file: "讀取檔案",
    write_file: "修改檔案",
    remember: "保存記憶",
    update_memory: "更新記憶",
    save_skill: "保存技能",
    list_skills: "查看技能",
    read_skill: "讀取技能指引",
    search_history: "搜尋過去的對話",
    delegate_to_hermes: "交給外部 Hermes 協作",
  };
  const started = /^執行 (\w+)$/.exec(text);
  if (started && tools[started[1]!]) return "正在" + tools[started[1]!] + "…";
  const finished = /^(\w+) (完成|失敗)$/.exec(text);
  if (finished && tools[finished[1]!])
    return tools[finished[1]!] + " · " + finished[2];
  return text;
}
function addActivity(text: string, content = activeReply, running = true) {
  if (!content) return;
  text = activityLabel(text);
  const body = content.closest(".message-body")!;
  let trace = body.querySelector<HTMLDetailsElement>(".task-trace");
  if (!trace) {
    trace = document.createElement("details");
    trace.className = "task-trace";
    const summary = document.createElement("summary");
    const list = document.createElement("div");
    list.className = "activity-list";
    trace.append(summary, list);
    trace.open = traceOpen.has(content.dataset.traceKey || "");
    trace.addEventListener("toggle", () => {
      const key = content.dataset.traceKey;
      if (key && trace!.isConnected)
        trace!.open ? traceOpen.add(key) : traceOpen.delete(key);
    });
    body.insertBefore(trace, content);
  }
  trace.dataset.running = String(running);
  const p = document.createElement("div");
  p.className = "activity-item";
  p.textContent = text;
  trace.querySelector(".activity-list")!.append(p);
  trace.querySelector("summary")!.textContent = running ? text : "查看工作紀錄";
  if (running) {
    currentAction = text;
    updatePresence();
  }
}
function finishTrace(content: HTMLElement | undefined, failed = false) {
  const trace = content
    ?.closest(".message-body")
    ?.querySelector<HTMLDetailsElement>(".task-trace");
  if (!trace) return;
  trace.dataset.running = "false";
  const records = [...trace.querySelectorAll(".activity-item")];
  const lastAction = records
    .findLast(
      (item) =>
        item.textContent && item.textContent !== "Talaria 正在處理任務。",
    )
    ?.textContent?.replace(/^正在/, "")
    .replace(/…$/, "")
    .replace(/ · 完成$/, "");
  trace.querySelector("summary")!.textContent =
    (failed
      ? "任務未完成"
      : lastAction
        ? "已完成 · " + lastAction
        : "工作完成") +
    " · " +
    records.length +
    " 項紀錄";
}
function syncComposer() {
  const running = state.busy || !!state.session?.running;
  $("#send").disabled =
    !connected ||
    document.body.dataset.ready !== "true" ||
    running ||
    !$("#prompt").value.trim();
  $("#send").title = !connected ? "重新連線後即可傳送" : "傳送訊息";
  $("#messages").setAttribute("aria-busy", String(running));
  $("#send").hidden = running;
  $("#prompt").disabled = running;
  $("#stop").hidden = !state.busy;
  $("#background-stop").hidden = !state.session?.running || state.busy;
  $("#mode").disabled = running;
  $("#new-session").disabled = state.busy;
  $("#allow-writes").disabled = running;
}
function busy(value: boolean) {
  state.busy = value;
  syncComposer();
  updateExport();
  if (!value) currentAction = "";
  updatePresence();
  renderSessions();
}
$("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (
    !connected ||
    state.busy ||
    navigating ||
    document.body.dataset.ready !== "true"
  )
    return;
  if (state.session?.running) {
    toast("此對話仍在執行，請等待完成或先停止。");
    return;
  }
  const prompt = $("#prompt").value.trim();
  if (!prompt) return;
  const requirement = modeRequirement(
    $("#mode").value as Mode,
    state.status,
    $("#allow-writes").checked,
  );
  if (requirement) {
    toast(requirement);
    if (modeRequirement($("#mode").value as Mode, state.status, true))
      showView("settings");
    else {
      $<HTMLDetailsElement>("#task-options").open = true;
      $("#allow-writes").focus();
    }
    return;
  }
  const originalDraft = draftKey();
  let failed = false;
  const started = Date.now();
  $("#run-status").textContent = "正在開始任務…";
  runTimer = setInterval(() => {
    $("#run-status").textContent =
      "執行中 · " + Math.floor((Date.now() - started) / 1000) + " 秒";
  }, 1000);
  let content: HTMLElement | undefined,
    output = "";
  try {
    const allowWrites = $("#allow-writes").checked;
    busy(true);
    if (!state.session) {
      state.session = await post<SessionView>("sessions", {
        mode: $("#mode").value,
      });
      preferences.set("loom-session", state.session.id);
      renderConversation();
    }
    document.querySelector("#messages .welcome")?.remove();
    followOutput = true;
    addMessage("user", prompt);
    content = addMessage("assistant", "正在準備回覆…");
    content.dataset.traceKey = state.session.id + ":live";
    traceOpen.delete(content.dataset.traceKey);
    content.classList.add("waiting");
    scrollLatest(true);
    $("#prompt").value = "";
    preferences.remove(originalDraft);
    saveDraft();
    $("#task-options").removeAttribute("open");
    let response: Response;
    try {
      response = await fetch("/api/sessions/" + state.session.id + "/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
        body: JSON.stringify({ prompt, allowWrites }),
      });
    } catch (error) {
      setConnection(false);
      throw error;
    }
    setConnection(
      response.status !== 401 && response.status < 500,
      response.status === 401,
    );
    if (!response.ok)
      throw new Error((await response.json()).error || "請求失敗。");
    if (!response.body) throw new Error("伺服器沒有回傳串流。");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "",
      completed = false;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const data = JSON.parse(line) as RunEvent;
      if (data.type === "delta") {
        output += data.text;
        if (content) {
          content.classList.remove("waiting");
          setMessageContent(content, output);
        }
      }
      if (data.type === "activity") addActivity(data.text);
      if (data.type === "error") {
        completed = true;
        throw new Error(data.text);
      }
      if (data.type === "done") completed = true;
      scrollLatest();
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consume(line);
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
      if (!completed) throw new Error("連線中斷，請重新開啟此對話確認結果。");
    } finally {
      reader.releaseLock();
    }
  } catch (caught) {
    if (caught instanceof TypeError || !navigator.onLine) setConnection(false);
    failed = true;
    $("#prompt").value = prompt;
    saveDraft();
    const error = asError(caught);
    if (content) {
      setMessageContent(
        content,
        (output ? output + "\n\n" : "") + error.message,
      );
      content.closest(".message")?.classList.add("error");
    }
    toast(error.message);
  } finally {
    clearInterval(runTimer);
    content?.classList.remove("waiting");
    finishTrace(content, failed);
    $("#run-status").textContent =
      (failed
        ? connected
          ? "任務未完成 · 草稿已保留"
          : "連線中斷 · 正在確認任務結果"
        : "任務完成") +
      " · " +
      Math.max(1, Math.floor((Date.now() - started) / 1000)) +
      " 秒";
    try {
      await refresh();
      if (state.session) {
        state.session = await api<SessionView>("sessions/" + state.session.id);
        const savedReply = state.session.messages.findLast(
          (message) => message.role === "assistant",
        );
        if (content && savedReply && !state.session.running) {
          const trace = content
            .closest(".message-body")
            ?.querySelector<HTMLDetailsElement>(".task-trace");
          traceOpen.delete(content.dataset.traceKey || "");
          content.dataset.traceKey = savedReply.id;
          if (trace?.open) traceOpen.add(savedReply.id);
        }
        $("#session-title").textContent = state.session.title;
        if (failed) {
          renderConversation();
          $("#run-status").textContent = state.session.running
            ? "連線已恢復 · 正在同步任務進度"
            : savedReply?.status === "complete"
              ? "連線已恢復 · 回覆已同步"
              : "對話已同步 · 草稿已保留";
        }
        updateExport();
      }
    } catch (cause) {
      const e = asError(cause);
      toast(e.message);
    }
    busy(false);
    if (!composer.mobile.matches) $("#prompt").focus({ preventScroll: true });
  }
});
$("#stop").addEventListener("click", async () => {
  if (!state.session) return;
  try {
    await post("sessions/" + state.session.id + "/stop", {});
    toast("已送出停止要求。");
  } catch (cause) {
    const e = asError(cause);
    toast(e.message);
  }
});
document.addEventListener("keydown", (event) => {
  if (
    !document.querySelector<HTMLDialogElement>("#command-dialog")?.open &&
    event.key.toLowerCase() === "n" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(
      document.activeElement?.tagName || "",
    )
  )
    newSession().catch((e: unknown) => toast(asError(e).message));
});
function renderLibrary(
  name: "memories" | "skills",
  rows: (Memory & { name?: string })[],
) {
  const list = $("#" + name + "-list");
  list.replaceChildren();
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent =
      name === "memories"
        ? "還沒有記憶。先留下你的第一個偏好或專案背景。"
        : "還沒有技能。將一個有效的方法寫成可重用指引。";
    list.append(p);
  }
  for (const row of rows) {
    const article = document.createElement("article");
    article.className = "library-card";
    if (row.name) {
      const h = document.createElement("h2");
      h.textContent = row.name;
      article.append(h);
    }
    const p = document.createElement("p");
    p.textContent = row.content;
    const small = document.createElement("small");
    small.textContent =
      new Date(row.createdAt || Date.now()).toLocaleDateString("zh-TW") +
      " · 儲存在本機";
    const del = document.createElement("button");
    del.className = "delete-button";
    del.textContent = "刪除";
    del.setAttribute("aria-label", "刪除" + (row.name || "記憶"));
    del.addEventListener("click", async () => {
      if (!confirm("確定刪除此" + (name === "skills" ? "技能" : "記憶") + "？"))
        return;
      try {
        await api(name + "/" + row.id, { method: "DELETE" });
        await refresh();
      } catch (cause) {
        const e = asError(cause);
        toast(e.message);
      }
    });
    article.append(p, small, del);
    list.append(article);
  }
}
$("#memory-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await post("memories", { content: $("#memory-content").value });
    $("#memory-form").reset();
    await refresh();
    toast("記憶已儲存，Talaria 下次執行時生效。");
  } catch (cause) {
    const e = asError(cause);
    toast(e.message);
  }
});
$("#skill-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await post("skills", {
      name: $("#skill-name").value,
      content: $("#skill-content").value,
    });
    $("#skill-form").reset();
    await refresh();
    toast("技能已加入。");
  } catch (cause) {
    const e = asError(cause);
    toast(e.message);
  }
});
async function refreshFiles() {
  const files = await api<WorkspaceFile[]>("files");
  $("#files").textContent = files.length
    ? files
        .map((f) => (f.type === "directory" ? "▱ " : "▧ ") + f.name)
        .join("\n")
    : "workspace/ 尚無檔案";
}
async function refresh() {
  const [status, sessions, memories, skills] = await Promise.all([
    api<Status>("status"),
    api<SessionSummary[]>("sessions"),
    api<Memory[]>("memories"),
    api<Skill[]>("skills"),
  ]);
  setConnection(true);
  state.status = status;
  $("#workspace-model").textContent = status.model || "尚未設定模型";
  state.sessions = sessions;
  renderSessions();
  renderLibrary("memories", memories);
  renderLibrary("skills", skills);
  $("#memory-count").textContent = String(memories.length);
  $("#skill-count").textContent = String(skills.length);
  $("#pi-state").textContent = status.piReady ? "已設定" : "未設定";
  $("#pi-state").classList.toggle("ready", status.piReady);
  $("#context-state").textContent =
    memories.length + " 記憶 · " + skills.length + " 技能";
  $("#pi-config").textContent = status.piReady
    ? (status.provider === "ollama" ? "本機模型 · " : "已設定 · ") +
      status.provider +
      " / " +
      status.model
    : "尚未設定模型連線";
  $("#hermes-config").textContent = status.hermesReady
    ? "已設定 gateway · 實際連線於執行時確認"
    : "選用功能 · 尚未連接 gateway";
  updateMode();
  if (!document.querySelector("#messages .message")) renderWelcome();
  await refreshFiles();
}
$("#refresh-files").addEventListener("click", () =>
  refreshFiles().catch((e: unknown) => toast(asError(e).message)),
);
const settingsUI = createSettingsUI({ api, onSaved: refresh, notify: toast });
const telegramUI = createTelegramUI(api, toast);
$("#background-stop").addEventListener("click", async () => {
  if (!state.session) return;
  try {
    await post("sessions/" + state.session.id + "/stop", {});
    toast("已送出停止要求。");
  } catch (error) {
    toast(asError(error).message);
  }
});
$("#resume-bot").addEventListener("click", async () => {
  if (!state.session) return;
  try {
    await navigator.clipboard.writeText("/resume " + state.session.id);
    toast("已複製續聊指令，請私訊已配對的 Telegram Bot。");
  } catch {
    toast("無法存取剪貼簿。");
  }
});
let polling = false;
let initializing = false;
let restoredInitialView = false;
async function poll() {
  if (polling || document.hidden || state.busy || navigating) return;
  polling = true;
  try {
    if (document.body.dataset.ready !== "true") {
      await initialize();
      return;
    }
    const recovering = !connected;
    const sessions = await api<SessionSummary[]>("sessions", {
      signal: AbortSignal.timeout(10000),
    });
    if (state.busy || navigating) return;
    state.sessions = sessions;
    renderSessions();
    const id = state.session?.id;
    const summary = sessions.find((s) => s.id === id);
    if (
      id &&
      summary &&
      (summary.running ||
        recovering ||
        state.session?.running ||
        summary.count !== state.session?.messages.length)
    ) {
      const current = await api<SessionView>("sessions/" + id, {
        signal: AbortSignal.timeout(10000),
      });
      if (state.busy || navigating || state.session?.id !== id) return;
      const position = $("#messages").scrollTop;
      const follow = followOutput;
      const previous = state.session;
      const liveContent = document.querySelector<HTMLElement>(
        '.message-content[data-live="true"]',
      );
      state.session = current;
      if (
        previous?.running &&
        current.running &&
        liveContent &&
        current.live &&
        JSON.stringify(previous.messages) ===
          JSON.stringify(current.messages) &&
        current.live.activity.length >= (previous.live?.activity.length || 0)
      ) {
        if (previous.live?.text !== current.live.text)
          setMessageContent(liveContent, current.live.text || "正在處理任務…");
        for (const text of current.live.activity.slice(
          previous.live?.activity.length || 0,
        ))
          addActivity(text, liveContent);
        scrollLatest();
        updatePresence();
      } else {
        if (!current.running && traceOpen.has(id + ":live")) {
          const latest = current.messages.findLast(
            (message) => message.role === "assistant",
          );
          if (latest) traceOpen.add(latest.id);
          traceOpen.delete(id + ":live");
        }
        if (!current.running) currentAction = "";
        renderConversation();
      }
      followOutput = follow;
      if (!follow) $("#messages").scrollTop = position;
      $("#jump-latest").hidden = follow;
      $("#run-status").textContent = current.running
        ? "任務執行中 · 自動更新"
        : "對話已同步";
    }
  } catch {
    setConnection(false, loginExpired);
  } finally {
    polling = false;
  }
}
setInterval(() => void poll(), 2000);
window.addEventListener("offline", () => setConnection(false));
window.addEventListener("online", () => void poll());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void poll();
});
document.querySelector("#connection-retry")?.addEventListener("click", () => {
  saveDraft();
  if (loginExpired) location.assign("/__share/login");
  else void poll();
});
initCommandPalette(
  () => {
    const locked =
      state.busy || navigating || document.body.dataset.ready !== "true";
    return [
      {
        id: "new",
        label: "開啟新話題",
        hint: "相同的 Talaria，新的開始",
        group: "快速前往",
        keywords: "new chat topic",
        disabled: locked,
        run: () => newSession(),
      },
      {
        id: "chat",
        label: "回到對話",
        hint: "與 Talaria 繼續聊聊",
        group: "快速前往",
        keywords: "chat home",
        run: () => {
          showView("chat");
          $("#prompt").focus();
        },
      },
      {
        id: "workspace",
        label: "查看工作區",
        hint: "檔案、記憶與目前模型",
        group: "快速前往",
        keywords: "workspace files",
        run: () => {
          showView("chat");
          setWorkspace(true);
        },
      },
      ...[
        ["memories", "長期記憶", "管理 Talaria 記得的事", "memory"],
        ["skills", "技能庫", "保存與整理可重用的方法", "skills"],
        [
          "settings",
          "Bot 設定",
          "模型連線、Telegram 與進階選項",
          "settings model telegram",
        ],
      ].map(([id, label, hint, keywords]) => ({
        id: id!,
        label: label!,
        hint: hint!,
        keywords,
        group: "快速前往",
        disabled: locked,
        run: () => showView(id!),
      })),
      ...state.sessions
        .filter((session) => session.count > 0 || session.running)
        .map((session) => ({
          id: session.id,
          label: session.title,
          hint: `${session.source === "telegram" ? "Telegram" : "Web"} · ${session.running ? "執行中" : session.count + " 則訊息"}`,
          group: "最近的對話",
          keywords: "history 對話 歷史",
          disabled: locked,
          run: () => loadSession(session.id),
        })),
    ];
  },
  (error) => toast(asError(error).message),
);
async function initialize() {
  if (initializing) return;
  initializing = true;
  try {
    await refresh();
    await settingsUI.load();
    await telegramUI.load();
    const initialView = location.hash.slice(1);
    if (!restoredInitialView) {
      restoreDraft();
      const id = preferences.get("loom-session");
      if (id && state.sessions.some((s) => s.id === id)) await loadSession(id);
      else if (state.status.piReady) {
        $("#mode").value = "pi";
        updateMode();
      }
      showView(initialView || "chat");
      restoredInitialView = true;
    }
    document.body.dataset.ready = "true";
    busy(false);
  } catch (cause) {
    const e = asError(cause);
    setConnection(false, loginExpired);
    $("#run-status").textContent = "正在重新連接工作區，草稿會保留";
    if (!wasConnected) $("#connection-state").title = e.message;
  } finally {
    initializing = false;
  }
}
await initialize();
