import { api } from "./chat-api.ts";

import { ProjectControls } from "./project-controls.tsx";

import { uiText } from "./settings-dictionary.ts";
import { useEffect, useRef, useState } from "react";

import { Modal } from "./bot-ui.tsx";
import type { Snapshot } from "../shared/api.ts";
import type { Job, Routine } from "../shared/product.ts";

import { getSettingsLocale } from "./settings-locale.ts";

import { Icon } from "./chat-visuals.tsx";
import { RoutineHistoryEntry } from "./routine-history.tsx";

export function RoutineEditor({
  routine: r,
  botId,
  close,
  save,
  jobs,
}: {
  routine: Routine | "new";
  botId: string;
  close: () => void;
  save: (fn: () => Promise<unknown>) => Promise<void>;
  jobs: Job[];
}) {
  const old = r === "new" ? undefined : r;
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const [name, setName] = useState(old?.name || "");
  const [prompt, setPrompt] = useState(old?.prompt || "");
  const [routineProject, setRoutineProject] = useState(old?.projectId || "");
  const [routineBranch, setRoutineBranch] = useState(old?.branch || "");
  const [projects, setProjects] = useState<Snapshot["projects"]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  useEffect(() => {
    let live = true;
    void api<Snapshot["projects"]>("/projects")
      .then((p) => {
        if (live) setProjects(p.filter((v) => v.id !== "workspace"));
      })
      .catch((e) => {
        if (live) {
          setNotice(e.message);
          setNoticeError(true);
        }
      })
      .finally(() => {
        if (live) setProjectsLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  const [cron, setCron] = useState(old?.cron || "0 9 * * 1-5");
  const presets = ["0 9 * * 1-5", "0 9 * * *", "0 9 * * 1"];
  const [preset, setPreset] = useState(
    presets.includes(old?.cron || "0 9 * * 1-5")
      ? old?.cron || "0 9 * * 1-5"
      : "custom",
  );
  const [timezone, setTimezone] = useState(old?.timezone || "Asia/Taipei");
  const [enabled, setEnabled] = useState(old?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) feedback.current?.scrollIntoView({ block: "nearest" });
  }, [notice]);
  return (
    <Modal
      label={old ? uiText("編輯排程") : uiText("新增排程")}
      close={() => {
        if (!saving && !testing) close();
      }}
    >
      <section className="modal routine-modal">
        <header>
          <h2>{old ? uiText("編輯排程") : uiText("新增排程")}</h2>
          <button
            className="icon"
            aria-label={uiText("關閉排程")}
            disabled={saving || testing}
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </header>
        <form
          onChangeCapture={() => {
            setNotice("");
            setNoticeError(false);
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (saving || testing) return;
            setSaving(true);
            setNotice("");
            setNoticeError(false);
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
                  setNoticeError(true);
                  throw error;
                }
              });
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="routine-body">
            <fieldset disabled={saving || testing}>
              {notice && (
                <div
                  className="notice routine-feedback"
                  role={noticeError ? "alert" : "status"}
                  ref={feedback}
                >
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
              <label>
                {uiText("時間")}
                <select
                  value={preset}
                  onChange={(e) => {
                    setPreset(e.target.value);
                    setCron(
                      e.target.value === "custom"
                        ? presets.includes(cron)
                          ? "0 10 * * *"
                          : cron
                        : e.target.value,
                    );
                  }}
                >
                  <option value="0 9 * * 1-5">
                    {uiText("每個工作日 09:00")}
                  </option>
                  <option value="0 9 * * *">{uiText("每天 09:00")}</option>
                  <option value="0 9 * * 1">{uiText("每週一 09:00")}</option>
                  <option value="custom">{uiText("自訂 Cron")}</option>
                </select>
              </label>
              <div className="form-row">
                {preset === "custom" && (
                  <label>
                    Cron
                    <input
                      value={cron}
                      required
                      onChange={(e) => setCron(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  {uiText("時區")}
                  <input
                    required
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  />
                </label>
              </div>
              <details className="routine-work-settings">
                <summary>
                  {uiText("工作設定")}
                  <span>
                    {projectsLoading
                      ? uiText("載入中…")
                      : routineProject
                        ? projects.find(
                            (project) => project.id === routineProject,
                          )?.name || uiText("專案目前無法使用")
                        : uiText("一般對話")}
                  </span>
                  <Icon name="chevron-right" size={14} />
                </summary>
                <ProjectControls
                  projects={projects}
                  projectId={routineProject}
                  setProject={setRoutineProject}
                  branch={routineBranch}
                  setBranch={setRoutineBranch}
                  api={api}
                  showLabels
                />
              </details>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                {uiText("啟用排程（Apsis 需保持執行）")}
              </label>
              {old && (
                <div className="routine-test">
                  <button
                    type="button"
                    className="secondary"
                    disabled={saving || testing}
                    onClick={async () => {
                      if (saving || testing) return;
                      setTesting(true);
                      setNotice("");
                      setNoticeError(false);
                      try {
                        await save(async () => {
                          try {
                            await api(`/routines/${old.id}/test`, "POST", {});
                            setNotice(uiText("試跑已交辦，可回到對話查看。"));
                          } catch (error) {
                            setNotice((error as Error).message);
                            setNoticeError(true);
                            throw error;
                          }
                        });
                      } finally {
                        setTesting(false);
                      }
                    }}
                  >
                    {uiText(testing ? "處理中…" : "立即試跑")}
                  </button>
                  <p>{uiText("使用已儲存的內容試跑。")}</p>
                </div>
              )}
              {old && (
                <details className="routine-history">
                  <summary>
                    {uiText("執行紀錄（{0}）", [old.history.length])}
                  </summary>
                  <p className="routine-history-timezone">
                    {uiText("時區")} · {old.timezone}
                  </p>
                  {!old.history.length && <p>{uiText("尚無執行紀錄。")}</p>}
                  {[...old.history].reverse().map((history) => (
                    <RoutineHistoryEntry
                      key={history.jobId}
                      history={history}
                      job={jobsById.get(history.jobId)}
                      botId={botId}
                      timezone={old.timezone}
                    />
                  ))}
                </details>
              )}
            </fieldset>
          </div>
          <footer>
            <button
              type="button"
              className="secondary"
              onClick={close}
              disabled={saving || testing}
            >
              {uiText("取消")}
            </button>
            <button
              className="primary"
              type="submit"
              disabled={saving || testing}
            >
              {saving ? uiText("儲存中…") : uiText("儲存排程")}
            </button>
          </footer>
        </form>
      </section>
    </Modal>
  );
}
