export function compatibleUrl(value: unknown): string {
  try {
    if (
      typeof value !== "string" ||
      value.length > 2048 ||
      /[\u0000-\u0020\u007f]/u.test(value)
    )
      throw new Error();
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    url.pathname = url.pathname
      .replace(/\/+$/, "")
      .replace(/\/chat\/completions$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw Object.assign(
      new Error(
        "Base URL 請使用不含帳密、查詢參數的 HTTP(S) 網址，例如 https://api.example.com/v1。",
      ),
      { status: 400 },
    );
  }
}
