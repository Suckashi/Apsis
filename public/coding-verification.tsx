import { useEffect, useState } from "react";
import type { WebVerification } from "../shared/coding-verification.ts";
import { uiText } from "./settings-dictionary.ts";
import { useSettingsLocale } from "./settings-locale.ts";

export function CodingVerification({
  api,
  botId,
  contextId,
  updateKey,
}: {
  api: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  botId: string;
  contextId: string;
  updateKey?: string | number;
}) {
  const [receipt, setReceipt] = useState<WebVerification | null>(null);
  const [error, setError] = useState("");
  const [applicable, setApplicable] = useState(false);
  useSettingsLocale();
  useEffect(() => {
    let active = true;
    let pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      void api<{ applicable: boolean; receipt: WebVerification | null }>(
        `/bots/${botId}/verification?context=${encodeURIComponent(contextId)}`,
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
  }, [api, botId, contextId, updateKey]);
  if (!applicable && !error) return null;
  const title =
    (error && uiText(error)) ||
    (!receipt
      ? uiText("尚未進行網頁操作驗證")
      : receipt.stale
        ? uiText("檔案已變更，網頁需要重新驗證")
        : receipt.status === "passed"
          ? uiText("最近一次網頁檢查通過 · {0} 項結果", [receipt.assertions])
          : uiText("網頁檢查未通過"));
  return (
    <section
      className="coding-verification"
      aria-label={uiText("網頁驗證")}
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
          {uiText(
            "網頁功能請讓 Bot 操作並檢查結果；單元測試通過不代表畫面可用。",
          )}
        </p>
      ) : (
        <details style={{ marginTop: 8 }}>
          <summary>
            {uiText("查看操作與結果")} · {receipt.path}
          </summary>
          <p>
            {new Date(receipt.checkedAt).toLocaleString()} ·
            {uiText("僅涵蓋以下操作與當時載入的檔案。")}
          </p>
          <ol>
            {receipt.steps.map((step, i) => (
              <li key={i} style={{ margin: "8px 0" }}>
                {step.status === "passed"
                  ? uiText("通過")
                  : step.status === "failed"
                    ? uiText("失敗")
                    : uiText("未執行")}{" "}
                ·{" "}
                {
                  {
                    fill: uiText("輸入"),
                    click: uiText("點擊"),
                    press: uiText("按鍵"),
                    reload: uiText("重新整理"),
                    expect_text: uiText("文字包含"),
                    expect_value: uiText("輸入值等於"),
                    expect_visible: uiText("畫面可見"),
                    expect_hidden: uiText("畫面隱藏或已移除"),
                    expect_checked:
                      step.value === "false"
                        ? uiText("未勾選")
                        : uiText("已勾選"),
                    expect_style: uiText("實際樣式等於"),
                  }[step.action]
                }{" "}
                {step.selector && <code>{step.selector}</code>}
                {step.property && (
                  <>
                    {" "}
                    · <code>{step.property}</code>
                  </>
                )}
                {step.value !== undefined &&
                  step.action !== "expect_checked" &&
                  `：${step.value}`}
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
