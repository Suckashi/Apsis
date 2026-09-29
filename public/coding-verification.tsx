import { useEffect, useState } from "react";
import type { WebVerification } from "../shared/coding-verification.ts";

export function CodingVerification({
  api,
  taskId,
  updateKey,
}: {
  api: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  taskId: string;
  updateKey?: string | number;
}) {
  const [receipt, setReceipt] = useState<WebVerification | null>(null);
  const [error, setError] = useState("");
  const [applicable, setApplicable] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      void api<{ applicable: boolean; receipt: WebVerification | null }>(
        `/coding-tasks/${taskId}/verification`,
      )
        .then((value) => {
          if (active) {
            setApplicable(value.applicable);
            setReceipt(value.receipt);
            setError("");
          }
        })
        .catch(() => {
          if (active) setError("暫時無法讀取網頁檢查紀錄");
        })
        .finally(() => {
          pending = false;
        });
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, taskId, updateKey]);
  if (!applicable && !error) return null;
  const title =
    error ||
    (!receipt
      ? "尚未進行網頁操作驗證"
      : receipt.stale
        ? "檔案已變更，網頁需要重新驗證"
        : receipt.status === "passed"
          ? `最近一次網頁檢查通過 · ${receipt.assertions} 項結果`
          : "網頁檢查未通過");
  return (
    <section
      className="coding-verification"
      aria-label="網頁驗證"
      style={{
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "12px 16px",
        margin: "16px 0",
        fontSize: 13,
      }}
    >
      <strong>{title}</strong>
      {!receipt ? (
        <p style={{ margin: "6px 0 0", opacity: 0.7 }}>
          網頁功能請讓 Bot 操作並檢查結果；單元測試通過不代表畫面可用。
        </p>
      ) : (
        <details style={{ marginTop: 8 }}>
          <summary>查看操作與結果 · {receipt.path}</summary>
          <p>
            {new Date(receipt.checkedAt).toLocaleString()} ·
            僅涵蓋以下操作與當時載入的檔案。
          </p>
          <ol>
            {receipt.steps.map((step, i) => (
              <li key={i} style={{ margin: "8px 0" }}>
                {step.status === "passed"
                  ? "通過"
                  : step.status === "failed"
                    ? "失敗"
                    : "未執行"}{" "}
                ·{" "}
                {
                  {
                    fill: "輸入",
                    click: "點擊",
                    press: "按鍵",
                    expect_text: "文字包含",
                    expect_value: "輸入值等於",
                    expect_visible: "畫面可見",
                  }[step.action]
                }{" "}
                <code>{step.selector}</code>
                {step.value !== undefined && `：${step.value}`}
                {step.error && (
                  <pre
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {step.error}
                  </pre>
                )}
              </li>
            ))}
          </ol>
          {receipt.errors.map((message, i) => (
            <p key={i}>{message}</p>
          ))}
        </details>
      )}
    </section>
  );
}
