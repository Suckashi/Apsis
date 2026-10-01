import { useId, useState, type CSSProperties } from "react";
import { botAvatars, botAvatarSeries } from "../shared/bot-avatars.ts";
import { BrandMark } from "./avatar-mark.tsx";
import { uiText } from "./settings-dictionary.ts";
import { useSettingsLocale } from "./settings-locale.ts";

export function AvatarPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  useSettingsLocale();
  const groupId = useId();
  const [series, setSeries] = useState("all");
  const selected =
    botAvatars.find((avatar) => avatar.id === value) ?? botAvatars[0];
  return (
    <fieldset className="avatar-picker" disabled={disabled}>
      <legend className="visually-hidden">{uiText("Bot 圖示")}</legend>
      <section className="avatar-preview" aria-label={uiText("目前選擇的夥伴")}>
        <div
          className="avatar-preview-art"
          style={{ "--companion-color": selected.color } as CSSProperties}
        >
          <BrandMark avatar={selected.id} size={80} />
        </div>
        <div className="avatar-preview-copy" aria-live="polite">
          <strong>{uiText(selected.label)}</strong>
          <p>{uiText("會顯示在 Bot 名單與對話中。")}</p>
        </div>
      </section>
      <label className="avatar-series-filter" htmlFor={`${groupId}-series`}>
        <span id={`${groupId}-series-label`}>{uiText("頭像系列")}</span>
        <select
          id={`${groupId}-series`}
          aria-labelledby={`${groupId}-series-label`}
          value={series}
          onChange={(event) => setSeries(event.target.value)}
        >
          <option value="all">{uiText("全部系列")}</option>
          {botAvatarSeries.map((item) => (
            <option key={item.id} value={item.id}>
              {uiText(item.label)}
            </option>
          ))}
        </select>
      </label>
      {botAvatarSeries
        .filter((item) => series === "all" || item.id === series)
        .map((item) => (
          <section
            className="avatar-series"
            key={item.id}
            aria-label={uiText(item.label)}
          >
            <p className="avatar-series-title">{uiText(item.label)}</p>
            <div className="avatar-grid">
              {botAvatars
                .filter((avatar) => avatar.series === item.id)
                .map((avatar) => (
                  <label
                    key={avatar.id}
                    style={
                      { "--companion-color": avatar.color } as CSSProperties
                    }
                  >
                    <input
                      type="radio"
                      name={`bot-avatar-${groupId}`}
                      value={avatar.id}
                      checked={value === avatar.id}
                      onChange={() => onChange(avatar.id)}
                    />
                    <span>
                      <span className="avatar-stage">
                        <BrandMark avatar={avatar.id} size={52} />
                      </span>
                      <span className="avatar-label">
                        {uiText(avatar.label)}
                      </span>
                    </span>
                  </label>
                ))}
            </div>
          </section>
        ))}
    </fieldset>
  );
}
