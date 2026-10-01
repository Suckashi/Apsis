// Apply saved appearance before the larger application arrives.
try {
  const theme = localStorage.getItem("apsis.theme");
  document.documentElement.dataset.theme =
    theme === "dark" || theme === "light"
      ? theme
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  if (localStorage.getItem("apsis.locale") === "en")
    document.documentElement.lang = "en";
} catch {
  /* The system appearance remains usable without browser storage. */
}
setTimeout(() => {
  const retry = document.getElementById("boot-retry");
  if (retry) retry.hidden = false;
}, 10000);
