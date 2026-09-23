import type {
  AgentDefinition,
  Api,
  SettingsView,
  Skill,
} from "../shared/types.ts";
import { agentTools, engineLabels } from "../shared/agents.ts";
import { $ } from "./dom.ts";
import { asError } from "../shared/errors.ts";

export function createAgentsUI(
  api: Api,
  notify: (text: string) => void,
  start: (agent?: AgentDefinition) => Promise<void>,
) {
  let agents: AgentDefinition[] = [];
  let skills: Skill[] = [];
  let settings: SettingsView | undefined;
  let editing: AgentDefinition | undefined;
  let conversationSnapshot: AgentDefinition | undefined;
  const field = (id: string) =>
    $<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "#agent-" + id,
    );
  const form = $<HTMLFormElement>("#agent-form");
  const select = $<HTMLSelectElement>("#agent-select");
  const checkList = (
    id: string,
    entries: [string, string][],
    selected: string[],
  ) => {
    const root = $(id);
    root.replaceChildren();
    for (const [value, text] of entries) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = value;
      input.checked = selected.includes(value);
      const span = document.createElement("span");
      span.textContent = text;
      label.append(input, span);
      root.append(label);
    }
    if (!entries.length) root.textContent = "尚無可選技能，可先到技能庫新增。";
  };
  function hints(changeModel = false) {
    const engine = field("engine").value;
    const provider = field("provider") as HTMLSelectElement;
    provider.querySelector<HTMLOptionElement>(
      'option[value="anthropic"]',
    )!.disabled = engine === "openai-agents";
    if (engine === "openai-agents" && provider.value === "anthropic") {
      provider.value = "openai";
      changeModel = true;
    }
    $("#agent-engine-help").textContent =
      engine === "deepagents"
        ? "內建規劃、子任務與上下文整理；虛擬筆記獨立於真實工作區。"
        : engine === "openai-agents"
          ? "使用 OpenAI SDK 執行工具迴圈；此版支援 OpenAI、Ollama 與相容端點，追蹤資料不上傳。"
          : "現有 Talaria 執行引擎，支援四種模型連線。";
    if (changeModel && settings)
      field("model").value =
        provider.value === settings.pi.provider
          ? settings.pi.model
          : settings.defaults[provider.value as keyof typeof settings.defaults];
    const list = $("#agent-model-options");
    list.replaceChildren();
    for (const model of settings?.models[provider.value] || [])
      list.append(new Option(model.name, model.id));
  }
  function edit(agent?: AgentDefinition) {
    editing = agent;
    form.hidden = false;
    $("#agent-editor-title").textContent = agent
      ? "編輯 " + agent.name
      : "建立 Agent";
    field("name").value = agent?.name || "";
    field("description").value = agent?.description || "";
    field("instructions").value =
      agent?.instructions ||
      "請用使用者的語言回覆，先釐清目標，使用可用工具完成工作並驗證結果。";
    field("engine").value = agent?.engine || "pi";
    field("provider").value =
      agent?.provider || settings?.pi.provider || "ollama";
    field("model").value = agent?.model || settings?.pi.model || "qwen3.5:9b";
    field("memory").value = agent?.memoryScope || "private";
    field("memory").disabled = !!agent;
    checkList(
      "#agent-tools",
      Object.entries(agentTools),
      agent?.tools || [
        "list_files",
        "read_file",
        "remember",
        "update_memory",
        "search_history",
        "list_skills",
        "read_skill",
      ],
    );
    checkList(
      "#agent-skills",
      skills.filter((s) => !s.agentId).map((s) => [s.id, s.name]),
      agent?.skillIds || [],
    );
    $("#agent-form-status").textContent = "";
    hints();
    field("name").focus();
    form.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function render(snapshot?: AgentDefinition) {
    if (snapshot) conversationSnapshot = snapshot;
    snapshot ||= conversationSnapshot;
    const value = select.value;
    select.replaceChildren(new Option("Talaria · 預設", ""));
    for (const agent of agents)
      select.append(
        new Option(agent.name + " · " + engineLabels[agent.engine], agent.id),
      );
    if (snapshot && !agents.some((a) => a.id === snapshot.id))
      select.append(new Option(snapshot.name + " · 對話快照", snapshot.id));
    select.value = value;
    const root = $("#agent-cards");
    root.replaceChildren();
    for (const agent of [undefined, ...agents]) {
      const card = document.createElement("article");
      card.className = "agent-card";
      const badge = document.createElement("span");
      badge.className = "agent-engine-badge";
      badge.textContent = agent ? engineLabels[agent.engine] : "DEFAULT · PI";
      const name = document.createElement("h2");
      name.textContent = agent?.name || "Talaria";
      const description = document.createElement("p");
      description.textContent =
        agent?.description ||
        (agent
          ? "你的專屬工作助手"
          : "預設助手，使用 Bot 設定中的模型、共用記憶與技能。");
      const meta = document.createElement("small");
      meta.textContent = agent
        ? `${agent.model} · ${agent.memoryScope === "private" ? "獨立記憶" : "共用記憶"} · ${agent.tools.length} 個工具`
        : "與現有對話及 Telegram 相容";
      const actions = document.createElement("div");
      actions.className = "agent-card-actions";
      const button = (text: string, fn: () => void | Promise<void>) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "quiet-button";
        el.textContent = text;
        el.onclick = () =>
          Promise.resolve()
            .then(fn)
            .catch((e) => notify(asError(e).message));
        actions.append(el);
      };
      button("開始對話 →", () => start(agent));
      if (agent) {
        button("編輯", () => edit(agent));
        button("封存", async () => {
          if (!confirm(`封存「${agent.name}」？既有對話與記憶會保留。`)) return;
          await api("agents/" + agent.id, { method: "DELETE" });
          if (editing?.id === agent.id) form.hidden = true;
          await load(snapshot);
          notify("已封存，既有對話仍可續聊。");
        });
      }
      card.append(badge, name, description, meta, actions);
      root.append(card);
    }
  }
  async function load(snapshot?: AgentDefinition) {
    [agents, skills, settings] = await Promise.all([
      api<AgentDefinition[]>("agents"),
      api<Skill[]>("skills"),
      api<SettingsView>("settings"),
    ]);
    render(snapshot);
  }
  $("#agent-new").onclick = () => edit();
  $("#agent-cancel").onclick = () => {
    form.hidden = true;
    $("#agent-new").focus();
  };
  field("engine").onchange = () => hints();
  field("provider").onchange = () => hints(true);
  form.onsubmit = async (event) => {
    event.preventDefault();
    const fields = $<HTMLFieldSetElement>("#agent-fields");
    fields.disabled = true;
    $("#agent-form-status").textContent = "正在儲存…";
    const checked = (id: string) =>
      Array.from(
        document.querySelectorAll<HTMLInputElement>(id + " input:checked"),
      ).map((i) => i.value);
    try {
      const saved = await api<AgentDefinition>(
        "agents" + (editing ? "/" + editing.id : ""),
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify({
            name: field("name").value,
            description: field("description").value,
            instructions: field("instructions").value,
            engine: field("engine").value,
            provider: field("provider").value,
            model: field("model").value,
            memoryScope: field("memory").value,
            tools: checked("#agent-tools"),
            skillIds: checked("#agent-skills"),
          }),
        },
      );
      await load();
      edit(saved);
      $("#agent-form-status").textContent =
        "已儲存。按卡片上的「開始對話」即可試聊。";
      notify("Agent 已儲存。");
    } catch (error) {
      $("#agent-form-status").textContent = asError(error).message;
    } finally {
      fields.disabled = false;
    }
  };
  return {
    load,
    selected: () => agents.find((a) => a.id === select.value),
    select(agent?: AgentDefinition) {
      conversationSnapshot = agent;
      render(agent);
      select.value = agent?.id || "";
    },
    requirement(agent: AgentDefinition) {
      if (agent.provider === "ollama") return "";
      if (agent.provider === "openai-compatible")
        return settings?.pi.compatibleUrl
          ? ""
          : "請先在 Bot 設定填入 OpenAI 相容端點。";
      return settings?.pi.credentials[agent.provider].configured
        ? ""
        : "請先在 Bot 設定儲存 " + agent.provider + " API key。";
    },
  };
}
