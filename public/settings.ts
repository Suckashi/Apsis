import type {
  Api,
  CredentialState,
  SettingsView,
  Provider,
} from "../shared/types.ts";
type Section = "pi" | "hermes";
import { asError } from "../shared/errors.ts";
import { $ } from "./dom.ts";

export function createSettingsUI({
  api,
  onSaved,
  notify,
}: {
  api: Api;
  onSaved: () => Promise<void>;
  notify: (text: string) => void;
}) {
  let saved: SettingsView;
  let loading = false;
  const active = new Set<Section>();
  function credentialHint(credential: CredentialState | undefined) {
    if (!credential?.configured) return "尚未設定金鑰。填入後按下儲存。";
    return (
      (credential.source === "environment"
        ? "已由環境設定載入金鑰。"
        : "已儲存金鑰。") + "留空可保留；輸入新值可更換。"
    );
  }
  function status(section: Section, message: string, error = false) {
    const el = $("#" + section + "-save-status");
    el.textContent = message;
    el.classList.toggle("error", error);
  }
  function piFields(provider: string, model?: string) {
    const options = $("#pi-model-options");
    options.replaceChildren();
    for (const item of saved.models[provider] || []) {
      const option = document.createElement("option");
      option.value = item.id;
      option.label = item.name;
      options.append(option);
    }
    $("#pi-model").value = model || saved.defaults[provider as Provider] || "";
    $("#pi-api-key").value = "";
    $("#pi-api-key").disabled = false;
    $("#pi-clear-key").checked = false;
    const credential = saved.pi.credentials[provider as Provider];
    $("#pi-key-help").textContent = credentialHint(credential);
    $("#pi-api-key").placeholder = credential?.configured
      ? "留空保留目前金鑰"
      : "貼上你的 API key";
  }
  function render(section: Section) {
    if (section === "pi") {
      $("#pi-provider").value = saved.pi.provider;
      piFields(saved.pi.provider, saved.pi.model);
    } else {
      $("#hermes-url").value = saved.hermes.url;
      $("#hermes-model").value = saved.hermes.model;
      $("#hermes-api-key").value = "";
      $("#hermes-api-key").disabled = false;
      $("#hermes-clear-key").checked = false;
      $("#hermes-key-help").textContent = credentialHint(
        saved.hermes.credential,
      );
      $("#hermes-api-key").placeholder = saved.hermes.credential.configured
        ? "留空保留目前金鑰"
        : "貼上 gateway API key";
    }
  }
  async function load() {
    if (loading || active.size) return;
    loading = true;
    for (const section of ["pi", "hermes"] as const)
      $<HTMLFieldSetElement>("#" + section + "-settings-fields").disabled =
        true;
    try {
      saved = await api<SettingsView>("settings");
      for (const section of ["pi", "hermes"] as const) {
        render(section);
        status(section, "");
        $<HTMLFieldSetElement>("#" + section + "-settings-fields").disabled =
          false;
      }
    } catch (caught) {
      const error = asError(caught);
      for (const section of ["pi", "hermes"] as const) {
        status(section, "無法載入設定，請重新載入。", true);
        $<HTMLFieldSetElement>("#" + section + "-settings-fields").disabled =
          !saved;
      }
      throw error;
    } finally {
      loading = false;
    }
  }
  $("#pi-provider").addEventListener("change", () => {
    const provider = $("#pi-provider").value;
    piFields(
      provider,
      provider === saved.pi.provider
        ? saved.pi.model
        : saved.defaults[provider as Provider],
    );
    status("pi", "變更尚未儲存。");
  });
  for (const section of ["pi", "hermes"] as const) {
    const form = $("#" + section + "-settings-form");
    form.addEventListener("input", () => status(section, "變更尚未儲存。"));
    $<HTMLInputElement>("#" + section + "-clear-key").addEventListener(
      "change",
      (event) => {
        const input = $<HTMLInputElement>("#" + section + "-api-key");
        input.disabled = (event.currentTarget as HTMLInputElement).checked;
        input.value = "";
        status(
          section,
          (event.currentTarget as HTMLInputElement).checked
            ? "儲存後將停用目前金鑰，也不會使用環境設定中的金鑰。"
            : "變更尚未儲存。",
        );
      },
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!saved || active.has(section) || loading) return;
      const input: Record<string, string | null> =
        section === "pi"
          ? {
              provider: $("#pi-provider").value,
              model: $("#pi-model").value.trim(),
            }
          : {
              url: $("#hermes-url").value.trim(),
              model: $("#hermes-model").value.trim(),
            };
      const key = $<HTMLInputElement>("#" + section + "-api-key").value.trim();
      if ($<HTMLInputElement>("#" + section + "-clear-key").checked)
        input.apiKey = null;
      else if (key) input.apiKey = key;
      active.add(section);
      $<HTMLFieldSetElement>("#" + section + "-settings-fields").disabled =
        true;
      status(section, "正在儲存…");
      try {
        const next = await api<SettingsView>("settings/" + section, {
          method: "POST",
          body: JSON.stringify(input),
        });
        // Keep the other form's unsaved draft untouched.
        if (section === "pi") saved.pi = next.pi;
        else saved.hermes = next.hermes;
        render(section);
        status(section, "設定已儲存，下一次任務立即生效。");
        notify("設定已儲存，不需重新啟動。");
        await onSaved().catch((error: unknown) =>
          notify(asError(error).message),
        );
      } catch (caught) {
        const error = asError(caught);
        status(section, error.message, true);
      } finally {
        active.delete(section);
        $<HTMLFieldSetElement>("#" + section + "-settings-fields").disabled =
          false;
      }
    });
  }
  $("#refresh-status").addEventListener("click", async () => {
    if (loading || active.size) return;
    try {
      await load();
      await onSaved();
      notify("已重新載入設定。");
    } catch (caught) {
      const error = asError(caught);
      notify(error.message);
    }
  });
  return { load };
}
