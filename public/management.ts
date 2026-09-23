import type {
  Api,
  ModelConnection,
  TaskRun,
  Memory,
  SettingsView,
} from "../shared/types.ts";
import { asError } from "../shared/errors.ts";
import { renderMarkdown } from "./markdown.ts";
import {
  connectionModels,
  providerName,
  providerPresets,
  type ProviderPreset,
} from "./provider-catalog.ts";

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
  let defaultChoice: { connectionId: string; model: string } | null = null;
  let catalog: SettingsView["models"] | undefined;
  let editing: string | undefined;
  let preset: ProviderPreset = providerPresets[0];
  let models: string[] = [];
  const form = document.querySelector<HTMLFormElement>("#connection-form")!;
  const picker = document.querySelector<HTMLElement>("#connection-picker")!;
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement;
  const byId = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  function renderModels(selected?: string) {
    const select = byId<HTMLSelectElement>("connection-model");
    const value = selected || select.value || models[0];
    select.replaceChildren(...models.map((model) => new Option(model, model)));
    select.value = models.includes(value) ? value : models[0] || "";
    const root = byId<HTMLElement>("connection-model-list");
    root.replaceChildren();
    for (const model of models) {
      const row = el("div", "", "provider-model-row");
      row.append(el("span", model));
      const remove = button(
        "移除",
        () => {
          models = models.filter((item) => item !== model);
          renderModels();
        },
        notify,
      );
      remove.setAttribute("aria-label", "移除模型 " + model);
      row.append(remove);
      root.append(row);
    }
    if (!models.length)
      root.append(
        el(
          "p",
          "還沒有模型。可以先讀取本機模型，或輸入服務提供的模型 ID。",
          "field-help",
        ),
      );
  }
  function addModel(value: string) {
    const model = value.trim();
    if (!model || model.length > 200 || /[\u0000-\u001f]/u.test(model)) {
      byId<HTMLElement>("connection-status").textContent =
        "請輸入有效的模型 ID。";
      return false;
    }
    if (!models.includes(model)) models.push(model);
    renderModels();
    byId<HTMLInputElement>("connection-model-add").value = "";
    byId<HTMLElement>("connection-status").textContent = "";
    return true;
  }
  function renderSuggestions(extra: string[] = []) {
    const root = byId<HTMLElement>("connection-suggestions");
    root.replaceChildren();
    const suggestions = [
      ...extra,
      ...preset.examples,
      ...(catalog?.[preset.provider] || []).map((item) => item.id),
    ];
    for (const model of [...new Set(suggestions)]
      .filter((item) => !models.includes(item))
      .slice(0, 18)) {
      const option = button(
        "＋ " + model,
        () => {
          addModel(model);
          renderSuggestions(extra);
        },
        notify,
      );
      option.classList.add("provider-suggestion");
      root.append(option);
    }
  }
  function renderPresets() {
    const query = byId<HTMLInputElement>("connection-search")
      .value.trim()
      .toLowerCase();
    const root = byId<HTMLElement>("connection-presets");
    root.replaceChildren();
    for (const candidate of providerPresets.filter((item) =>
      (item.name + " " + item.description).toLowerCase().includes(query),
    )) {
      const tile = el("button", "", "provider-preset");
      tile.type = "button";
      tile.append(
        el("strong", candidate.name),
        el("span", candidate.description),
      );
      tile.onclick = () => edit(undefined, candidate);
      root.append(tile);
    }
    if (!root.childElementCount)
      root.append(
        el("p", "沒有符合的服務；可選「自訂服務」填入端點。", "field-help"),
      );
  }
  function showPicker() {
    form.hidden = true;
    picker.hidden = false;
    byId<HTMLInputElement>("connection-search").value = "";
    renderPresets();
    byId<HTMLInputElement>("connection-search").focus();
  }
  function edit(row?: ModelConnection, chosen?: ProviderPreset) {
    editing = row?.id;
    preset =
      chosen ||
      providerPresets.find((item) => item.id === row?.vendor) ||
      providerPresets.find((item) => item.id === row?.provider) ||
      providerPresets.at(-1)!;
    picker.hidden = true;
    form.reset();
    form.hidden = false;
    field("name").value = row?.name || preset.name;
    field("provider").value = preset.provider;
    field("url").value = row?.url || preset.url || "";
    byId<HTMLElement>("connection-form-kind").textContent =
      preset.provider === "openai-compatible"
        ? "OPENAI COMPATIBLE"
        : "NATIVE PROVIDER";
    byId<HTMLElement>("connection-form-title").textContent = row
      ? "編輯 " + row.name
      : "連接 " + preset.name;
    byId<HTMLElement>("connection-form-description").textContent =
      preset.description;
    byId<HTMLButtonElement>("connection-change-provider").hidden = !!row;
    byId<HTMLElement>("connection-url-field").hidden = ![
      "ollama",
      "openai-compatible",
    ].includes(preset.provider);
    byId<HTMLElement>("connection-key-field").hidden =
      preset.provider === "ollama";
    byId<HTMLElement>("connection-discover").hidden =
      preset.provider !== "ollama";
    byId<HTMLElement>("connection-url-help").textContent =
      preset.id === "qwen"
        ? "預填的是新加坡區域；如果你的 key 屬於其他區域，請改成對應的 Base URL。"
        : "此服務的 API 端點；更換網址時需重新填入金鑰。";
    field("clearKey").checked = false;
    byId<HTMLElement>("connection-clear-key").hidden =
      !row?.credentialConfigured;
    field("apiKey").placeholder = row?.credentialConfigured
      ? "已設定；留空保留"
      : "貼上此服務的 API key";
    models = row ? connectionModels(row) : [];
    renderModels(row?.model);
    renderSuggestions();
    byId<HTMLElement>("connection-status").textContent = "";
    field("name").focus();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  byId<HTMLButtonElement>("connection-new").onclick = () => {
    editing = undefined;
    showPicker();
  };
  byId<HTMLButtonElement>("connection-picker-close").onclick = () => {
    picker.hidden = true;
  };
  byId<HTMLButtonElement>("connection-change-provider").onclick = showPicker;
  byId<HTMLInputElement>("connection-search").oninput = renderPresets;
  byId<HTMLButtonElement>("connection-add-model").onclick = () => {
    if (addModel(byId<HTMLInputElement>("connection-model-add").value))
      renderSuggestions();
  };
  byId<HTMLInputElement>("connection-model-add").onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      byId<HTMLButtonElement>("connection-add-model").click();
    }
  };
  byId<HTMLButtonElement>("connection-discover").onclick = async () => {
    const node = byId<HTMLButtonElement>("connection-discover");
    const status = byId<HTMLElement>("connection-status");
    node.disabled = true;
    status.textContent = "正在讀取 Ollama 模型…";
    try {
      const discovered = await api<{ id: string }[]>("ollama/models", {
        method: "POST",
        body: JSON.stringify({ url: field("url").value }),
      });
      renderSuggestions(discovered.map((item) => item.id));
      status.textContent = discovered.length
        ? `找到 ${discovered.length} 個模型，點選即可加入。`
        : "沒有找到模型；請先在 Ollama 下載模型。";
    } catch (cause) {
      status.textContent = asError(cause).message;
    } finally {
      node.disabled = false;
    }
  };
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
      const pending = byId<HTMLInputElement>(
        "connection-model-add",
      ).value.trim();
      if (pending && !addModel(pending)) return;
      if (!models.length) throw new Error("請至少加入一個模型。");
      await api("connections" + (editing ? "/" + editing : ""), {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({
          name: field("name").value,
          provider: preset.provider,
          vendor: preset.id,
          model: byId<HTMLSelectElement>("connection-model").value,
          models,
          url: field("url").value,
          apiKey: field("clearKey").checked ? null : field("apiKey").value,
        }),
      });
      field("apiKey").value = "";
      form.hidden = true;
      await loadConnections();
      await changed();
      notify("模型服務已儲存，可以在聊天或 Agent 中選用。");
    } catch (e) {
      status.textContent = asError(e).message;
    } finally {
      submit.disabled = false;
    }
  };
  async function loadConnections() {
    const [rows, selected, settings] = await Promise.all([
      api<ModelConnection[]>("connections"),
      api<{ connectionId: string; model: string } | null>(
        "connections/default",
      ),
      api<SettingsView>("settings"),
    ]);
    connections = rows;
    defaultChoice = selected;
    catalog = settings.models;
    const root = document.querySelector("#connection-cards")!;
    root.replaceChildren();
    const named = connections;
    byId<HTMLElement>("connection-count").textContent =
      `${named.length} 個服務 · ${named.reduce((count, row) => count + connectionModels(row).length, 0)} 個模型`;
    if (!named.length)
      root.append(
        el(
          "p",
          "還沒有加入服務。按「加入服務」選擇 Ollama、OpenAI 或相容平台。",
          "provider-empty",
        ),
      );
    for (const row of connections) {
      const card = el("article", "", "provider-card");
      const heading = el("div", "", "provider-card-heading");
      const identity = el("div");
      identity.append(
        el("span", providerName(row), "provider-card-kind"),
        el("h3", row.name),
      );
      const ready =
        row.credentialConfigured ||
        row.provider === "ollama" ||
        (row.provider === "openai-compatible" && !!row.url);
      const statusLabel =
        row.credentialConfigured || row.provider === "ollama"
          ? "已設定"
          : row.provider === "openai-compatible" && row.url
            ? "待驗證"
            : "需 API key";
      heading.append(
        identity,
        el(
          "span",
          statusLabel,
          ready ? "provider-state ready" : "provider-state",
        ),
      );
      card.append(
        heading,
        el("p", row.url || "官方 API 端點", "provider-card-url"),
      );
      const list = el("div", "", "provider-card-models");
      for (const model of connectionModels(row)) {
        const line = el("div", "", "provider-card-model");
        line.append(el("span", model));
        if (
          defaultChoice?.connectionId === row.id &&
          defaultChoice.model === model
        )
          line.append(el("strong", "Apsis 預設", "provider-default-badge"));
        else if (ready)
          line.append(
            button(
              "設為預設",
              async () => {
                await api("connections/default", {
                  method: "PUT",
                  body: JSON.stringify({ connectionId: row.id, model }),
                });
                await loadConnections();
                await changed();
                notify(
                  "Apsis 預設模型已更新，Web 與 Telegram 新對話會使用它。",
                );
              },
              notify,
            ),
          );
        list.append(line);
      }
      card.append(list);
      const actions = el("div", "", "provider-card-actions");
      actions.append(button("編輯服務", () => edit(row), notify));
      actions.append(
        button(
          "封存",
          async () => {
            if (!confirm("封存此服務？使用它的既有對話仍需要此連線。")) return;
            await api("connections/" + row.id, { method: "DELETE" });
            await loadConnections();
            await changed();
          },
          notify,
        ),
      );
      card.append(actions);
      const diagnostic = el("details", "", "settings-advanced");
      diagnostic.append(el("summary", "進階：測試模型"));
      const tests = el("div", "", "provider-card-actions");
      const engine = el("select");
      engine.setAttribute("aria-label", row.name + " 測試引擎");
      for (const [id, name] of [
        ["pi", "Pi"],
        ["deepagents", "Deep Agents"],
        ["openai-agents", "OpenAI Agents SDK"],
      ])
        engine.append(new Option(name, id));
      const testModel = el("select");
      testModel.setAttribute("aria-label", row.name + " 測試模型");
      for (const model of connectionModels(row))
        testModel.append(new Option(model, model));
      const result = el(
        "p",
        row.verification
          ? `${row.verification.model} · ${row.verification.engine} · ${row.verification.message}`
          : "尚未測試連線。",
        "field-help",
      );
      result.setAttribute("role", "status");
      tests.append(
        engine,
        testModel,
        button(
          "測試模型",
          async () => {
            result.textContent = "正在連線並檢查串流與工具呼叫，最多約 45 秒…";
            try {
              const verification = await api<
                NonNullable<ModelConnection["verification"]>
              >("connections/" + row.id + "/test", {
                method: "POST",
                body: JSON.stringify({
                  engine: engine.value,
                  model: testModel.value,
                }),
              });
              result.textContent = `${verification.model} · ${verification.engine} · ${verification.message}（串流：${verification.streaming ? "通過" : "未通過"}；工具：${verification.tools ? "通過" : "未通過"}）`;
            } catch (cause) {
              result.textContent = asError(cause).message;
              throw cause;
            }
          },
          notify,
        ),
      );
      diagnostic.append(tests, result);
      card.append(diagnostic);
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
  const menu = el("details", "", "knowledge-menu");
  menu.append(el("summary", "管理"));
  const actions = el("div", "", "agent-card-actions");
  const deletion = article.querySelector(".delete-button");
  if (deletion) actions.append(deletion);
  article.append(menu);
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
  menu.append(
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
    menu.append(revisions);
  }
}
