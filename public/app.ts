import { createManagement, knowledgeActions } from "./management.ts";
import type {
  Mode,
  SessionView,
  SessionSummary,
  Memory,
  Skill,
  Status,
  WorkspaceFile,
  TaskRun,
  ModelConnection,
} from "../shared/types.ts";
import { asError } from "../shared/errors.ts";
import { createTelegramUI } from "./telegram.ts";
import { $ } from "./dom.ts";
import { modeRequirement, preferences } from "./workflow.ts";
import { renderMarkdown } from "./markdown.ts";
import { initCommandPalette, initComposer, initTheme } from "./interaction.ts";
import { initCodeBlocks } from "./code-blocks.ts";
import { createAgentsUI } from "./agents.ts";
import { connectionModels, providerName } from "./provider-catalog.ts";
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
  pi: "Apsis",
};
let replyMode: Mode = "pi";
let navigating = false;
let agentFilter: string | undefined;
let activeReply: HTMLElement | undefined;
const traceOpen = new Set<string>();
let currentAction = "";
let connected = false;
let wasConnected = false;
let loginExpired = false;
let modelConnections: ModelConnection[] = [];
let defaultModel: { connectionId: string; model: string } | null = null;
const choiceValue = (connectionId: string, model: string) =>
  JSON.stringify([connectionId, model]);
function currentModelChoice(): { connectionId: string; model: string } | null {
  try {
    const [connectionId, model] = JSON.parse(
      $<HTMLSelectElement>("#chat-model").value,
    );
    return typeof connectionId === "string" && typeof model === "string"
      ? { connectionId, model }
      : null;
  } catch {
    return null;
  }
}
function selectedConnection() {
  const choice = currentModelChoice();
  return (
    choice && modelConnections.find((row) => row.id === choice.connectionId)
  );
}
function connectionReady(row: ModelConnection | null | undefined) {
  return (
    !!row &&
    (row.provider === "ollama" ||
      (row.provider === "openai-compatible" && !!row.url) ||
      row.credentialConfigured)
  );
}
async function loadModelChoices(preferDefault = false) {
  const [rows, savedDefault] = await Promise.all([
    api<ModelConnection[]>("connections"),
    api<{ connectionId: string; model: string } | null>("connections/default"),
  ]);
  modelConnections = rows;
  defaultModel = savedDefault;
  const select = $<HTMLSelectElement>("#chat-model");
  const previous = select.value;
  select.replaceChildren();
  for (const row of rows) {
    const group = document.createElement("optgroup");
    group.label = row.name + " · " + providerName(row);
    for (const model of connectionModels(row)) {
      const option = new Option(
        row.name + " · " + model + (connectionReady(row) ? "" : "（待設定）"),
        choiceValue(row.id, model),
      );
      option.disabled = !connectionReady(row);
      group.append(option);
    }
    select.append(group);
  }
  if (!select.options.length) select.append(new Option("先加入模型服務", ""));
  const sessionChoice =
    state.session?.connectionId && state.session.model
      ? choiceValue(state.session.connectionId, state.session.model)
      : undefined;
  const savedValue = savedDefault
    ? choiceValue(savedDefault.connectionId, savedDefault.model)
    : "";
  const preferred =
    sessionChoice ||
    (preferDefault ? savedValue || previous : previous || savedValue);
  select.value = Array.from(select.options).some(
    (option) => option.value === preferred,
  )
    ? preferred
    : savedDefault
      ? choiceValue(savedDefault.connectionId, savedDefault.model)
      : select.options[0]?.value || "";
  if (select.selectedIndex < 0) select.selectedIndex = 0;
  updateMode();
}
const observedMessageTimes = new Map<string, string>();
function validTimestamp(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}
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
      : "";
  $("#bot-status").hidden = !$("#bot-status").textContent;
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
function setWorkspace(open: boolean, focus = true) {
  if (open) void refreshFiles().catch((error) => toast(asError(error).message));
  $("#workspace-panel").hidden = !open;
  $("#toggle-workspace").setAttribute("aria-expanded", String(open));
  syncOverlays();
  if (open && focus) $("#close-workspace").focus();
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
$("#allow-writes").addEventListener("change", () => {
  if (!$("#allow-writes").checked) $("#allow-shell").checked = false;
  updatePermissions();
});
$("#allow-shell").addEventListener("change", () => {
  if ($("#allow-shell").checked) $("#allow-writes").checked = true;
  updatePermissions();
});
$("#allow-memory").addEventListener("change", updatePermissions);
$("#allow-skills").addEventListener("change", updatePermissions);
function updatePermissions() {
  const allowed = [
    [$("#allow-writes").checked, "檔案"],
    [$("#allow-memory").checked, "記憶"],
    [$("#allow-skills").checked, "技能"],
    [$("#allow-shell").checked, "主機命令"],
  ]
    .filter(([checked]) => checked)
    .map(([, name]) => name);
  $("#permission-hint").textContent = allowed.length
    ? "允許寫入：" + allowed.join("、")
    : "僅讀取 · 寫入權限皆關閉";
}
let followOutput = true;
const welcomeTemplate = $<HTMLTemplateElement>("#welcome-template");
const composer = initComposer($("#prompt"), () =>
  $("#chat-form").requestSubmit(),
);
function draftKey() {
  // Retain the existing key so Apsis can restore pre-rename drafts.
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
  const agent = state.session?.agent || agentsUI.selected();
  $(".onboarding").hidden = agent
    ? !agentsUI.requirement(agent)
    : connectionReady(selectedConnection());
  if (agent) $("[data-welcome-title]").textContent = "交辦任務給 " + agent.name;
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
  if (!response.ok)
    throw Object.assign(new Error(data.error || "請求失敗。"), {
      status: response.status,
    });
  return data;
}
const post = <T = unknown>(path: string, data: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data) });
const settingsViews = [
  "connections",
  "agents",
  "memories",
  "skills",
  "settings",
] as const;
const settingsDialog = $<HTMLDialogElement>("#settings-dialog");
const settingsPanels = $("#settings-panels");
const settingsTabs = $(".settings-tabs");
const compactSettings = matchMedia("(max-width: 780px)");
function syncSettingsOrientation() {
  settingsTabs.setAttribute(
    "aria-orientation",
    compactSettings.matches ? "horizontal" : "vertical",
  );
}
compactSettings.addEventListener("change", syncSettingsOrientation);
syncSettingsOrientation();
const settingsTitles: Record<string, string> = {
  connections: "模型連線",
  agents: "我的 Agents",
  memories: "記憶",
  skills: "技能",
  settings: "Telegram",
};
let mainView: "chat" | "runs" = "chat";
let settingsOpener: HTMLElement | null = null;
for (const view of settingsViews) {
  const panel = $("#" + view + "-view");
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", "settings-tab-" + view);
  settingsPanels.append(panel);
}
function showView(view: string) {
  if (
    ![
      "chat",
      "memories",
      "skills",
      "settings",
      "agents",
      "runs",
      "connections",
    ].includes(view)
  )
    return;
  const isSettings = settingsViews.includes(
    view as (typeof settingsViews)[number],
  );
  const previousView = state.view;
  if (!isSettings) mainView = view as "chat" | "runs";
  if (isSettings && !settingsDialog.open) {
    settingsOpener =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : $("#open-settings");
  }
  state.view = view;
  setSidebar(false);
  setWorkspace(false);
  $("#toggle-workspace").hidden = mainView !== "chat";
  $("#chat-actions").hidden = mainView !== "chat";
  history.replaceState(null, "", "#" + view);
  document.querySelectorAll<HTMLElement>("main > .view").forEach((el) => {
    el.hidden = el.id !== mainView + "-view";
  });
  for (const panelView of settingsViews) {
    const panel = $("#" + panelView + "-view");
    panel.hidden = panelView !== view;
  }
  document
    .querySelectorAll<HTMLButtonElement>("[data-settings-tab]")
    .forEach((tab) => {
      const selected = tab.dataset.settingsTab === view;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
  $("#open-settings").setAttribute("aria-expanded", String(isSettings));
  $("#open-settings").classList.toggle("active", isSettings);
  document
    .querySelectorAll<HTMLElement>(".nav")
    .forEach((el) =>
      el.classList.toggle("active", el.dataset.view === mainView),
    );
  document
    .querySelectorAll(".nav")
    .forEach((el) =>
      el.setAttribute(
        "aria-current",
        (el as HTMLElement).dataset.view === mainView ? "page" : "false",
      ),
    );
  $("#page-name").textContent = {
    chat: "Apsis",
    runs: "任務紀錄",
  }[mainView];
  if (isSettings) {
    $("#settings-title").textContent = settingsTitles[view];
    if (!settingsDialog.open) {
      settingsDialog.showModal();
      settingsDialog.append($("#toast"));
      $<HTMLButtonElement>("#settings-tab-" + view).focus();
    }
    if (previousView !== view) settingsPanels.scrollTop = 0;
  } else if (settingsDialog.open) settingsDialog.close();
  if (view === "agents")
    void agentsUI
      .load(state.session?.agent)
      .catch((e) => toast(asError(e).message));
  if (view === "connections")
    void management.loadConnections().catch((e) => toast(asError(e).message));
  if (view === "runs")
    void management.loadRuns().catch((e) => toast(asError(e).message));
  if (view === "memories" || view === "skills")
    void refreshKnowledge().catch((e) => toast(asError(e).message));
  if (view === "chat") {
    composer.resize();
    updateMode();
  }
}
$("#settings-close").addEventListener("click", () => settingsDialog.close());
settingsDialog.addEventListener("click", (event) => {
  const box = settingsDialog.getBoundingClientRect();
  if (
    event.target === settingsDialog &&
    (event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom)
  )
    settingsDialog.close();
});
settingsDialog.addEventListener("close", () => {
  if (settingsDialog.open) return;
  document.body.append($("#toast"));
  if (!settingsViews.includes(state.view as (typeof settingsViews)[number])) {
    settingsOpener = null;
    return;
  }
  showView(mainView);
  const focusTarget =
    settingsOpener?.isConnected &&
    settingsOpener.getClientRects().length &&
    !settingsOpener.closest("[inert]")
      ? settingsOpener
      : $("#open-settings");
  focusTarget.focus({ preventScroll: true });
  settingsOpener = null;
});
$(".settings-tabs").addEventListener("keydown", (event: KeyboardEvent) => {
  if (
    ![
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
    ].includes(event.key)
  )
    return;
  const tabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-settings-tab]"),
  );
  const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (current < 0) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current +
            (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) +
            tabs.length) %
          tabs.length;
  showView(tabs[next]!.dataset.settingsTab!);
  if (state.view === tabs[next]!.dataset.settingsTab) tabs[next]!.focus();
});
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
$("#agent-roster").addEventListener("click", async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(
    "[data-agent-id]",
  );
  if (!button || state.busy) return;
  agentFilter =
    button.dataset.agentId === "all" ? undefined : button.dataset.agentId;
  document
    .querySelectorAll("#agent-roster button")
    .forEach((node) =>
      node.setAttribute("aria-pressed", String(node === button)),
    );
  renderSessions();
  if (agentFilter !== undefined) {
    const existing = state.sessions.find(
      (session) => (session.agent?.id || "") === agentFilter,
    );
    try {
      if (existing) await loadSession(existing.id);
      else {
        await newSession();
        agentsUI.selectById(agentFilter);
        if (agentFilter) replyMode = "pi";
        updateMode();
        renderWelcome();
      }
    } catch (e) {
      toast(asError(e).message);
    }
  }
});
let sessionRenderKey = "";
function renderSessions() {
  const query = $<HTMLInputElement>("#session-search")
    .value.trim()
    .toLocaleLowerCase();
  updatePresence();
  const sessions = state.sessions.filter(
    (session) =>
      (agentFilter === undefined ||
        (session.agent?.id || "") === agentFilter) &&
      (session.count > 0 || session.running) &&
      session.title.toLocaleLowerCase().includes(query),
  );
  const key = JSON.stringify([
    query,
    agentFilter,
    state.busy,
    state.session?.id,
    sessions,
  ]);
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
    button.title = item.title + " · " + (item.agent?.name || labels[item.mode]);
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
function setMessageTime(content: HTMLElement, timestamp: string) {
  const valid = validTimestamp(timestamp);
  const actions = content
    .closest(".message-body")
    ?.querySelector(".message-actions");
  if (!valid || !actions) return;
  let time = actions.querySelector<HTMLTimeElement>(".message-time");
  if (!time) {
    time = document.createElement("time");
    time.className = "message-time";
    actions.prepend(time);
  }
  const date = new Date(valid);
  time.dateTime = valid;
  time.textContent = date.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  time.title = date.toLocaleString("zh-TW");
}
function addMessage(
  role: "user" | "assistant",
  text: string,
  error = false,
  timestamp?: string,
) {
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
    role === "user"
      ? "你"
      : state.session?.agent?.name ||
        agentsUI.selected()?.name ||
        labels[state.session?.mode || replyMode];
  const content = document.createElement("div");
  content.className =
    "message-content" + (role === "assistant" ? " markdown" : "");
  setMessageContent(content, text);
  const copy = document.createElement("button");
  copy.className = "copy-message quiet-button";
  copy.textContent = "複製";
  copy.setAttribute(
    "aria-label",
    "複製" + (role === "user" ? "你的訊息" : label.textContent + " 回覆"),
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
  if (timestamp) setMessageTime(content, timestamp);
  if (role === "assistant") activeReply = content;
  return content;
}
function renderConversation() {
  activeReply = undefined;
  if (!state.session) {
    renderWelcome();
    $("#session-title").textContent = "與 Apsis 的新話題";
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
      observedMessageTimes.get(m.id) ||
        validTimestamp("createdAt" in m ? m.createdAt : undefined),
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
  $("#resume-bot").hidden = state.session.mode !== "pi";
  $("#session-title").textContent = state.session.title;
  replyMode = state.session.mode;
  agentsUI.select(state.session.agent);
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
  const mode = replyMode as Mode;
  const agent = state.session?.agent || agentsUI.selected();
  const choice =
    state.session?.connectionId && state.session.model
      ? { connectionId: state.session.connectionId, model: state.session.model }
      : currentModelChoice();
  const name = agent?.name || "Apsis";
  if (state.view === "chat") $("#page-name").textContent = name;
  $("#prompt").setAttribute("aria-label", "傳訊息給 " + name);
  $("#prompt").placeholder = "傳訊息給 " + name;
  $("#messages").setAttribute("aria-label", "與 " + name + " 的訊息");
  $("#chat-model-field").hidden = !!agent || mode !== "pi";
  $("#agent-model-label").hidden = !agent;
  $("#agent-model-label").textContent = agent?.model || "";
  const requirement =
    agent && mode === "pi"
      ? agentsUI.requirement(agent)
      : mode === "pi" && choice
        ? connectionReady(
            modelConnections.find((row) => row.id === choice.connectionId),
          )
          ? null
          : "這個模型服務還缺少 API key，請先完成連線設定。"
        : modeRequirement(mode, state.status);
  $("#permission-hint").title = requirement || "";
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
  await loadModelChoices(true);
  restoreDraft();
  $("#run-status").textContent = state.session?.running ? "任務執行中" : "";
  $("#allow-writes").checked = false;
  $("#allow-memory").checked = false;
  $("#allow-skills").checked = false;
  $("#allow-shell").checked = false;
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
  if (!preserveMode) replyMode = "pi";
  if (!preserveMode) agentsUI.select();
  if (!preserveMode && defaultModel)
    $<HTMLSelectElement>("#chat-model").value = choiceValue(
      defaultModel.connectionId,
      defaultModel.model,
    );
  preferences.remove("loom-session");
  restoreDraft();
  $("#run-status").textContent = "";
  $("#allow-writes").checked = false;
  $("#allow-memory").checked = false;
  $("#allow-skills").checked = false;
  $("#allow-shell").checked = false;
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
    edit_file: "精準修改檔案",
    shell: "執行命令",
    remember: "保存記憶",
    update_memory: "更新記憶",
    save_skill: "保存技能",
    list_skills: "查看技能",
    read_skill: "讀取技能指引",
    search_history: "搜尋過去的對話",
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
      (item) => item.textContent && item.textContent !== "Apsis 正在處理任務。",
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
  $("#stop").hidden = !state.session?.running;
  $<HTMLSelectElement>("#chat-model").disabled =
    running || !!(state.session?.agent || agentsUI.selected());
  $("#new-session").disabled = state.busy;
  $("#allow-writes").disabled = running;
  $("#allow-memory").disabled = running;
  $("#allow-skills").disabled = running;
  $("#allow-shell").disabled = running;
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
  const chosenAgent = state.session?.agent || agentsUI.selected();
  const modelChoice =
    state.session?.connectionId && state.session.model
      ? { connectionId: state.session.connectionId, model: state.session.model }
      : currentModelChoice();
  const requirement =
    chosenAgent && replyMode === "pi"
      ? agentsUI.requirement(chosenAgent)
      : replyMode === "pi" && modelChoice
        ? connectionReady(
            modelConnections.find((row) => row.id === modelChoice.connectionId),
          )
          ? null
          : "這個模型服務還缺少 API key，請先完成連線設定。"
        : modeRequirement(replyMode as Mode, state.status);
  if (requirement) {
    toast(requirement);
    showView("connections");
    return;
  }
  const originalDraft = draftKey();
  let submitted = false;
  let accepted = false;
  busy(true);
  $("#run-status").textContent = "正在送出…";
  try {
    const permissions = {
      files: $("#allow-writes").checked,
      memory: $("#allow-memory").checked,
      skills: $("#allow-skills").checked,
      shell: $("#allow-shell").checked,
    };
    if (!state.session) {
      state.session = await post<SessionView>("sessions", {
        mode: replyMode,
        agentId: replyMode === "pi" ? chosenAgent?.id : undefined,
        ...(replyMode === "pi" && !chosenAgent && modelChoice
          ? modelChoice
          : {}),
      });
      preferences.set("loom-session", state.session.id);
    }
    const id = state.session.id;
    submitted = true;
    const run = await post<TaskRun>("sessions/" + id + "/runs", {
      prompt,
      permissions,
    });
    // Release the composer only after the server owns this task. Navigation does
    // not cancel it; poll() tracks whichever conversation is currently selected.
    accepted = true;
    state.session.running = run.status === "running";
    $("#prompt").value = "";
    preferences.remove(originalDraft);
    saveDraft();
    $("#task-options").removeAttribute("open");
    state.session = await api<SessionView>("sessions/" + id);
    const sentMessage = state.session.messages.findLast(
      (message) => message.role === "user",
    );
    if (sentMessage) observedMessageTimes.set(sentMessage.id, run.createdAt);
    renderConversation();
    $("#run-status").textContent = state.session.running ? "任務執行中" : "";
    state.sessions = await api<SessionSummary[]>("sessions");
  } catch (caught) {
    const error = asError(caught);
    if (!accepted && error.status && error.status < 500) submitted = false;
    if (!submitted) {
      $("#prompt").value = prompt;
      saveDraft();
    }
    $("#run-status").textContent = submitted
      ? "請至任務紀錄確認結果"
      : "送出失敗 · 草稿已保留";
    toast(
      error.message +
        (submitted ? " 請先到任務紀錄確認結果，避免重複送出。" : ""),
    );
  } finally {
    busy(false);
    void poll();
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
    !settingsDialog.open &&
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
      " · " +
      (row.agentId ? "Agent 專屬 · " + row.agentId.slice(0, 8) : "共用") +
      (row.mergedInto ? " · 已合併" : row.enabled === false ? " · 已停用" : "");
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
    knowledgeActions(
      article,
      row,
      rows,
      name,
      api,
      refresh,
      toast,
      loadSession,
    );
    list.append(article);
  }
}
$("#memory-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await post("memories", { content: $("#memory-content").value });
    $("#memory-form").reset();
    await refresh();
    toast("記憶已儲存，Apsis 下次執行時生效。");
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
async function refreshKnowledge() {
  const [memories, skills] = await Promise.all([
    api<Memory[]>("memories"),
    api<Skill[]>("skills"),
  ]);
  for (const [name, rows] of [
    ["memories", memories],
    ["skills", skills],
  ] as const) {
    if (
      !document.querySelector(`#${name}-view .knowledge-editor:not([hidden])`)
    )
      renderLibrary(name, rows);
  }
  $("#memory-count").textContent = String(memories.length);
  $("#skill-count").textContent = String(skills.length);
}
async function refresh(preferDefault = false) {
  await agentsUI.load(state.session?.agent);
  const [status, sessions, memories, skills] = await Promise.all([
    api<Status>("status"),
    api<SessionSummary[]>("sessions"),
    api<Memory[]>("memories"),
    api<Skill[]>("skills"),
  ]);
  setConnection(true);
  state.status = status;
  await loadModelChoices(preferDefault || !restoredInitialView);
  state.sessions = sessions;
  renderSessions();
  renderLibrary("memories", memories);
  renderLibrary("skills", skills);
  $("#memory-count").textContent = String(memories.length);
  $("#skill-count").textContent = String(skills.length);
  updateMode();
  if (!document.querySelector("#messages .message")) renderWelcome();
  await refreshFiles();
}
$("#refresh-files").addEventListener("click", () =>
  refreshFiles().catch((e: unknown) => toast(asError(e).message)),
);
const management = createManagement(api, toast, loadSession, async () => {
  await refresh(true);
});
const agentsUI = createAgentsUI(api, toast, async (agent) => {
  if (state.busy) {
    toast("請先停止或等待任務完成。");
    return;
  }
  await newSession(true);
  agentsUI.select(agent);
  replyMode = "pi";
  renderWelcome();
  updateMode();
  $("#session-title").textContent = agent?.name || "Apsis";
  $("#prompt").focus();
});
$<HTMLSelectElement>("#chat-model").addEventListener("change", async () => {
  const selected = $<HTMLSelectElement>("#chat-model").value;
  if (state.session) {
    await newSession(true);
    $<HTMLSelectElement>("#chat-model").value = selected;
    toast("已選擇模型，新對話會使用這個模型。");
  }
  replyMode = "pi";
  updateMode();
});
const telegramUI = createTelegramUI(api, toast);
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
      for (const message of current.messages) {
        if (!previous?.messages.some((saved) => saved.id === message.id))
          observedMessageTimes.set(message.id, new Date().toISOString());
      }
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
        : "";
    }
  } catch {
    setConnection(false, loginExpired);
  } finally {
    polling = false;
  }
}
setInterval(() => void poll(), 700);
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
        hint: "相同的 Apsis，新的開始",
        group: "快速前往",
        keywords: "new chat topic",
        disabled: locked,
        run: () => newSession(),
      },
      {
        id: "chat",
        label: "回到對話",
        hint: "與 Apsis 繼續聊聊",
        group: "快速前往",
        keywords: "chat home",
        run: () => {
          showView("chat");
          $("#prompt").focus();
        },
      },
      {
        id: "workspace",
        label: "查看檔案",
        hint: "工作區檔案",
        group: "快速前往",
        keywords: "workspace files",
        run: () => {
          showView("chat");
          setWorkspace(true);
        },
      },
      ...[
        ["agents", "我的 Agents", "角色、工具與記憶範圍", "agents"],
        ["connections", "模型連線", "管理端點與測試模型", "connections models"],
        ["runs", "任務紀錄", "背景工作與操作結果", "runs tasks"],
        ["memories", "長期記憶", "管理 Apsis 記得的事", "memory"],
        ["skills", "技能庫", "保存與整理可重用的方法", "skills"],
        [
          "settings",
          "Telegram",
          "連接 Bot 與配對帳號",
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
    await telegramUI.load();
    const initialView = location.hash.slice(1);
    if (!restoredInitialView) {
      restoreDraft();
      const id = preferences.get("loom-session");
      if (id && state.sessions.some((s) => s.id === id)) await loadSession(id);
      else if (state.status.piReady) {
        replyMode = "pi";
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
