import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./chat-api.ts";
import { setSettingsLocale } from "./settings-locale.ts";
import type { Snapshot, BotDetail as Detail } from "../shared/api.ts";
import type { Settings as GlobalSettings } from "../shared/settings.ts";

/** Owns server data, SSE lifetime, stale-response guards and transcript pagination. */
export function useChatData() {
  useEffect(() => {
    let cancelled = false;
    void api<GlobalSettings>("/settings")
      .then((settings) => {
        if (!cancelled) setSettingsLocale(settings.locale);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
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
  const generation = useRef(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    const settingsVersion = approvalGeneration.current;
    const id = selectedRef.current;
    const [next, nextSettings, loadedDetail] = await Promise.all([
      api<Snapshot>("/state"),
      api<GlobalSettings>("/settings"),
      id
        ? api<Detail>(`/bots/${id}?view=summary`).catch((error) => {
            if (error.status === 404) return undefined;
            throw error;
          })
        : Promise.resolve(undefined),
    ]);
    const nextDetail =
      id && next.bots.some((bot) => bot.id === id) ? loadedDetail : undefined;
    if (version !== generation.current || id !== selectedRef.current) return;
    setState((previous) =>
      previous &&
      previous.avatarCollection.revision > next.avatarCollection.revision
        ? { ...next, avatarCollection: previous.avatarCollection }
        : next,
    );
    if (settingsVersion === approvalGeneration.current)
      setApprovalSettings(nextSettings);
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
  }, []);
  const perform = async (fn: () => Promise<unknown>) => {
    try {
      setError("");
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    let disposed = false;
    void api("/bootstrap", "POST", {})
      .then(() => {
        if (!disposed) return refresh();
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
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
        void refresh().catch((e) => setError(e.message));
      };
      events.onerror = disconnected;
      events.onmessage = () => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          void refresh().catch((e) => setError(e.message));
        }, 160);
      };
    };
    const offline = () => {
      events?.close();
      clearTimeout(timer);
      timer = undefined;
      disconnected();
    };
    if (navigator.onLine) connect();
    else disconnected();
    window.addEventListener("offline", offline);
    window.addEventListener("online", connect);
    return () => {
      disposed = true;
      generation.current++;
      events?.close();
      clearTimeout(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", connect);
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
    refresh,
    perform,
    error,
    setError,
  };
}
