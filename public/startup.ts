/** Keep the standalone recovery screen when the interface styles did not arrive. */
export function mountWithStyles(mount: () => void) {
  const ready = ["bot.css", "providers.css", "files.css"].every((file) => {
    const link = document.querySelector<HTMLLinkElement>(
      `link[href="/${file}"]`,
    );
    try {
      return !!link?.sheet?.cssRules.length;
    } catch {
      return false;
    }
  });
  if (ready) {
    mount();
    return;
  }
  const status = document.querySelector("#apsis-boot [role='status']");
  if (status) {
    const zh = status.querySelector(".boot-zh");
    const en = status.querySelector(".boot-en");
    if (zh) zh.textContent = "畫面載入不完整";
    if (en) en.textContent = "The interface did not load completely";
  }
  const retry = document.getElementById("boot-retry");
  if (retry) {
    const zh = retry.querySelector("p .boot-zh");
    const en = retry.querySelector("p .boot-en");
    if (zh) zh.textContent = "請重新載入，恢復完整介面。";
    if (en) en.textContent = "Reload to restore the complete interface.";
    retry.hidden = false;
  }
}
