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
import { $ } from "./dom.ts";
import { modeRequirement, preferences } from "./workflow.ts";
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
  pi: "Pi Agent",
  hybrid: "Pi × Hermes",
  hermes: "Hermes",
};
let navigating = false;
let followOutput = true;
let runTimer: ReturnType<typeof setInterval> | undefined;
const welcomeTemplate = $<HTMLTemplateElement>("#welcome-template");
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
  $<HTMLButtonElement>("#send").disabled = state.busy || !text.trim();
}
function restoreDraft() {
  $("#prompt").value = preferences.get(draftKey()) || "";
  saveDraft();
}
function renderWelcome() {
  $("#messages").replaceChildren(welcomeTemplate.content.cloneNode(true));
  if (state.status.piReady) {
    $("[data-setup-title]").textContent = "模型已設定，開始你的第一個任務";
    $("[data-setup-description]").textContent =
      "在輸入框下方選擇 Pi Agent，即可使用真實模型。";
  }
}
function scrollLatest(force = false) {
  if (followOutput || force)
    $("#messages").scrollTop = $("#messages").scrollHeight;
}
function updateExport() {
  const link = $<HTMLAnchorElement>("#export-session");
  const disabled = state.busy || !state.session?.messages.length;
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
async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api/" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Loom-Client": "1",
      ...options.headers,
    },
  });
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
  $("#history-panel").classList.remove("open");
  $("#toggle-history").setAttribute("aria-expanded", "false");
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
      chat: "工作台",
      memories: "長期記憶",
      skills: "技能庫",
      settings: "連線設定",
    }[view as "chat" | "memories" | "skills" | "settings"] ?? "";
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
function renderSessions() {
  $("#sessions").replaceChildren();
  const query = $<HTMLInputElement>("#session-search")
    .value.trim()
    .toLocaleLowerCase();
  const sessions = state.sessions.filter((session) =>
    session.title.toLocaleLowerCase().includes(query),
  );
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
    meta.textContent =
      labels[item.mode] +
      " · " +
      (item.running ? "執行中" : item.count + " 則訊息");
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
function addMessage(role: "user" | "assistant", text: string, error = false) {
  const item = document.createElement("article");
  item.className = "message " + role + (error ? " error" : "");
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "你" : "⌘";
  const body = document.createElement("div");
  body.className = "message-body";
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent =
    role === "user" ? "你" : labels[state.session?.mode || $("#mode").value];
  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = text;
  const copy = document.createElement("button");
  copy.className = "copy-message quiet-button";
  copy.textContent = "複製";
  copy.setAttribute(
    "aria-label",
    "複製" + (role === "user" ? "你的訊息" : "Agent 回覆"),
  );
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(content.textContent || "");
      toast("已複製訊息。");
    } catch {
      toast("無法存取剪貼簿，請選取訊息文字複製。");
    }
  });
  label.append(copy);
  body.append(label, content);
  item.append(avatar, body);
  $("#messages").append(item);
  return content;
}
function renderConversation() {
  if (!state.session) return;
  $("#messages").replaceChildren();
  $("#activity").replaceChildren();
  if (!state.session.messages.length) renderWelcome();
  for (const m of state.session.messages) {
    addMessage(
      m.role,
      m.content,
      m.status === "error" || m.status === "failed",
    );
    for (const text of m.activity || []) addActivity(text);
  }
  $("#session-title").textContent = state.session.title;
  $("#mode").value = state.session.mode;
  updateMode();
  followOutput = true;
  if (state.session.messages.length) scrollLatest(true);
  else $("#messages").scrollTop = 0;
  $("#jump-latest").hidden = true;
  updateExport();
}
function updateMode() {
  const mode = $("#mode").value as Mode;
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
          : "Pi 使用真實模型與本機工具；預設僅讀取工作區。");
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
  preferences.set("loom-session", id);
  renderConversation();
  renderSessions();
  showView("chat");
  if (state.session.running)
    toast("此工作階段正在其他分頁執行，稍後重新開啟可查看結果。");
}
async function newSession() {
  if (state.busy || navigating) return;
  saveDraft();
  navigating = true;
  try {
    state.session = await post<SessionView>("sessions", {
      mode: $("#mode").value,
    });
    restoreDraft();
    $("#run-status").textContent = "準備就緒";
    preferences.set("loom-session", state.session.id);
    $("#allow-writes").checked = false;
    renderConversation();
    showView("chat");
    state.sessions = await api<SessionSummary[]>("sessions");
    renderSessions();
    $("#prompt").focus({ preventScroll: true });
  } finally {
    navigating = false;
  }
}
$("#new-session").addEventListener("click", () =>
  newSession().catch((e: unknown) => toast(asError(e).message)),
);
$("#mode").addEventListener("change", async () => {
  updateMode();
  if (state.session && state.session.mode !== $("#mode").value) {
    try {
      await newSession();
      toast("已使用選擇的引擎建立新工作階段。");
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
  if (!button || state.busy) return;
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
function addActivity(text: string) {
  if (document.querySelector("#activity .muted"))
    $("#activity").replaceChildren();
  const p = document.createElement("div");
  p.className = "activity-item";
  p.textContent = text;
  $("#activity").append(p);
  $("#activity").scrollTop = $("#activity").scrollHeight;
}
function busy(value: boolean) {
  state.busy = value;
  $("#send").disabled = value || !$("#prompt").value.trim();
  $("#messages").setAttribute("aria-busy", String(value));
  $("#send").innerHTML = value ? "執行中…" : "開始執行 <span>↑</span>";
  updateExport();
  $("#prompt").disabled = value;
  $("#stop").hidden = !value;
  $("#mode").disabled = value;
  $("#new-session").disabled = value;
  $("#allow-writes").disabled = value;
  $("#activity-state").textContent = value ? "執行中" : "待命";
  renderSessions();
}
$("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy || navigating) return;
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
    else $("#allow-writes").focus();
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
    content.classList.add("waiting");
    scrollLatest(true);
    $("#prompt").value = "";
    preferences.remove(originalDraft);
    saveDraft();
    $("#activity").replaceChildren();
    const response = await fetch(
      "/api/sessions/" + state.session.id + "/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
        body: JSON.stringify({ prompt, allowWrites }),
      },
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
          content.textContent = output;
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
      if (!completed)
        throw new Error("連線中斷，請重新開啟此工作階段確認結果。");
    } finally {
      reader.releaseLock();
    }
  } catch (caught) {
    failed = true;
    $("#prompt").value = prompt;
    saveDraft();
    const error = asError(caught);
    if (content) {
      content.textContent = (output ? output + "\n\n" : "") + error.message;
      content.closest(".message")?.classList.add("error");
    }
    toast(error.message);
  } finally {
    clearInterval(runTimer);
    content?.classList.remove("waiting");
    $("#run-status").textContent =
      (failed ? "任務未完成 · 草稿已保留" : "任務完成") +
      " · " +
      Math.max(1, Math.floor((Date.now() - started) / 1000)) +
      " 秒";
    try {
      await refresh();
      if (state.session) {
        state.session = await api<SessionView>("sessions/" + state.session.id);
        $("#session-title").textContent = state.session.title;
        updateExport();
      }
    } catch (cause) {
      const e = asError(cause);
      toast(e.message);
    }
    busy(false);
    $("#prompt").focus({ preventScroll: true });
  }
});
$("#prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("#chat-form").requestSubmit();
  }
});
$("#stop").addEventListener("click", async () => {
  if (!state.session) return;
  try {
    await post("sessions/" + state.session.id + "/stop", {});
    addActivity("已送出停止要求。Hermes 遠端任務可能需要在 gateway 另行確認。");
  } catch (cause) {
    const e = asError(cause);
    toast(e.message);
  }
});
document.addEventListener("keydown", (event) => {
  if (
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
    toast("記憶已儲存，下一次 Pi 執行時生效。");
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
  $("#files").style.whiteSpace = "pre-wrap";
}
async function refresh() {
  const [status, sessions, memories, skills] = await Promise.all([
    api<Status>("status"),
    api<SessionSummary[]>("sessions"),
    api<Memory[]>("memories"),
    api<Skill[]>("skills"),
  ]);
  state.status = status;
  state.sessions = sessions;
  renderSessions();
  renderLibrary("memories", memories);
  renderLibrary("skills", skills);
  $("#memory-count").textContent = String(memories.length);
  $("#skill-count").textContent = String(skills.length);
  $("#pi-state").textContent = status.piReady ? "已設定" : "未設定";
  $("#pi-state").classList.toggle("ready", status.piReady);
  $("#hermes-state").textContent = status.hermesReady ? "已設定" : "未連接";
  $("#hermes-state").classList.toggle("ready", status.hermesReady);
  $("#pi-config").textContent = status.piReady
    ? (status.provider === "ollama" ? "本機模型 · " : "已設定 · ") +
      status.provider +
      " / " +
      status.model
    : "尚未設定模型連線";
  $("#hermes-config").textContent = status.hermesReady
    ? "已設定 gateway · 實際連線於執行時確認"
    : "選用功能 · 尚未連接 gateway";
  $("#connection-state").textContent = "本機工作空間 · 已連接";
  updateMode();
  if (!document.querySelector("#messages .message")) renderWelcome();
  await refreshFiles();
}
$("#refresh-files").addEventListener("click", () =>
  refreshFiles().catch((e: unknown) => toast(asError(e).message)),
);
const settingsUI = createSettingsUI({ api, onSaved: refresh, notify: toast });
try {
  await refresh();
  await settingsUI.load();
  const initialView = location.hash.slice(1);
  restoreDraft();
  const id = preferences.get("loom-session");
  if (id && state.sessions.some((s) => s.id === id)) await loadSession(id);
  showView(initialView || "chat");
} catch (cause) {
  const e = asError(cause);
  $("#connection-state").textContent = "工作空間連線失敗";
  $("#run-status").textContent = "無法載入，請確認伺服器後重新整理";
  toast("無法載入工作台：" + e.message);
}
