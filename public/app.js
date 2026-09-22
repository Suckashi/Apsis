const $ = (selector) => document.querySelector(selector);
const state = {
  session: null,
  sessions: [],
  busy: false,
  view: "chat",
  status: {},
};
const labels = {
  demo: "示範模式",
  pi: "Pi Agent",
  hybrid: "Pi × Hermes",
  hermes: "Hermes",
};
let toastTimer;
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 5000);
}
async function api(path, options = {}) {
  const response = await fetch("/api/" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Loom-Client": "1",
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "請求失敗。");
  return data;
}
const post = (path, data) =>
  api(path, { method: "POST", body: JSON.stringify(data) });
function showView(view) {
  if (state.busy && view !== "chat") {
    toast("請先停止或等待目前任務完成。");
    return;
  }
  state.view = view;
  document.querySelectorAll(".view").forEach((el) => {
    el.hidden = el.id !== view + "-view";
  });
  document
    .querySelectorAll(".nav")
    .forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  $("#page-name").textContent = {
    chat: "工作台",
    memories: "長期記憶",
    skills: "技能庫",
    settings: "連線設定",
  }[view];
}
document
  .querySelectorAll("[data-view]")
  .forEach((el) =>
    el.addEventListener("click", () => showView(el.dataset.view)),
  );
function renderSessions() {
  $("#sessions").replaceChildren();
  if (!state.sessions.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "你的下一個想法，從這裡開始。";
    $("#sessions").append(p);
  }
  for (const item of state.sessions) {
    const button = document.createElement("button");
    button.className = "session-button";
    button.classList.toggle("selected", item.id === state.session?.id);
    button.textContent = item.title;
    button.title = item.title + " · " + labels[item.mode];
    button.disabled = state.busy;
    button.addEventListener("click", () =>
      loadSession(item.id).catch((error) => toast(error.message)),
    );
    $("#sessions").append(button);
  }
}
function addMessage(role, text, error = false) {
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
  body.append(label, content);
  item.append(avatar, body);
  $("#messages").append(item);
  return content;
}
function renderConversation() {
  $("#messages").replaceChildren();
  $("#activity").replaceChildren();
  for (const m of state.session.messages) {
    addMessage(m.role, m.content, m.status === "error");
    for (const text of m.activity || []) addActivity(text);
  }
  $("#session-title").textContent = state.session.title;
  $("#mode").value = state.session.mode;
  updateMode();
  $("#messages").scrollTop = $("#messages").scrollHeight;
}
function updateMode() {
  const mode = $("#mode").value;
  $("#mode-banner").textContent =
    mode === "demo"
      ? "示範模式 · 不會呼叫 AI，也不會消耗 API 額度"
      : mode === "hybrid"
        ? "Pi 主導任務，必要時委派 Hermes；修改與遠端工具需由你開啟。"
        : mode === "hermes"
          ? "Hermes 在 gateway 主機執行，完成後回傳結果。"
          : "Pi 使用真實模型與本機工具；預設僅讀取工作區。";
}
async function loadSession(id) {
  if (state.busy) return;
  state.session = await api("sessions/" + id);
  $("#allow-writes").checked = false;
  localStorage.setItem("loom-session", id);
  renderConversation();
  renderSessions();
  showView("chat");
  if (state.session.running)
    toast("此工作階段正在其他分頁執行，稍後重新開啟可查看結果。");
}
async function newSession() {
  if (state.busy) return;
  state.session = await post("sessions", { mode: $("#mode").value });
  localStorage.setItem("loom-session", state.session.id);
  state.sessions = await api("sessions");
  $("#allow-writes").checked = false;
  renderConversation();
  renderSessions();
  showView("chat");
  $("#prompt").focus();
}
$("#new-session").addEventListener("click", () =>
  newSession().catch((e) => toast(e.message)),
);
$("#mode").addEventListener("change", async () => {
  updateMode();
  if (state.session && state.session.mode !== $("#mode").value) {
    try {
      await newSession();
      toast("已使用選擇的引擎建立新工作階段。");
    } catch (e) {
      toast(e.message);
    }
  }
});
document.querySelectorAll("[data-prompt]").forEach((el) =>
  el.addEventListener("click", () => {
    $("#prompt").value = el.dataset.prompt;
    $("#prompt").focus();
  }),
);
function addActivity(text) {
  if ($("#activity .muted")) $("#activity").replaceChildren();
  const p = document.createElement("div");
  p.className = "activity-item";
  p.textContent = text;
  $("#activity").append(p);
  $("#activity").scrollTop = $("#activity").scrollHeight;
}
function busy(value) {
  state.busy = value;
  $("#send").disabled = value;
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
  if (state.busy) return;
  const prompt = $("#prompt").value.trim();
  if (!prompt) return;
  let content,
    output = "";
  try {
    const allowWrites = $("#allow-writes").checked;
    busy(true);
    if (!state.session) {
      state.session = await post("sessions", { mode: $("#mode").value });
      localStorage.setItem("loom-session", state.session.id);
      renderConversation();
    }
    $("#messages #welcome")?.remove();
    addMessage("user", prompt);
    content = addMessage("assistant", "");
    $("#prompt").value = "";
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
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "",
      completed = false;
    const consume = (line) => {
      if (!line.trim()) return;
      const data = JSON.parse(line);
      if (data.type === "delta") {
        output += data.text;
        content.textContent = output;
      }
      if (data.type === "activity") addActivity(data.text);
      if (data.type === "error") {
        completed = true;
        throw new Error(data.text);
      }
      if (data.type === "done") completed = true;
      $("#messages").scrollTop = $("#messages").scrollHeight;
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) consume(line);
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
      if (!completed)
        throw new Error("連線中斷，請重新開啟此工作階段確認結果。");
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (content) {
      content.textContent = (output ? output + "\n\n" : "") + error.message;
      content.closest(".message").classList.add("error");
    }
    toast(error.message);
  } finally {
    busy(false);
    try {
      await refresh();
      if (state.session) {
        state.session = await api("sessions/" + state.session.id);
        $("#session-title").textContent = state.session.title;
      }
    } catch (e) {
      toast(e.message);
    }
    $("#prompt").focus();
  }
});
$("#prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("#chat-form").requestSubmit();
  }
});
$("#stop").addEventListener("click", async () => {
  try {
    await post("sessions/" + state.session.id + "/stop", {});
    addActivity("已送出停止要求。Hermes 遠端任務可能需要在 gateway 另行確認。");
  } catch (e) {
    toast(e.message);
  }
});
document.addEventListener("keydown", (event) => {
  if (
    event.key.toLowerCase() === "n" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
  )
    newSession().catch((e) => toast(e.message));
});
function renderLibrary(name, rows) {
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
      new Date(row.createdAt).toLocaleDateString("zh-TW") + " · 儲存在本機";
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
      } catch (e) {
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
    event.target.reset();
    await refresh();
    toast("記憶已儲存，下一次 Pi 執行時生效。");
  } catch (e) {
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
    event.target.reset();
    await refresh();
    toast("技能已加入。");
  } catch (e) {
    toast(e.message);
  }
});
async function refreshFiles() {
  const files = await api("files");
  $("#files").textContent = files.length
    ? files
        .map((f) => (f.type === "directory" ? "▱ " : "▧ ") + f.name)
        .join("\n")
    : "workspace/ 尚無檔案";
  $("#files").style.whiteSpace = "pre-wrap";
}
async function refresh() {
  const [status, sessions, memories, skills] = await Promise.all([
    api("status"),
    api("sessions"),
    api("memories"),
    api("skills"),
  ]);
  state.status = status;
  state.sessions = sessions;
  renderSessions();
  renderLibrary("memories", memories);
  renderLibrary("skills", skills);
  $("#memory-count").textContent = memories.length;
  $("#skill-count").textContent = skills.length;
  $("#pi-state").textContent = status.piReady ? "已設定" : "未設定";
  $("#pi-state").classList.toggle("ready", status.piReady);
  $("#hermes-state").textContent = status.hermesReady ? "已設定" : "未連接";
  $("#hermes-state").classList.toggle("ready", status.hermesReady);
  $("#pi-config").textContent = status.piReady
    ? "已設定 · " + status.provider + " / " + status.model
    : "尚未設定模型 API key";
  $("#hermes-config").textContent = status.hermesReady
    ? "已設定 gateway · 實際連線於執行時確認"
    : "選用功能 · 尚未連接 gateway";
  await refreshFiles();
}
$("#refresh-files").addEventListener("click", () =>
  refreshFiles().catch((e) => toast(e.message)),
);
$("#refresh-status").addEventListener("click", () =>
  refresh()
    .then(() => toast("已更新設定狀態。"))
    .catch((e) => toast(e.message)),
);
try {
  await refresh();
  const id = localStorage.getItem("loom-session");
  if (id && state.sessions.some((s) => s.id === id)) await loadSession(id);
} catch (e) {
  toast("無法載入工作台：" + e.message);
}
