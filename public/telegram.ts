import { t, locale, translateServerText } from "./i18n.ts";
import type { Api, TelegramView } from "../shared/types.ts";
import { $ } from "./dom.ts";
import { asError } from "../shared/errors.ts";

export function createTelegramUI(api: Api, notify: (text: string) => void) {
  let saving = false;
  let loaded = false;
  let revision = 0;
  const field = (name: string) => $<HTMLInputElement>("#telegram-" + name);
  const status = (text: string, error = false) => {
    $("#telegram-save-status").textContent = text;
    $("#telegram-save-status").classList.toggle("error", error);
  };
  function renderState(view: TelegramView) {
    const label = {
      disabled: t("未啟用"),
      connecting: t("連線中…"),
      connected: t("已連線"),
      error: t("連線需處理"),
    }[view.status];
    $("#telegram-state").textContent =
      label + (view.username ? " · @" + view.username : "");
    $("#telegram-owner").textContent = view.ownerId
      ? t("已綁定你的 Telegram 帳號 · ") + view.ownerId
      : t("尚未配對，只有配對後的帳號能使用工作區。");
    $("#telegram-error").textContent = translateServerText(view.error);
    $<HTMLButtonElement>("#telegram-pair").disabled =
      saving || view.status !== "connected" || !!view.ownerId;
    $<HTMLButtonElement>("#telegram-unpair").disabled = saving || !view.ownerId;
    $<HTMLButtonElement>("#telegram-test").disabled =
      saving || !view.configured;
    if (
      view.ownerId ||
      !view.pairingExpiresAt ||
      Date.parse(view.pairingExpiresAt) <= Date.now()
    )
      $("#telegram-pairing").hidden = true;
  }
  async function load() {
    if (saving) return;
    const current = revision;
    const view = await api<TelegramView>("channels/telegram");
    if (saving || current !== revision) return;
    renderState(view);
    if (!loaded) {
      field("enabled").checked = view.enabled;
      field("writes").checked = view.allowWrites;
      field("group").value = view.groupId;
      field("token").placeholder = view.configured
        ? t("留空保留已儲存的 Token")
        : t("貼上 BotFather 提供的 Token");
      $<HTMLFieldSetElement>("#telegram-fields").disabled = false;
      loaded = true;
    }
  }
  const post = <T>(path: string, data: unknown = {}) =>
    api<T>("channels/telegram" + path, {
      method: "POST",
      body: JSON.stringify(data),
    });
  async function action(fn: () => Promise<void>) {
    if (saving) return;
    saving = true;
    revision++;
    $<HTMLFieldSetElement>("#telegram-fields").disabled = true;
    for (const id of ["test", "pair", "unpair"])
      $<HTMLButtonElement>("#telegram-" + id).disabled = true;
    try {
      await fn();
    } catch (error) {
      status(asError(error).message, true);
    } finally {
      saving = false;
      $<HTMLFieldSetElement>("#telegram-fields").disabled = !loaded;
      await load().catch(() => {});
    }
  }
  $("#telegram-form").addEventListener("input", () =>
    status(t("變更尚未儲存。")),
  );
  field("clear").addEventListener("change", () => {
    field("token").disabled = field("clear").checked;
    if (field("clear").checked) {
      field("token").value = "";
      field("enabled").checked = false;
    }
  });
  $("#telegram-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void action(async () => {
      await post("", {
        token: field("clear").checked ? null : field("token").value.trim(),
        enabled: field("enabled").checked,
        allowWrites: field("writes").checked,
        groupId: field("group").value.trim(),
      });
      field("token").value = "";
      field("token").disabled = false;
      field("clear").checked = false;
      loaded = false;
      $("#telegram-pairing").hidden = true;
      status(t("設定已儲存。啟用後等候連線成功，再產生配對碼。"));
      notify(t("Bot 設定已儲存，不需重新啟動。"));
    });
  });
  $("#telegram-test").addEventListener(
    "click",
    () =>
      void action(async () => {
        status(t("正在測試連線…"));
        const result = await post<{ username: string }>("/test");
        status(t("已連接 @") + result.username + t("，Token 有效。"));
      }),
  );
  $("#telegram-pair").addEventListener(
    "click",
    () =>
      void action(async () => {
        const result = await post<{ command: string; expiresAt: string }>(
          "/pairing",
        );
        field("command").value = result.command;
        $("#telegram-pairing").hidden = false;
        $("#telegram-expiry").textContent =
          t("請私訊自己的 Bot 貼上此指令。配對碼在 ") +
          new Date(result.expiresAt).toLocaleTimeString(locale) +
          t(" 到期，只能使用一次。");
        status(t("配對指令已產生。"));
      }),
  );
  $("#telegram-unpair").addEventListener(
    "click",
    () =>
      void action(async () => {
        await post("/unpair");
        status(t("已解除綁定並停止 bot 任務；歷史對話仍保留在 Web。"));
      }),
  );
  $("#telegram-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(field("command").value);
      notify(t("已複製配對指令。"));
    } catch {
      field("command").select();
      status(t("請複製已選取的配對指令。"));
    }
  });
  setInterval(() => {
    if (!document.hidden && !$("#settings-view").hidden)
      void load().catch(() => {});
  }, 3000);
  return { load };
}
