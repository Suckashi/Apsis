import type { Api, Project, SessionView } from "../shared/types.ts";
import { asError } from "../shared/errors.ts";
export function createProjectsUI(
  api: Api,
  session: () => SessionView | null,
  busy: () => boolean,
  changed: () => Promise<void>,
  fresh: () => Promise<void>,
  notify: (s: string) => void,
) {
  const select = document.querySelector<HTMLSelectElement>("#chat-project")!;
  const add = document.querySelector<HTMLButtonElement>("#project-add")!;
  const newChat =
    document.querySelector<HTMLButtonElement>("#project-new-chat")!;
  const dialog = document.querySelector<HTMLDialogElement>("#project-dialog")!;
  const form = document.querySelector<HTMLFormElement>("#project-form")!;
  const message = document.querySelector<HTMLElement>("#project-status")!;
  let projects: Project[] = [];
  function sync() {
    const current = session();
    if (current) select.value = current.project?.id || "workspace";
    select.disabled = !!current || busy();
    add.hidden = !!current;
    add.disabled = busy();
    newChat.hidden = !current;
    newChat.disabled = busy();
    const project =
      current?.project || projects.find((p) => p.id === select.value);
    select.title = project?.path || "專案資料夾";
    document.querySelector<HTMLElement>("#project-path")!.textContent =
      project?.path || "預設工作區";
  }
  async function load(preferred?: string) {
    const previous = preferred || select.value || "workspace";
    projects = await api<Project[]>("projects");
    const snapshot = session()?.project;
    if (snapshot && !projects.some((p) => p.id === snapshot.id))
      projects.push(snapshot);
    select.replaceChildren(...projects.map((p) => new Option(p.name, p.id)));
    select.value = projects.some((p) => p.id === previous)
      ? previous
      : "workspace";
    sync();
  }
  select.onchange = () => {
    sync();
    void changed().catch((e) => notify(asError(e).message));
  };
  newChat.onclick = () => void fresh().catch((e) => notify(asError(e).message));
  add.onclick = () => {
    form.reset();
    message.textContent = "";
    dialog.showModal();
  };
  document.querySelector<HTMLButtonElement>("#project-cancel")!.onclick = () =>
    dialog.close();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    submit.disabled = true;
    try {
      const value = new FormData(form);
      const project = await api<Project>("projects", {
        method: "POST",
        body: JSON.stringify({
          name: value.get("name"),
          path: value.get("path"),
        }),
      });
      await load(project.id);
      dialog.close();
      await changed();
      notify("專案已加入，新對話會使用這個資料夾。");
    } catch (e) {
      message.textContent = asError(e).message;
    } finally {
      submit.disabled = false;
    }
  };
  return { load, sync, selected: () => select.value || "workspace" };
}
