import { api } from "./chat-api.ts";

import { ProjectControls } from "./project-controls.tsx";

import { uiText } from "./settings-dictionary.ts";
import { useEffect, useState } from "react";

import { Modal } from "./bot-ui.tsx";
import type { Snapshot } from "../shared/api.ts";
import type { Routine } from "../shared/product.ts";

import { getSettingsLocale } from "./settings-locale.ts";

import { Icon } from "./chat-visuals.tsx";

export function RoutineEditor({
  routine: r,
  botId,
  close,
  save,
}: {
  routine: Routine | "new";
  botId: string;
  close: () => void;
  save: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const old = r === "new" ? undefined : r;
  const [name, setName] = useState(old?.name || "");
  const [prompt, setPrompt] = useState(old?.prompt || "");
  const [routineProject, setRoutineProject] = useState(old?.projectId || "");
  const [routineBranch, setRoutineBranch] = useState(old?.branch || "");
  const [projects, setProjects] = useState<Snapshot["projects"]>([]);
  useEffect(() => {
    void api<Snapshot["projects"]>("/projects")
      .then((p) => setProjects(p.filter((v) => v.id !== "workspace")))
      .catch((e) => setNotice(e.message));
  }, []);
  const [cron, setCron] = useState(old?.cron || "0 9 * * 1-5");
  const [timezone, setTimezone] = useState(old?.timezone || "Asia/Taipei");
  const [enabled, setEnabled] = useState(old?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <Modal label={old ? uiText("編輯排程") : uiText("新增排程")} close={close}>
      <section className="modal routine-modal">
        <header>
          <h2>{old ? uiText("編輯排程") : uiText("新增排程")}</h2>
          <button
            className="icon"
            aria-label={uiText("關閉排程")}
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </header>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (saving) return;
            setSaving(true);
            setNotice("");
            try {
              await save(async () => {
                try {
                  await api(
                    old ? `/routines/${old.id}` : `/bots/${botId}/routines`,
                    old ? "PATCH" : "POST",
                    {
                      name,
                      prompt,
                      cron,
                      timezone,
                      enabled,
                      projectId: routineProject,
                      branch: routineBranch,
                    },
                  );
                  close();
                } catch (error) {
                  setNotice((error as Error).message);
                  throw error;
                }
              });
            } finally {
              setSaving(false);
            }
          }}
        >
          {notice && (
            <div className="notice" role="alert">
              {notice}
            </div>
          )}
          <label>
            {uiText("名稱")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </label>
          <label>
            {uiText("交辦內容")}
            <textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
            />
          </label>
          <ProjectControls
            projects={projects}
            projectId={routineProject}
            setProject={setRoutineProject}
            branch={routineBranch}
            setBranch={setRoutineBranch}
            api={api}
          />
          <label>
            {uiText("時間")}
            <select
              value={
                ["0 9 * * 1-5", "0 9 * * *", "0 9 * * 1"].includes(cron)
                  ? cron
                  : "custom"
              }
              onChange={(e) =>
                setCron(
                  e.target.value === "custom" ? "0 10 * * *" : e.target.value,
                )
              }
            >
              <option value="0 9 * * 1-5">{uiText("每個工作日 09:00")}</option>
              <option value="0 9 * * *">{uiText("每天 09:00")}</option>
              <option value="0 9 * * 1">{uiText("每週一 09:00")}</option>
              <option value="custom">{uiText("自訂 Cron")}</option>
            </select>
          </label>
          <div className="form-row">
            <label>
              Cron
              <input value={cron} onChange={(e) => setCron(e.target.value)} />
            </label>
            <label>
              {uiText("時區")}
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </label>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {uiText("啟用排程（Apsis 需保持執行）")}
          </label>
          <footer>
            {old && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void save(() => api(`/routines/${old.id}/test`, "POST", {}))
                }
              >
                {uiText("立即試跑")}
              </button>
            )}
            <button className="primary" type="submit" disabled={saving}>
              {saving ? uiText("儲存中…") : uiText("儲存排程")}
            </button>
          </footer>
        </form>
        {old && (
          <details className="routine-history">
            <summary>{uiText("執行紀錄（{0}）", [old.history.length])}</summary>
            {old.history.map((h) => (
              <p key={h.jobId}>
                {new Date(h.at).toLocaleString(getSettingsLocale())}
              </p>
            ))}
          </details>
        )}
      </section>
    </Modal>
  );
}
