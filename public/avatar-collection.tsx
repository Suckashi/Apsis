import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  botAvatars,
  botAvatarSeries,
  avatarAchievements,
  type AvatarCollection,
  type AvatarDraw,
  type AvatarDrawResponse,
} from "../shared/bot-avatars.ts";
import { BrandMark } from "./avatar-mark.tsx";
import { uiText, uiError } from "./settings-dictionary.ts";
import { useSettingsLocale } from "./settings-locale.ts";

interface PendingDraw {
  requestId: string;
  startedAt: string;
}
const pendingKey = "apsis.avatar.pending-draw";
function readPending(): PendingDraw | undefined {
  try {
    return (
      JSON.parse(sessionStorage.getItem(pendingKey) || "null") || undefined
    );
  } catch {
    return undefined;
  }
}
const CollectionContext = createContext<
  | {
      collection?: AvatarCollection;
      busy: boolean;
      revealing: boolean;
      pending: boolean;
      error: string;
      result?: AvatarDraw;
      draw: () => Promise<void>;
    }
  | undefined
>(undefined);

export function AvatarCollectionProvider({
  collection,
  accept,
  request,
  children,
}: {
  collection?: AvatarCollection;
  accept: (next: AvatarCollection) => void;
  request: (requestId: string) => Promise<AvatarDrawResponse>;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AvatarDraw>();
  const [pending, setPending] = useState(readPending);
  const inFlight = useRef(false);
  const unresolved = !!pending && pending.startedAt === collection?.startedAt;
  const remember = (value?: PendingDraw) => {
    setPending(value);
    if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value));
    else sessionStorage.removeItem(pendingKey);
  };
  const draw = async () => {
    if (!collection || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const current = unresolved
        ? pending!
        : {
            requestId: crypto.randomUUID(),
            startedAt: collection.startedAt,
          };
      // Persist before sending so a refresh can safely retry an uncertain result.
      remember(current);
      const response = await request(current.requestId);
      accept(response.avatarCollection);
      setResult(response.draw);
      remember(undefined);
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setRevealing(true);
        await new Promise((resolve) => setTimeout(resolve, 800));
        setRevealing(false);
      }
    } catch (reason) {
      const failure = reason as Error & { status?: number };
      if (failure.status && failure.status >= 400 && failure.status < 500)
        remember(undefined);
      setError(failure.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <CollectionContext.Provider
      value={{
        collection,
        busy,
        revealing,
        error,
        result,
        pending: unresolved,
        draw,
      }}
    >
      {children}
    </CollectionContext.Provider>
  );
}

const achievementLabels = {
  collaboration: "首次 Bot 協作",
  routine: "首次完成排程",
  delivery: "首次成果交付",
} as const;

export function AvatarPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  useSettingsLocale();
  const state = useContext(CollectionContext);
  const collection = state?.collection;
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [selectedSeries, setSelectedSeries] = useState("all");
  const groupId = useId();
  const owned = new Set(
    collection?.owned.map((a) => a.avatarId) ??
      botAvatars.filter((a) => a.series === "basic").map((a) => a.id),
  );
  const lastDraw = state?.result ?? collection?.lastDraw;
  const last = botAvatars.find((a) => a.id === lastDraw?.avatarId);
  const resultLabel = state?.result ? "這次抽到的夥伴" : "最近抽到的夥伴";
  const missing = Math.max(
    0,
    (collection?.drawCost ?? 30) - (collection?.balance ?? 0),
  );
  const visibleAvatars = botAvatars.filter(
    (avatar) =>
      (selectedSeries === "all" || avatar.series === selectedSeries) &&
      (!ownedOnly || owned.has(avatar.id)),
  );
  return (
    <fieldset className="avatar-picker collection-picker">
      <legend>{uiText("Bot 圖示")}</legend>
      <section className="collection-wallet" aria-label={uiText("頭像收藏")}>
        <div className="collection-companions" aria-hidden="true">
          <span>
            <BrandMark avatar="captain" size={38} />
          </span>
          <span>
            <BrandMark avatar="elf" size={44} />
          </span>
          <span>
            <BrandMark avatar="doctor" size={38} />
          </span>
        </div>
        <div className="collection-wallet-heading">
          <div>
            <span className="collection-eyebrow">{uiText("頭像收藏")}</span>
            <strong>
              {uiText("已收藏 {0} / {1}", [owned.size, botAvatars.length])}
            </strong>
          </div>
          <div className="collection-points" role="status" aria-live="polite">
            <strong>{collection?.balance ?? 0}</strong>
            <span>{uiText("點數")}</span>
          </div>
        </div>
        <div
          className="collection-progress"
          role="progressbar"
          aria-label={uiText("頭像收藏")}
          aria-valuenow={owned.size}
          aria-valuemin={0}
          aria-valuemax={botAvatars.length}
        >
          <span
            style={{ width: `${(owned.size / botAvatars.length) * 100}%` }}
          />
        </div>
        <p className="collection-invitation">
          {uiText("把小夥伴，一個個帶回家。")}
        </p>
        <button
          type="button"
          className="primary collection-draw"
          disabled={
            !collection ||
            state?.busy ||
            (!state?.pending && (!collection.remaining || missing > 0))
          }
          onClick={() => void state?.draw()}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />
          </svg>
          {state?.busy
            ? uiText(state.revealing ? "正在揭曉…" : "抽取中…")
            : state?.pending
              ? uiText("確認上次抽取結果")
              : collection?.remaining === 0
                ? uiText("已全部收藏")
                : uiText("抽一次 · {0} 點", [collection?.drawCost ?? 30])}
        </button>
        <p className="collection-hint">
          {state?.pending
            ? uiText("上次結果待確認，重試不會重複扣點。")
            : collection?.remaining === 0
              ? uiText("所有夥伴都到齊了，點數仍會繼續累積。")
              : missing > 0
                ? uiText("再累積 {0} 點，就能迎接新夥伴。", [missing])
                : uiText("每抽都是尚未擁有的新夥伴。")}
        </p>
        {!!collection?.remaining && (
          <p className="collection-odds">
            {uiText("剩餘 {0} 款 · 每款機率 1/{0}（{1}%）", [
              collection.remaining,
              (100 / collection.remaining).toFixed(2),
            ])}
          </p>
        )}
        <details className="collection-rules">
          <summary>{uiText("如何獲得點數")}</summary>
          <p>
            {uiText(
              "成功完成主要任務 +10 點；協作子任務不另計。舊任務不補算。",
            )}
          </p>
          <ul>
            {avatarAchievements.map((key) => (
              <li key={key}>
                <span>{uiText(achievementLabels[key])}</span>
                <span>
                  {collection?.achievements[key] ? uiText("已達成") : "+20"}
                </span>
              </li>
            ))}
          </ul>
          <p>
            {uiText(
              "首次獎勵各限一次，可同時達成。成果需成功交付檔案，上傳附件不計。",
            )}
          </p>
        </details>
        {state?.error && (
          <p role="alert" className="collection-error">
            {uiError(state.error)}
          </p>
        )}
      </section>
      {last && (
        <section
          key={lastDraw?.id}
          className={`collection-result ${state?.revealing ? "revealing" : ""}`}
          aria-label={uiText(resultLabel)}
          aria-busy={state?.revealing}
          aria-live="polite"
        >
          <span className="collection-result-art">
            <BrandMark avatar={last.id} size={64} />
          </span>
          <div>
            <span className="collection-eyebrow">{uiText(resultLabel)}</span>
            <strong>{uiText(last.label)}</strong>
            <span className="collection-result-balance">
              {uiText("剩餘 {0} 點", [collection?.balance ?? 0])}
            </span>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={state?.busy}
            onClick={() => onChange(last.id)}
          >
            {uiText(value === last.id ? "已選用" : "選用此頭像")}
          </button>
        </section>
      )}
      <div
        className="collection-filters"
        role="group"
        aria-label={uiText("頭像篩選")}
      >
        <button
          type="button"
          aria-pressed={!ownedOnly}
          onClick={() => setOwnedOnly(false)}
        >
          {uiText("全部")}
        </button>
        <button
          type="button"
          aria-pressed={ownedOnly}
          onClick={() => setOwnedOnly(true)}
        >
          {uiText("已擁有")}
        </button>
      </div>
      <label className="collection-series-filter">
        <span id={`${groupId}-series-label`}>{uiText("頭像系列")}</span>
        <select
          value={selectedSeries}
          onChange={(event) => setSelectedSeries(event.target.value)}
          aria-labelledby={`${groupId}-series-label`}
          aria-describedby={`${groupId}-pool-hint`}
        >
          <option value="all">{uiText("全部系列")}</option>
          {botAvatarSeries.map(({ id, label }) => (
            <option key={id} value={id}>
              {uiText(label)}
            </option>
          ))}
        </select>
      </label>
      <p className="collection-pool-hint" id={`${groupId}-pool-hint`}>
        {uiText("系列篩選僅影響顯示，抽取涵蓋所有未擁有款式。")}
      </p>
      {visibleAvatars.length === 0 && (
        <p className="collection-empty" role="status">
          {uiText("這個系列還沒有已擁有的夥伴。切換「全部」看看吧！")}
        </p>
      )}
      {botAvatarSeries.map(({ id, label }) => {
        const items = visibleAvatars.filter((a) => a.series === id);
        return items.length ? (
          <section
            key={id}
            className="collection-series"
            aria-label={uiText(label)}
          >
            <h4>
              {uiText(label)}
              <span>
                {items.filter((a) => owned.has(a.id)).length} /{" "}
                {botAvatars.filter((a) => a.series === id).length}
              </span>
            </h4>
            <div className="collection-grid">
              {items.map((avatar) => {
                const locked = !owned.has(avatar.id);
                return (
                  <label
                    key={avatar.id}
                    className={locked ? "collection-locked" : ""}
                    style={
                      { "--companion-color": avatar.color } as CSSProperties
                    }
                  >
                    <input
                      type="radio"
                      name={`bot-avatar-${groupId}`}
                      value={avatar.id}
                      checked={value === avatar.id}
                      disabled={locked}
                      onChange={() => onChange(avatar.id)}
                      aria-describedby={
                        locked ? `${groupId}-${avatar.id}` : undefined
                      }
                    />
                    <span>
                      <span className="collection-avatar-stage">
                        <BrandMark avatar={avatar.id} size={52} />
                      </span>
                      {value === avatar.id && (
                        <span
                          className="collection-selected-mark"
                          aria-hidden="true"
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 12 12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="m2.5 6 2.2 2.2 4.8-4.8" />
                          </svg>
                        </span>
                      )}
                      <span className="avatar-label">
                        {uiText(avatar.label)}
                      </span>
                      {locked && (
                        <span
                          className="collection-lock-label"
                          id={`${groupId}-${avatar.id}`}
                        >
                          <svg
                            width="10"
                            height="12"
                            viewBox="0 0 12 14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            aria-hidden="true"
                          >
                            <rect x="1.5" y="6" width="9" height="6.5" rx="2" />
                            <path d="M3.5 6V4a2.5 2.5 0 0 1 5 0v2" />
                          </svg>
                          {uiText("抽取獲得")}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        ) : null;
      })}
    </fieldset>
  );
}
