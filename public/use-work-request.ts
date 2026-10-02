import { useRef, useState } from "react";
import { api } from "./chat-api.ts";

type Request = {
  requestId: string;
  prompt: string;
  sessionId?: string;
  runId?: string;
};
/** Keep an ambiguous submission's exact identity across retries and reloads. */
export function useWorkRequest(
  key: string,
  path: string,
  receiptPath: (request: Request) => string,
) {
  const storageKey = `apsis.work-request.${key}`;
  const [pending, setPending] = useState<Request | undefined>(() => {
    try {
      return (
        JSON.parse(sessionStorage.getItem(storageKey) || "null") || undefined
      );
    } catch {
      return undefined;
    }
  });
  const current = useRef(pending);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const save = (value?: Request) => {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
    else sessionStorage.removeItem(storageKey);
    current.current = value;
    setPending(value);
  };
  return {
    pending,
    busy,
    async send(input: Omit<Request, "requestId">) {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      try {
        const retry = current.current;
        const request = retry || { ...input, requestId: crypto.randomUUID() };
        save(request);
        if (retry) {
          try {
            await api(receiptPath(request));
            save();
            return true;
          } catch (error) {
            // Unavailable receipt is ambiguous. Only authoritative absence permits replay.
            if ((error as { status?: number }).status !== 404) throw error;
          }
        }
        try {
          await api(path, "POST", request);
        } catch (error) {
          // Validation/permission rejection is authoritative and has no receipt.
          if ([400, 403].includes((error as { status?: number }).status || 0))
            save();
          throw error;
        }
        save();
        return true;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
  };
}
