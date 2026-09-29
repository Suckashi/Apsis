import { uiText, uiError } from "./settings-dictionary.ts";
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    path.startsWith("/api/") ? path : "/api/v2" + path,
    {
      method,
      headers: { "Content-Type": "application/json", "X-Apsis-Client": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.error ? uiError(data.error) : uiText("操作失敗")),
      {
        status: response.status,
      },
    );
  return data;
}
