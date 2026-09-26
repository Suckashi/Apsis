import { uiText } from "./settings-dictionary.ts";
import { useSettingsLocale } from "./settings-locale.ts";
import { ActionFeedback } from "./activity-feedback.tsx";
import React, { useEffect, useRef, useState } from "react";
import type {
  ConnectionSelection,
  ModelConnection,
  Provider,
} from "../shared/types.ts";

type Request = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
const services = (): { id: Provider; name: string; description: string }[] => [
  { id: "openai", name: "OpenAI", description: uiText("使用 OpenAI API key") },
  {
    id: "anthropic",
    name: "Anthropic",
    description: uiText("使用 Anthropic API key"),
  },
  { id: "ollama", name: "Ollama", description: uiText("連接本機或自架模型") },
  {
    id: "openai-compatible",
    name: uiText("自訂供應商"),
    description: uiText("OpenAI 相容 API、公司閘道或其他平台"),
  },
];
const serviceName = (id: Provider) =>
  services().find((s) => s.id === id)?.name || id;

export function ProviderSettings({
  connections,
  defaultModel,
  bots,
  api,
  refresh,
  onDirtyChange,
}: {
  connections: ModelConnection[];
  defaultModel: ConnectionSelection | null;
  bots: { connectionId?: string; model?: string }[];
  api: Request;
  refresh: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  useSettingsLocale();
  const [page, setPage] = useState<"list" | "catalog" | "editor">("list");
  const [editing, setEditing] = useState<ModelConnection>();
  const [provider, setProvider] = useState<Provider>("openai-compatible");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [preferred, setPreferred] = useState("");
  const [modelSettings, setModelSettings] = useState<
    NonNullable<ModelConnection["modelSettings"]>
  >({});
  const [manual, setManual] = useState("");
  const [search, setSearch] = useState("");
  const [available, setAvailable] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [notice, setNotice] = useState("");
  const initialDraft = useRef("");
  const draftSnapshot = JSON.stringify({
    provider,
    name,
    url,
    key,
    models,
    preferred,
    modelSettings,
    manual,
  });
  const dirty = page === "editor" && draftSnapshot !== initialDraft.current;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const selectable = connections.filter((c) => c.provider !== "codex");
  const validDefault = selectable.some(
    (c) => c.id === defaultModel?.connectionId,
  );
  const generation = useRef(0);
  const inUse = new Set([
    ...(editing && defaultModel?.connectionId === editing.id
      ? [defaultModel.model]
      : []),
    ...bots
      .filter((bot) => editing && bot.connectionId === editing.id)
      .map((bot) => bot.model || editing!.model),
  ]);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, [page]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = (type: Provider, row?: ModelConnection) => {
    if (type === "codex") return;
    initialDraft.current = JSON.stringify({
      provider: type,
      name:
        row?.name || (type === "openai-compatible" ? "" : serviceName(type)),
      url: row?.url || (type === "ollama" ? "http://127.0.0.1:11434" : ""),
      key: "",
      models: row?.models || (row ? [row.model] : []),
      preferred: row?.model || "",
      modelSettings: row?.modelSettings || {},
      manual: "",
    });
    generation.current++;
    setEditing(row);
    setProvider(type);
    setName(
      row?.name || (type === "openai-compatible" ? "" : serviceName(type)),
    );
    setUrl(row?.url || (type === "ollama" ? "http://127.0.0.1:11434" : ""));
    setKey("");
    setModels(row?.models || (row ? [row.model] : []));
    setPreferred(row?.model || "");
    setModelSettings(row?.modelSettings || {});
    setAvailable(
      (row?.models || (row ? [row.model] : [])).map((id) => ({ id, name: id })),
    );
    setSearch("");
    setManual("");
    setNotice("");
    setDiscovering(false);
    setPage("editor");
  };
  const back = (discard = false) => {
    if (
      !discard &&
      dirty &&
      !window.confirm(uiText("捨棄尚未儲存的設定變更？"))
    )
      return;
    generation.current++;
    setDiscovering(false);
    setKey("");
    setNotice("");
    setPage("list");
  };
  const choose = (id: string, checked: boolean) => {
    const next = checked
      ? [...new Set([...models, id])]
      : models.filter((m) => m !== id);
    setModels(next);
    if (!next.includes(preferred)) setPreferred(next[0] || "");
  };
  const discover = async () => {
    const token = ++generation.current;
    setDiscovering(true);
    setNotice("");
    try {
      const result = await api<{ id: string; name: string }[]>(
        "/api/compatible/models",
        "POST",
        { url, apiKey: key, connectionId: editing?.id },
      );
      if (token !== generation.current) return;
      setAvailable(result);
      setSearch("");
      setNotice(
        result.length
          ? uiText("找到 {0} 個模型。勾選後儲存才會加入供應商。", [
              result.length,
            ])
          : uiText("未找到模型，仍可手動加入模型 ID。"),
      );
    } catch (error) {
      if (token === generation.current)
        setNotice(
          uiText("{0} 也可以手動加入模型 ID。", [(error as Error).message]),
        );
    } finally {
      if (token === generation.current) setDiscovering(false);
    }
  };
  const catalog = [
    ...new Map([
      ...models.map((id) => [id, { id, name: id }] as const),
      ...available.map((m) => [m.id, m] as const),
    ]).values(),
  ].filter((m) =>
    `${m.id} ${m.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section
      className="provider-settings"
      aria-label={uiText("模型供應商設定")}
    >
      {page !== "list" && (
        <button
          type="button"
          className="text-button provider-back"
          disabled={busy}
          onClick={() => back()}
        >
          {uiText("← 返回供應商")}
        </button>
      )}
      <div className="settings-section-heading">
        <div>
          <h3 ref={title} tabIndex={-1}>
            {page === "list"
              ? uiText("模型供應商")
              : page === "catalog"
                ? uiText("新增供應商")
                : editing
                  ? uiText("編輯 {0}", [editing.name])
                  : uiText("新增 {0}", [serviceName(provider)])}
          </h3>
          <p className="muted">
            {page === "list"
              ? uiText("一組連線、多個模型。供所有 Bot 選用。")
              : page === "catalog"
                ? uiText("選擇登入方式或 API 類型，再加入你要使用的模型。")
                : uiText(
                    "連線與模型儲存在這台電腦，不會變更其他 Bot 的模型選擇。",
                  )}
          </p>
        </div>
        {page === "list" && (
          <button
            className="primary"
            onClick={() => {
              setNotice("");
              setPage("catalog");
            }}
          >
            {uiText("新增供應商")}
          </button>
        )}
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {(busy || discovering) && (
        <ActionFeedback
          label={discovering ? "正在取得可用模型…" : "正在處理供應商操作…"}
          pending
        />
      )}
      {page === "list" && (
        <>
          <label className="provider-default">
            {uiText("系統預設模型")}
            <select
              aria-label={uiText("系統預設模型")}
              disabled={busy || !selectable.length}
              value={
                defaultModel && validDefault
                  ? JSON.stringify([
                      defaultModel.connectionId,
                      defaultModel.model,
                    ])
                  : ""
              }
              onChange={(e) => {
                const [connectionId, model] = JSON.parse(
                  e.target.value,
                ) as string[];
                void perform(async () => {
                  await api("/api/connections/default", "PUT", {
                    connectionId,
                    model,
                  });
                  await refresh();
                  setNotice(uiText("已更新系統預設模型。"));
                });
              }}
            >
              {!validDefault && (
                <option value="" disabled>
                  {uiText("選擇替代模型")}
                </option>
              )}
              {selectable.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {(c.models || [c.model]).map((m) => (
                    <option key={m} value={JSON.stringify([c.id, m])}>
                      {c.name} · {m}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <small className="field-help">
              {uiText("僅用於未指定模型的 Bot；編輯供應商不會切換此設定。")}
            </small>
          </label>
          <div className="provider-list">
            {!selectable.length && (
              <p className="empty-section">
                {uiText("尚未加入供應商。新增後即可選擇模型開始對話。")}
              </p>
            )}
            {selectable.map((c) => (
              <article className="provider-card" key={c.id}>
                <div className="provider-card-heading">
                  <div>
                    <strong>{c.name}</strong>
                    <small>
                      {serviceName(c.provider)} ·{" "}
                      {uiText("{0} 個模型", [(c.models || [c.model]).length])}
                    </small>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => open(c.provider, c)}
                  >
                    {uiText("編輯")}
                  </button>
                </div>
                <div className="provider-card-meta">
                  <span>
                    {c.provider === "ollama"
                      ? uiText("本機／自架服務")
                      : c.credentialConfigured
                        ? uiText("已儲存金鑰")
                        : uiText("未設定金鑰")}
                  </span>
                  {defaultModel?.connectionId === c.id && (
                    <span className="status-badge">{uiText("系統預設")}</span>
                  )}
                  {c.verification && (
                    <span
                      className={`status-badge ${c.verification.ok ? "is-success" : "is-error"}`}
                    >
                      {c.verification.ok
                        ? uiText("最近測試通過")
                        : uiText("最近測試失敗")}
                    </span>
                  )}
                </div>
                {c.url && <small className="provider-endpoint">{c.url}</small>}
              </article>
            ))}
          </div>
        </>
      )}
      {page === "catalog" && (
        <div className="provider-catalog">
          {services().map((s) => (
            <button
              key={s.id}
              className="provider-choice"
              onClick={() => open(s.id)}
            >
              <strong>{s.name}</strong>
              <span>{s.description}</span>
              <span className="provider-choice-arrow" aria-hidden="true">
                →
              </span>
            </button>
          ))}
        </div>
      )}
      {page === "editor" && (
        <form
          className="settings-form provider-form"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              await api(
                editing ? `/api/connections/${editing.id}` : "/api/connections",
                editing ? "PUT" : "POST",
                {
                  name,
                  provider,
                  url,
                  apiKey: key,
                  models,
                  model: preferred,
                  modelSettings: Object.fromEntries(
                    models
                      .filter((id) => modelSettings[id])
                      .map((id) => [id, modelSettings[id]]),
                  ),
                },
              );
              await refresh();
              back(true);
              setNotice(uiText("供應商已儲存。"));
            });
          }}
        >
          <fieldset disabled={busy}>
            <legend>{uiText("連線設定")}</legend>
            <label>
              {uiText("名稱")}
              <input
                required
                maxLength={100}
                placeholder={uiText("例如：公司模型服務")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {
              <>
                {["openai-compatible", "ollama"].includes(provider) && (
                  <label>
                    {uiText("API 網址")}
                    <input
                      type="url"
                      required
                      value={url}
                      placeholder="https://api.example.com/v1"
                      onChange={(e) => {
                        generation.current++;
                        setDiscovering(false);
                        setAvailable([]);
                        setUrl(e.target.value);
                      }}
                    />
                    {editing && url !== editing.url && (
                      <small className="field-help">
                        {uiText("網址變更後不會沿用原金鑰，請重新填寫。")}
                      </small>
                    )}
                  </label>
                )}
                {provider !== "ollama" && (
                  <label>
                    API key
                    <input
                      type="password"
                      autoComplete="off"
                      value={key}
                      onChange={(e) => {
                        generation.current++;
                        setDiscovering(false);
                        setKey(e.target.value);
                      }}
                      placeholder={
                        editing?.credentialConfigured
                          ? uiText("已儲存；留白保留原金鑰")
                          : uiText("輸入 API key（無需驗證的端點可留白）")
                      }
                    />
                    <small className="field-help">
                      {uiText("金鑰儲存後不會回傳到瀏覽器。")}
                    </small>
                  </label>
                )}
                <p className="field-help">
                  {uiText("API 類型：")}
                  {provider === "openai-compatible"
                    ? "OpenAI Chat Completions"
                    : serviceName(provider)}
                </p>
              </>
            }
          </fieldset>
          <fieldset disabled={busy}>
            <legend>{uiText("模型目錄")}</legend>
            <div className="provider-model-toolbar">
              <span>{uiText("已選 {0} 個模型", [models.length])}</span>
              {provider === "openai-compatible" && (
                <button
                  type="button"
                  className="secondary"
                  disabled={discovering || !url.trim()}
                  onClick={() => void discover()}
                >
                  {discovering ? uiText("取得中…") : uiText("取得可用模型")}
                </button>
              )}
            </div>
            {catalog.length > 0 || models.length > 0 || available.length > 0 ? (
              <>
                <input
                  type="search"
                  aria-label={uiText("搜尋模型")}
                  placeholder={uiText("搜尋模型名稱或 ID")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div
                  className="provider-model-list"
                  role="group"
                  aria-label={uiText("可用模型")}
                >
                  {catalog.map((m) => (
                    <label key={m.id} className="provider-model-option">
                      <input
                        type="checkbox"
                        checked={models.includes(m.id)}
                        disabled={inUse.has(m.id)}
                        onChange={(e) => choose(m.id, e.target.checked)}
                      />
                      <span>
                        {m.name}
                        {m.name !== m.id && <small>{m.id}</small>}
                        {inUse.has(m.id) && (
                          <small>
                            {uiText(
                              "使用中；請先切換使用此模型的 Bot 或系統預設，再移除。",
                            )}
                          </small>
                        )}
                      </span>
                    </label>
                  ))}
                  {!catalog.length && (
                    <p className="empty-section">
                      {uiText("沒有符合的模型。")}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="field-help">
                {uiText(
                  "尚未加入模型。可從供應商取得清單，或手動輸入模型 ID。",
                )}
              </p>
            )}
            <div className="input-action-row">
              <input
                aria-label={uiText("手動加入模型 ID")}
                placeholder={uiText("輸入模型 ID")}
                value={manual}
                maxLength={200}
                onChange={(e) => setManual(e.target.value)}
              />
              <button
                type="button"
                className="secondary"
                disabled={!manual.trim()}
                onClick={() => {
                  choose(manual.trim(), true);
                  setManual("");
                  setSearch("");
                }}
              >
                {uiText("加入")}
              </button>
            </div>
            {models.length > 0 && (
              <label>
                {uiText("此供應商的建議模型")}
                <select
                  value={preferred}
                  onChange={(e) => setPreferred(e.target.value)}
                >
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <small className="field-help">
                  {uiText("不會更改系統預設模型。")}
                </small>
              </label>
            )}
          </fieldset>
          {models.length > 0 && (
            <details className="provider-model-advanced">
              <summary>{uiText("進階模型設定")}</summary>
              <p className="field-help">
                {uiText("僅調整顯示名稱與輸出上限；留白沿用供應商預設。")}
              </p>
              <fieldset disabled={busy}>
                {models.map((id) => (
                  <div className="permission-rule" key={id}>
                    <strong>{id}</strong>
                    <div className="settings-fields">
                      <label>
                        {uiText("顯示名稱")}
                        <input
                          maxLength={100}
                          value={modelSettings[id]?.displayName || ""}
                          onChange={(e) =>
                            setModelSettings((old) => ({
                              ...old,
                              [id]: {
                                ...old[id],
                                displayName: e.target.value.trim()
                                  ? e.target.value
                                  : undefined,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        {uiText("Context token 上限")}
                        <small>
                          {modelSettings[id]?.contextWindowTokens
                            ? uiText("手動設定優先")
                            : uiText("未填寫時預設 256K（262,144 tokens）")}
                        </small>
                        <input
                          type="number"
                          min={2048}
                          max={10000000}
                          step={1}
                          placeholder={uiText(
                            "未填寫時預設 256K（262,144 tokens）",
                          )}
                          value={modelSettings[id]?.contextWindowTokens ?? ""}
                          onChange={(e) =>
                            setModelSettings((old) => ({
                              ...old,
                              [id]: {
                                ...old[id],
                                contextWindowTokens:
                                  e.target.value === ""
                                    ? undefined
                                    : e.target.valueAsNumber,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        {uiText("輸出 token 上限")}
                        <input
                          type="number"
                          min={1}
                          max={1000000}
                          step={1}
                          value={modelSettings[id]?.maxOutputTokens ?? ""}
                          onChange={(e) =>
                            setModelSettings((old) => ({
                              ...old,
                              [id]: {
                                ...old[id],
                                maxOutputTokens:
                                  e.target.value === ""
                                    ? undefined
                                    : e.target.valueAsNumber,
                              },
                            }))
                          }
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </fieldset>
            </details>
          )}
          <div className="provider-form-actions">
            <button
              className="primary"
              disabled={busy || discovering || !models.length}
            >
              {busy ? uiText("儲存中…") : uiText("儲存供應商")}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => back(true)}
            >
              {uiText("取消")}
            </button>
            {editing && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const result = await api<{ message: string }>(
                      `/api/connections/${editing.id}/test`,
                      "POST",
                      { model: editing.model },
                    );
                    await refresh();
                    setNotice(
                      uiText("測試已儲存的設定：{0}", [result.message]),
                    );
                  })
                }
              >
                {uiText("測試已儲存連線")}
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
