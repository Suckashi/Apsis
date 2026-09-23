import type { Api, ModelConnection, TaskRun, Memory } from "../shared/types.ts";
import { asError } from "../shared/errors.ts";
import { renderMarkdown } from "./markdown.ts";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
) => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
function button(
  label: string,
  action: () => unknown,
  notify: (text: string) => void,
) {
  const node = el("button", label, "quiet-button");
  node.type = "button";
  node.onclick = async () => {
    node.disabled = true;
    try {
      await action();
    } catch (e) {
      notify(asError(e).message);
    } finally {
      node.disabled = false;
    }
  };
  return node;
}
export function createManagement(
  api: Api,
  notify: (text: string) => void,
  open: (id: string) => Promise<void>,
  changed: () => Promise<void>,
) {
  let connections: ModelConnection[] = [];
  let editing: string | undefined;
  const form = document.querySelector<HTMLFormElement>("#connection-form")!;
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement;
  function edit(row?: ModelConnection) {
    editing = row?.id;
    form.reset();
    form.hidden = false;
    for (const name of ["name", "provider", "model", "url"] as const)
      field(name).value = row?.[name] || (name === "provider" ? "ollama" : "");
    field("apiKey").placeholder = row?.credentialConfigured
      ? "已設定；留空保留"
      : "需要時填入 API key";
    field("name").focus();
  }
  document.querySelector<HTMLButtonElement>("#connection-new")!.onclick = () =>
    edit();
  document.querySelector<HTMLButtonElement>("#connection-cancel")!.onclick =
    () => {
      form.hidden = true;
    };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    submit.disabled = true;
    const status = document.querySelector("#connection-status")!;
    status.textContent = "正在儲存…";
    try {
      await api("connections" + (editing ? "/" + editing : ""), {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({
          name: field("name").value,
          provider: field("provider").value,
          model: field("model").value,
          url: field("url").value,
          apiKey: field("clearKey").checked ? null : field("apiKey").value,
        }),
      });
      field("apiKey").value = "";
      form.hidden = true;
      await loadConnections();
      await changed();
      notify("模型連線已儲存。");
    } catch (e) {
      status.textContent = asError(e).message;
    } finally {
      submit.disabled = false;
    }
  };
  async function loadConnections() {
    connections = (await api<ModelConnection[]>("connections")).sort(
      (a, b) =>
        Number(a.id.startsWith("legacy-")) - Number(b.id.startsWith("legacy-")),
    );
    const root = document.querySelector("#connection-cards")!;
    root.replaceChildren();
    for (const row of connections) {
      const card = el("article", "", "agent-card");
      card.append(
        el("h2", row.name),
        el("p", row.model),
        el(
          "small",
          `${row.provider} · ${row.url || "官方端點"} · ${row.credentialConfigured ? "憑證已就緒" : "未設定金鑰"}`,
        ),
      );
      const actions = el("div", "", "agent-card-actions");
      if (!row.id.startsWith("legacy-")) {
        actions.append(
          button("編輯", () => edit(row), notify),
          button(
            "封存",
            async () => {
              if (!confirm("封存此連線？使用它的既有對話仍需要此連線。"))
                return;
              await api("connections/" + row.id, { method: "DELETE" });
              await loadConnections();
              await changed();
            },
            notify,
          ),
        );
      } else {
        const link = button("管理原有設定", () => {}, notify);
        link.dataset.view = "settings";
        actions.append(link);
      }
      const engine = el("select");
      engine.setAttribute("aria-label", row.name + " 測試引擎");
      for (const [id, name] of [
        ["pi", "Pi"],
        ["deepagents", "Deep Agents"],
        ["openai-agents", "OpenAI Agents SDK"],
      ])
        engine.append(new Option(name, id));
      const result = el(
        "p",
        row.verification
          ? `${row.verification.engine} · ${row.verification.message}`
          : "尚未驗證此模型的串流與工具呼叫。",
        "field-help",
      );
      result.setAttribute("role", "status");
      actions.append(
        engine,
        button(
          "測試模型",
          async () => {
            result.textContent = "正在實際呼叫模型並驗證工具，最多約 45 秒…";
            const verification = await api<
              NonNullable<ModelConnection["verification"]>
            >("connections/" + row.id + "/test", {
              method: "POST",
              body: JSON.stringify({ engine: engine.value }),
            });
            result.textContent = `${verification.engine} · ${verification.message}（串流：${verification.streaming ? "通過" : "未通過"}；工具：${verification.tools ? "通過" : "未通過"}）`;
          },
          notify,
        ),
      );
      card.append(actions, result);
      root.append(card);
    }
  }
  let next: number | null = null;
  let loading = false;
  const statuses: Record<string, string> = {
    running: "執行中",
    completed: "已完成",
    failed: "失敗",
    cancelled: "已停止",
    interrupted: "服務重啟中斷",
    started: "已開始",
    succeeded: "成功",
    unknown: "結果待確認",
  };
  async function loadRuns(append = false) {
    if (loading) return;
    loading = true;
    try {
      const data = await api<{ items: TaskRun[]; nextOffset: number | null }>(
        "runs?offset=" + (append ? next || 0 : 0),
      );
      next = data.nextOffset;
      const root = document.querySelector("#run-cards")!;
      if (!append) root.replaceChildren();
      if (!append && !data.items.length)
        root.append(el("p", "還沒有任務。從對話送出第一個工作即可。", "muted"));
      for (const run of data.items) {
        const card = el("article", "", "agent-card");
        card.append(
          el("h2", `${run.agentName} · ${statuses[run.status]}`),
          el(
            "small",
            `${new Date(run.createdAt).toLocaleString("zh-TW")} · ${run.engine} · ${run.model}`,
          ),
        );
        const preview = el("div", "", "run-preview");
        preview.innerHTML = renderMarkdown(
          run.error || run.text.slice(0, 800) || "正在準備回覆…",
        );
        card.append(preview);
        const details = el("details");
        details.append(el("summary", `操作紀錄 · ${run.operations.length} 項`));
        if (!run.operations.length)
          details.append(el("p", "尚無工具操作。", "field-help"));
        for (const op of run.operations)
          details.append(
            el(
              "p",
              `${statuses[op.status]} · ${op.name}${op.target ? " · " + op.target : ""}${op.error ? " · " + op.error : ""}`,
            ),
          );
        card.append(details);
        if (run.usage)
          card.append(
            el(
              "small",
              `模型回報用量：輸入 ${run.usage.inputTokens} / 輸出 ${run.usage.outputTokens} tokens`,
            ),
          );
        const actions = el("div", "", "agent-card-actions");
        actions.append(button("開啟對話", () => open(run.sessionId), notify));
        if (run.status === "running")
          actions.append(
            button(
              "停止",
              async () => {
                await api("runs/" + run.id + "/stop", {
                  method: "POST",
                  body: "{}",
                });
                await loadRuns();
              },
              notify,
            ),
          );
        card.append(actions);
        root.append(card);
      }
      document.querySelector<HTMLButtonElement>("#runs-more")!.hidden =
        next === null;
    } finally {
      loading = false;
    }
  }
  document.querySelector<HTMLButtonElement>("#runs-refresh")!.onclick = () =>
    void loadRuns().catch((e) => notify(asError(e).message));
  document.querySelector<HTMLButtonElement>("#runs-more")!.onclick = () =>
    void loadRuns(true).catch((e) => notify(asError(e).message));
  return { loadConnections, loadRuns };
}

export function knowledgeActions(
  article: HTMLElement,
  row: Memory,
  rows: Memory[],
  path: string,
  api: Api,
  refresh: () => Promise<void>,
  notify: (s: string) => void,
  open: (id: string) => Promise<void>,
) {
  const actions = el("div", "", "agent-card-actions");
  const save = async (data: unknown) => {
    await api(path + "/" + row.id, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    await refresh();
  };
  const editor = el("form", "", "knowledge-editor");
  editor.hidden = true;
  const area = el("textarea");
  area.value = row.content;
  area.required = true;
  area.rows = 5;
  area.setAttribute("aria-label", "編輯內容");
  const submit = el("button", "儲存變更", "primary");
  submit.type = "submit";
  editor.append(
    area,
    submit,
    button(
      "取消",
      () => {
        editor.hidden = true;
      },
      notify,
    ),
  );
  editor.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      await save({ content: area.value });
    } catch (cause) {
      notify(asError(cause).message);
    } finally {
      submit.disabled = false;
    }
  };
  actions.append(
    button(
      "編輯",
      () => {
        editor.hidden = !editor.hidden;
        if (!editor.hidden) area.focus();
      },
      notify,
    ),
  );
  if (!row.mergedInto)
    actions.append(
      button(
        row.enabled === false ? "啟用" : "停用",
        () => save({ enabled: row.enabled === false }),
        notify,
      ),
    );
  const candidates = rows.filter(
    (other) =>
      other.id !== row.id &&
      other.agentId === row.agentId &&
      !other.mergedInto &&
      other.enabled !== false,
  );
  if (candidates.length && !row.mergedInto) {
    const choose = el("select");
    choose.setAttribute("aria-label", "合併來源");
    choose.append(new Option("選擇要併入的內容", ""));
    for (const other of candidates)
      choose.append(new Option(other.content.slice(0, 50), other.id));
    actions.append(
      choose,
      button(
        "合併",
        async () => {
          if (!choose.value) {
            notify("請先選擇合併來源。");
            return;
          }
          if (confirm("將選取的內容併入此筆，並停用來源？"))
            await save({ mergeId: choose.value });
        },
        notify,
      ),
    );
  }
  if (row.source?.sessionId)
    actions.append(
      button("來源對話", () => open(row.source!.sessionId!), notify),
    );
  article.append(
    el(
      "small",
      `${row.enabled === false ? "已停用 · " : ""}${row.mergedInto ? "已合併 · " : ""}來源：${row.source?.kind === "agent" ? "Agent 保存" : row.source?.kind === "manual" ? "手動新增" : "早期資料"}`,
    ),
    actions,
    editor,
  );
  if (row.revisions?.length) {
    const revisions = el("details");
    revisions.append(el("summary", `修改紀錄 · ${row.revisions.length}`));
    for (const revision of [...row.revisions].reverse())
      revisions.append(
        el(
          "p",
          new Date(revision.at).toLocaleString("zh-TW") +
            " · " +
            revision.content,
        ),
      );
    article.append(revisions);
  }
}
