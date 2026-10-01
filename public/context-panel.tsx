import { useEffect, useState } from "react";
import type { Memory, WorkContext } from "../shared/types.ts";
import { ConversationHistory } from "./conversation-history.tsx";
import { MemoryPanel } from "./memory-panel.tsx";
import { Icon } from "./chat-visuals.tsx";
import { uiText as t } from "./settings-dictionary.ts";

type API = <T>(path: string, body?: unknown) => Promise<T>;
export function ContextPanel({
  botId,
  botName,
  memories,
  api,
  refresh,
  quote,
  updateKey,
  view = "all",
  initialQuery = "",
}: {
  initialQuery?: string;
  view?: "all" | "history" | "memory";
  updateKey?: string;
  botId: string;
  botName?: string;
  memories: Memory[];
  api: API;
  refresh: () => Promise<void>;
  quote: (id: string, content: string) => void;
}) {
  const [contexts, setContexts] = useState<WorkContext[]>([]);
  const [contextsLoading, setContextsLoading] = useState(view !== "memory");
  const [moreContexts, setMoreContexts] = useState(false);
  const [contextReload, setContextReload] = useState(0);
  const [usage, setUsage] = useState<{
    context: WorkContext;
    compactions: { id: number; summary: string }[];
  }>();
  const [usageLoading, setUsageLoading] = useState(view !== "history");
  const [usageError, setUsageError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/bots/${botId}`;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const memoryRevision = memories.map((m) => m.id + ":" + m.revision).join(",");
  useEffect(() => {
    let valid = true;
    setContextsLoading(view !== "memory");
    setError("");
    setUsageLoading(view !== "history");
    setUsageError("");
    Promise.all([
      view === "memory"
        ? Promise.resolve([])
        : api<WorkContext[]>(base + "/contexts"),
      view === "history"
        ? Promise.resolve(undefined)
        : api<typeof usage>(base + "/context"),
    ])
      .then(([rows, info]) => {
        if (valid) {
          setContexts(rows);
          setMoreContexts(rows.length === 50);
          setUsage(info);
        }
      })
      .catch((e) => {
        if (valid) {
          if (view === "memory") setUsageError(e.message);
          else setError(e.message);
        }
      })
      .finally(() => {
        if (valid) {
          setContextsLoading(false);
          setUsageLoading(false);
        }
      });
    return () => {
      valid = false;
    };
  }, [base, memoryRevision, updateKey, view, contextReload]);
  return (
    <div className="context-panel">
      {error && <p role="alert">{error}</p>}
      {view !== "memory" && (
        <ConversationHistory
          initialQuery={initialQuery}
          botId={botId}
          botName={botName}
          contexts={contexts}
          loading={contextsLoading || busy}
          contextsFailed={!!error}
          retryContexts={() => setContextReload((old) => old + 1)}
          api={api}
          quote={quote}
          moreContexts={moreContexts}
          loadMoreContexts={() =>
            void act(async () => {
              const rows = await api<WorkContext[]>(
                base +
                  "/contexts?beforeId=" +
                  encodeURIComponent(contexts.at(-1)!.id),
              );
              setContexts((old) => [...old, ...rows]);
              setMoreContexts(rows.length === 50);
            })
          }
        />
      )}
      {view !== "history" && (
        <>
          <MemoryPanel
            memories={memories}
            context={usage?.context}
            loading={usageLoading}
            loadError={usageError}
            retry={() => setContextReload((old) => old + 1)}
            api={api}
            base={base}
            refresh={refresh}
          />
          <details className="memory-usage">
            <summary>
              {t("Context 用量")}
              <Icon name="chevron-right" size={14} />
            </summary>
            {usageLoading ? (
              <p role="status">{t("載入中…")}</p>
            ) : usage?.context.usage ? (
              <>
                <p>
                  {usage.context.usage.inputTokens.toLocaleString()} /{" "}
                  {usage.context.usage.inputBudget.toLocaleString()} tokens ·{" "}
                  {t(
                    usage.context.usage.source === "provider"
                      ? "實際回報"
                      : "估計",
                  )}
                </p>
                {!!usage.context.usage.omittedCoreIds.length && (
                  <p>
                    {t("未載入的核心記憶")}：
                    {usage.context.usage.omittedCoreIds
                      .map(
                        (id) =>
                          memories
                            .find((m) => m.id === id)
                            ?.content.slice(0, 80) || id,
                      )
                      .join("；")}
                  </p>
                )}
              </>
            ) : (
              <p>{t("尚無用量紀錄")}</p>
            )}
            {usage?.compactions.map((c) => (
              <details key={c.id}>
                <summary>
                  {t("壓縮紀錄")} #{c.id}
                </summary>
                <p>{c.summary}</p>
              </details>
            ))}
          </details>
        </>
      )}
    </div>
  );
}
