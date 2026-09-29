import { setTimeout as delay } from "node:timers/promises";

/** Retry only a model request, never the agent loop or a tool operation. */
export function retryableModelError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as {
      status?: number;
      code?: string;
      name?: string;
      message?: string;
      cause?: unknown;
    };
    if (e.name === "AbortError" || ["EACCES", "EPERM"].includes(e.code || ""))
      return false;
    if (typeof e.status === "number")
      return [408, 429, 500, 502, 503, 504, 529].includes(e.status);
    current = e.cause;
  }
  return [...seen].some((value) => {
    const e = value as { code?: string; message?: string };
    return (
      /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT/.test(
        e.code || "",
      ) ||
      /connection error|fetch failed|socket hang up|connection reset|request timed out/i.test(
        e.message || "",
      )
    );
  });
}

export function retryDelay(error: unknown, attempt: number): number {
  const headers = (error as { headers?: Headers | Record<string, string> })
    ?.headers;
  const read = (name: string) =>
    headers instanceof Headers ? headers.get(name) : headers?.[name];
  const ms = read("retry-after-ms");
  const after = read("retry-after");
  const requested = ms
    ? Number(ms)
    : after
      ? Number.isFinite(Number(after))
        ? Number(after) * 1000
        : Date.parse(after) - Date.now()
      : NaN;
  return Math.min(
    30_000,
    Math.max(
      0,
      Number.isFinite(requested) ? requested : 500 * 2 ** (attempt - 1),
    ),
  );
}

export async function retryModel<T>(
  invoke: () => Promise<T>,
  options: {
    signal: AbortSignal;
    outputVersion: () => number;
    onRetry: (attempt: number, milliseconds: number) => Promise<void>;
    wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<T> {
  const initialOutput = options.outputVersion();
  for (let attempt = 0; ; attempt++) {
    options.signal.throwIfAborted();
    try {
      return await invoke();
    } catch (error) {
      options.signal.throwIfAborted();
      // Partial streamed replies cannot safely be appended a second time.
      if (
        attempt >= 3 ||
        options.outputVersion() !== initialOutput ||
        !retryableModelError(error)
      )
        throw error;
      const milliseconds = retryDelay(error, attempt + 1);
      await options.onRetry(attempt + 1, milliseconds);
      await (
        options.wait ||
        (async (ms, signal) => {
          await delay(ms, undefined, { signal });
        })
      )(milliseconds, options.signal);
    }
  }
}
