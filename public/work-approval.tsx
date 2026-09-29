import React, { useRef, useState } from "react";
import type { Approval } from "../shared/product.ts";
import { approvalReason } from "../shared/approval.ts";
import { approvalPresentation } from "../shared/work-presentation.ts";
import { ActivityMark } from "./activity-feedback.tsx";
import { useSettingsLocale } from "./settings-locale.ts";
import { taskText } from "./task-locale.ts";

export function WorkApproval({
  approval,
  disabled = false,
  onDecide,
}: {
  approval: Approval;
  disabled?: boolean;
  onDecide: (
    id: string,
    approved: boolean,
    remember?: boolean,
  ) => void | Promise<void>;
}) {
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  const [remember, setRemember] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const presentation = approvalPresentation(approval);
  const unavailable = disabled || deciding || approval.status !== "pending";
  const act = async (approved: boolean) => {
    if (unavailable || pending.current) return;
    pending.current = true;
    setDeciding(true);
    setError("");
    try {
      await onDecide(
        approval.id,
        approved,
        approved && remember && approval.rememberAllowed !== false,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("無法送出核准決定，請重試。"),
      );
    } finally {
      pending.current = false;
      setDeciding(false);
    }
  };
  return (
    <section
      className="approval-card"
      aria-label={t("需要你的核准")}
      aria-busy={deciding}
    >
      <div className="approval-heading">
        <ActivityMark state="approval" />
        <div>
          <strong>{t("需要你的核准")}</strong>
          <span className="approval-action-label">
            {t(presentation.action)}
          </span>
        </div>
      </div>
      {presentation.target && (
        <pre className="approval-target">{presentation.target}</pre>
      )}
      {approval.location?.path &&
        approval.location.path !== presentation.target && (
          <p className="field-help">
            {t("工作位置：")}
            {approval.location.path}
          </p>
        )}
      <p className="approval-impact">{t(presentation.impact)}</p>
      <p className="field-help">
        {approvalReason(approval.reason, locale, approval.dangerousCommand)}
      </p>
      <details className="approval-technical">
        <summary>{t("技術詳情")}</summary>
        <p className="field-help">
          {t("工具：")}
          <code>{approval.tool}</code>
        </p>
        <pre>{JSON.stringify(approval.args, null, 2)}</pre>
      </details>
      {approval.rememberAllowed !== false && approval.status === "pending" && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={remember}
            disabled={unavailable}
            onChange={(event) => setRemember(event.target.checked)}
          />
          {t("本次任務允許相同操作（包含由此任務派工）")}
        </label>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="approval-actions">
        <button
          type="button"
          className="secondary"
          disabled={unavailable}
          onClick={() => void act(false)}
        >
          {t("拒絕")}
        </button>
        <button
          type="button"
          className="primary"
          disabled={unavailable}
          onClick={() => void act(true)}
        >
          {t(deciding ? "處理中…" : "核准並繼續")}
        </button>
      </div>
    </section>
  );
}
