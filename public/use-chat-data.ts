import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./chat-api.ts";
import { setSettingsLocale } from "./settings-locale.ts";
import type { Snapshot, BotDetail as Detail } from "../shared/api.ts";
import type { Settings as GlobalSettings } from "../shared/settings.ts";

/** Owns server data, SSE lifetime, stale-response guards and transcript pagination. */
export function useChatData() {
  const [state, setState] = useState<Snapshot>();
  const [approvalSettings, setApprovalSettings] = useState<GlobalSettings>();
  const approvalGeneration = useRef(0);
  const acceptApprovalSettings = useCallback((next: GlobalSettings) => {
    // File revisions are opaque hashes. Invalidate reads started before this save.
    approvalGeneration.current++;
    setApprovalSettings(next);
  }, []);
  const [detail, setDetail] = useState<Detail>();
  const [selected, setSelected] = useState<string | null>(() =>
    localStorage.getItem("apsis.bot"),
  );
  const [error, setError] = useState("");
  const [eventsConnected, setEventsConnected] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [networkOffline, setNetworkOffline] = useState(!navigator.onLine);
  const [syncError, setSyncError] = useState<{
    id: string | null;
    text: string;
  }>();
  const [retrying, setRetrying] = useState(false);
  const generation = useRef(0);
  const refreshPauses = useRef(0);
  const refreshControllers = useRef(new Set<AbortController>());
  const pauseRefresh = useCallback(() => {
    refreshPauses.current++;
    generation.current++;
    for (const controller of refreshControllers.current) controller.abort();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      refreshPauses.current--;
    };
  }, []);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const refresh = useCallback(async () => {
    if (refreshPauses.current) return;
    const version = ++generation.current;
    const settingsVersion = approvalGeneration.current;
    const id = selectedRef.current;
    const controller = new AbortController();
    refreshControllers.current.add(controller);
    const options = {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    };
    try {
      const [next, nextSettings, loadedDetail] = await Promise.all([
        api<Snapshot>("/state", "GET", undefined, options),
        api<GlobalSettings>("/settings", "GET", undefined, options),
        id
          ? api<Detail>(
              `/bots/${id}?view=summary`,
              "GET",
              undefined,
              options,
            ).catch((error) => {
              if (error.status === 404) return undefined;
              throw error;
            })
          : Promise.resolve(undefined),
      ]);
      const nextDetail =
        id && next.bots.some((bot) => bot.id === id) ? loadedDetail : undefined;
      if (version !== generation.current || id !== selectedRef.current) return;
      setSyncError(undefined);
      setState(next);
      if (settingsVersion === approvalGeneration.current) {
        setApprovalSettings(nextSettings);
        setSettingsLocale(nextSettings.locale);
      }
      setDetail((old) => {
        if (!old || !nextDetail || old.bot.id !== nextDetail.bot.id)
          return nextDetail;
        const first = nextDetail.session.messages[0]?.sequence ?? Infinity;
        const earlier = old.session.messages.filter(
          (m) => (m.sequence ?? Infinity) < first,
        );
        return {
          ...nextDetail,
          session: {
            ...nextDetail.session,
            messages: [...earlier, ...nextDetail.session.messages],
            olderCursor: earlier.length
              ? old.session.olderCursor
              : nextDetail.session.olderCursor,
          },
        };
      });
      if (!id && next.bots.length) setSelected(next.bots[0].id);
      if (id && !nextDetail) {
        selectedRef.current = null;
        setSelected(null);
        localStorage.removeItem("apsis.bot");
      }
    } catch (cause) {
      if (version === generation.current && id === selectedRef.current)
        setSyncError({
          id,
          text:
            (cause as Error).name === "TimeoutError"
              ? "同步逾時，請再試一次。"
              : cause instanceof TypeError
                ? "無法連接 Apsis，請確認網路與服務。"
                : (cause as Error).message,
        });
      throw cause;
    } finally {
      refreshControllers.current.delete(controller);
    }
  }, []);
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await refresh();
    } catch {
      /* The sync panel retains the recovery action. */
    } finally {
      setRetrying(false);
    }
  };
  const perform = async (fn: () => Promise<unknown>) => {
    try {
      setError("");
      await fn();
      await refresh().catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    let disposed = false;
    let syncing = false,
      syncAgain = false;
    const synchronize = async (changed = true) => {
      if (syncing) {
        if (changed) syncAgain = true;
        return;
      }
      syncing = true;
      try {
        do {
          syncAgain = false;
          await refresh().catch(() => {});
        } while (syncAgain && !disposed);
      } finally {
        syncing = false;
      }
    };
    void api("/bootstrap", "POST", {})
      .then(() => {
        if (!disposed) return synchronize(false);
      })
      .catch((e) => {
        if (!disposed)
          setSyncError({ id: selectedRef.current, text: e.message });
      });
    let events: EventSource;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disconnected = () => {
      setEventsConnected(false);
      setConnectionLost(true);
    };
    const connect = () => {
      events?.close();
      events = new EventSource("/api/v2/events");
      events.onopen = () => {
        setEventsConnected(true);
        setConnectionLost(false);
        void synchronize();
      };
      events.onerror = disconnected;
      events.onmessage = (event) => {
        // The welcome frame carries no change; onopen already requests a snapshot.
        if (event.data.trim() === "{}") return;
        if (timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          void synchronize();
        }, 160);
      };
    };
    const offline = () => {
      setNetworkOffline(true);
      events?.close();
      clearTimeout(timer);
      timer = undefined;
      disconnected();
    };
    const online = () => {
      setNetworkOffline(false);
      connect();
    };
    if (navigator.onLine) connect();
    else disconnected();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      disposed = true;
      generation.current++;
      for (const controller of refreshControllers.current) controller.abort();
      events?.close();
      clearTimeout(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [refresh]);
  return {
    state,
    setState,
    detail,
    setDetail,
    selected,
    setSelected,
    selectedRef,
    approvalSettings,
    acceptApprovalSettings,
    eventsConnected,
    connectionLost,
    networkOffline,
    syncError: syncError?.id === selected ? syncError.text : "",
    retrying,
    retry,
    refresh,
    pauseRefresh,
    perform,
    error,
    setError,
  };
}
