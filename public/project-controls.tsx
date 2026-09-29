import { useEffect, useRef, useState } from "react";
import type { Project } from "../shared/types.ts";
import { uiText as text } from "./settings-dictionary.ts";
import { useSettingsLocale } from "./settings-locale.ts";
export function ProjectControls({
  projects,
  projectId,
  setProject,
  branch,
  setBranch,
  api,
  showLabels = false,
}: {
  projects: Project[];
  projectId: string;
  setProject: (v: string) => void;
  branch: string;
  setBranch: (v: string) => void;
  api: API;
  showLabels?: boolean;
}) {
  useSettingsLocale();
  const previousProject = useRef(projectId);
  const [branches, setBranches] = useState<string[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const initial = previousProject.current === projectId;
    previousProject.current = projectId;
    setError("");
    setBranches([]);
    if (projectId)
      void api<{ branch: string; branches: string[] }>(
        `/projects/${projectId}/git`,
      )
        .then((r) => {
          if (live) {
            setBranches(r.branches);
            setBranch(
              initial && r.branches.includes(branch) ? branch : r.branch,
            );
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    else setBranch("");
    return () => {
      live = false;
    };
  }, [projectId]);
  return (
    <div className="cw-project-controls">
      <label>
        <span className={showLabels ? "" : "visually-hidden"}>
          {text("工作位置")}
        </span>
        <select
          aria-label={text("工作位置")}
          value={projectId}
          onChange={(e) => setProject(e.target.value)}
        >
          <option value="">{text("一般對話")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {projectId && (
        <label>
          <span className={showLabels ? "" : "visually-hidden"}>
            {text("起始分支")}
          </span>
          <select
            aria-label={text("起始分支")}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

type API = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
