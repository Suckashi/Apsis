import type { BotAvatarId } from "../shared/bot-avatars.ts";

// Leave room for long ears without changing the underlying body or eye shapes.
export const friendBodyTransforms: Partial<Record<BotAvatarId, string>> = {
  usagi: "translate(3.2 6) scale(.8)",
  melody: "translate(3.2 6) scale(.8)",
  pikachu: "translate(2.4 4.2) scale(.85)",
  eevee: "translate(2.4 4.2) scale(.85)",
  cinnamoroll: "translate(4.8 3.2) scale(.7 .85)",
};

// Keep every costume on the original 32 px silhouettes, clear of the two eyes.
export const friendShapes = {
  anya: "bloom",
  yor: "bean",
  loid: "cube",
  bond: "cloud",
  tanjiro: "cube",
  nezuko: "bean",
  zenitsu: "spark",
  inosuke: "orbit",
  shinobu: "bloom",
  naruto: "spark",
  sasuke: "bean",
  sakura: "bloom",
  kakashi: "cube",
  gaara: "bean",
  pikachu: "orbit",
  eevee: "bean",
  snorlax: "cube",
  psyduck: "orbit",
  gengar: "bloom",
  chiikawa: "orbit",
  hachiware: "cube",
  usagi: "bean",
  momonga: "cloud",
  kurimanju: "cube",
  kitty: "cube",
  melody: "orbit",
  kuromi: "bloom",
  cinnamoroll: "cloud",
  pompompurin: "orbit",
  pochacco: "bean",
} as const satisfies Partial<Record<BotAvatarId, BotAvatarId>>;

function Bow({ color = "#cc778d", y = 25 }: { color?: string; y?: number }) {
  return (
    <g fill={color} transform={`translate(16 ${y})`}>
      <path d="M0 0-5-2.5q-1-.5-1 1v3q0 1.5 1 1Z M0 0l5-2.5q1-.5 1 1v3q0 1.5-1 1Z" />
      <circle r="1.5" />
    </g>
  );
}

function Headband({ color = "#666781" }: { color?: string }) {
  return (
    <>
      <path d="M4 6q12-3 24 0v4Q16 8 4 10Z" fill={color} />
      <rect x="10" y="5.5" width="12" height="4" rx="1.3" fill="#dce0df" />
      <path
        d="M14 8q-1.5-2 1-2 2 0 2 1.3 0 1.4-2 1.1m2-1 2 .6"
        fill="none"
        stroke="#77888b"
        strokeWidth=".8"
        strokeLinecap="round"
      />
    </>
  );
}

export function FriendCostume({
  avatar,
  layer,
}: {
  avatar: BotAvatarId;
  layer: "back" | "front";
}) {
  if (layer === "back") {
    switch (avatar) {
      case "bond":
        return (
          <path
            d="M8 7Q0 3 1 13q0 7 6 5m17-11q8-4 7 6 0 7-6 5"
            fill="#c9c4ba"
          />
        );
      case "gaara":
        return (
          <path
            d="M25 14q-5-6 0-9 5-2 6 3 0 3-2 5 5 7 1 13-5 4-8-1-2-6 3-11Z"
            fill="#c6aa79"
          />
        );
      case "pikachu":
        return (
          <>
            <path
              d="M6 11Q0 2 2 0q7 0 9 10m10 0q2-10 9-10 2 2-4 11"
              fill="#f3d773"
            />
            <path
              d="M2 0q4 0 6 4L4 6Q1 2 2 0m28 0q1 2-2 6l-4-2q2-4 6-4"
              fill="#666075"
            />
          </>
        );
      case "eevee":
        return (
          <>
            <path
              d="M8 12Q0 7 1 1q8 0 11 10m9 0Q23 2 30 1q2 8-6 12"
              fill="#caa17e"
            />
            <path
              d="M7 9 4 4l5 3m14 2 4-5-1 5"
              stroke="#8c6856"
              strokeWidth="2.3"
              strokeLinecap="round"
            />
          </>
        );
      case "snorlax":
        return <path d="M4 10 3 1l9 5m9 0 8-5-1 10" fill="#709da6" />;
      case "gengar":
        return <path d="M5 11 1 1l10 5 5-5 4 5 11-5-4 12" fill="#937bb9" />;
      case "chiikawa":
        return (
          <g fill="#eee4d7">
            <circle cx="6" cy="5" r="4.5" />
            <circle cx="26" cy="5" r="4.5" />
          </g>
        );
      case "hachiware":
        return <path d="M4 11 3 1q5 0 9 6m9 0q4-6 8-6l-1 11" fill="#9abbd6" />;
      case "usagi":
        return (
          <>
            <path
              d="M7 10Q1-1 6 0q5 0 6 10m8 0Q19-1 24 0q5 1 2 11"
              fill="#f1dfb0"
            />
            <path
              d="m7 3 2 4m14-4v4"
              stroke="#deba9a"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </>
        );
      case "momonga":
        return (
          <>
            <path d="M23 24q9-8 8 1-2 8-11 5" fill="#a6b5d0" />
            <g fill="#a6b5d0">
              <circle cx="6" cy="5" r="5" />
              <circle cx="26" cy="5" r="5" />
            </g>
          </>
        );
      case "kitty":
        return <path d="M4 11 3 1q5 0 10 7m7 0q5-7 9-7l-1 11" fill="#eee7dd" />;
      case "melody":
        return (
          <path
            d="M7 10Q1-1 7 0q5 0 5 10m8 0Q18 0 24 0q6 0 5 4l-4 2v5"
            fill="#ebacc3"
          />
        );
      case "kuromi":
        return (
          <>
            <path d="M5 13 1 2l12 5m6 0L31 2l-5 12" fill="#686077" />
            <g fill="#686077">
              <circle cx="2" cy="2" r="1.7" />
              <circle cx="30" cy="2" r="1.7" />
            </g>
          </>
        );
      case "cinnamoroll":
        return (
          <path
            d="M8 9Q1 6 0 16q0 8 5 7l5-6m14-8q7-3 8 7 0 8-5 7l-5-6"
            fill="#c5dfed"
          />
        );
      case "pompompurin":
        return (
          <path
            d="M7 9Q1 5 0 15q0 8 5 7l4-8m16-5q6-4 7 6 0 8-5 7l-4-8"
            fill="#e4c784"
          />
        );
      case "pochacco":
        return (
          <path
            d="M7 7Q0 1 0 11q0 9 5 8l4-7m16-5q7-6 7 4 0 9-5 8l-4-7"
            fill="#656375"
          />
        );
      default:
        return null;
    }
  }
  switch (avatar) {
    case "anya":
      return (
        <>
          <path d="M6 9Q8 0 16 3q8-3 11 6l-7-2-4 3-3-4-3 3Z" fill="#d587a6" />
          <path
            d="M3 9 6 2l5 6m10 0 5-6 3 7"
            fill="#676071"
            stroke="#e8c985"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <Bow color="#b86678" />
        </>
      );
    case "yor":
      return (
        <>
          <path
            d="M5 10Q8-1 21 2q7 1 7 9l-5-4-4-3q-1 5-5 6l-1-5-4 5Z"
            fill="#615a71"
          />
          <path
            d="M6 8q9-10 20-2"
            fill="none"
            stroke="#e1bd73"
            strokeWidth="1.4"
          />
          <g fill="#e9cb8d">
            <circle cx="26" cy="7" r="3" />
            <circle cx="23" cy="6" r="2" />
            <path d="m27 9 2 8-3-2Z" />
          </g>
          <path d="m12 26 4-3 4 3-4 3Z" fill="#a56779" />
        </>
      );
    case "loid":
      return (
        <>
          <path
            d="M4 10Q4 0 18 2q10-2 11 6l-8-3-4 5 1-5-7 5 1-4Z"
            fill="#e1cc91"
          />
          <path d="m9 23 7 3 7-3-3 6h-8Z" fill="#f2eddf" />
          <path d="m16 24 2 3-2 4-2-4Z" fill="#a56e72" />
        </>
      );
    case "bond":
      return (
        <>
          <path d="M7 9q0-7 5-4 4-6 7-1 6-3 6 4" fill="#f3ecdf" />
          <Bow color="#656173" />
        </>
      );
    case "tanjiro":
      return (
        <>
          <path d="M4 9 6 3l4 1 3-4 4 3 6-2 5 7-9-3-4 4-4-3Z" fill="#78505c" />
          <path
            d="m8 23 4-1v4H8Zm4 3h4v4h-4Zm4-4h4v4h-4Zm4 4h4v4h-4Z"
            fill="#496c65"
          />
          <path d="M4 16v5m24-5v5" stroke="#f4eadb" strokeWidth="2.4" />
        </>
      );
    case "nezuko":
      return (
        <>
          <path
            d="M5 10Q7-1 21 2q8 1 7 10l-5-6-4-2q-2 5-5 6l-1-5-5 6Z"
            fill="#69576b"
          />
          <g transform="translate(23 6) scale(.5)">
            <Bow color="#edb4c3" y={0} />
          </g>
          <rect x="8" y="22" width="16" height="5" rx="2.3" fill="#89b493" />
          <path d="M12 22v5m8-5v5" stroke="#628a70" strokeWidth="1" />
        </>
      );
    case "zenitsu":
      return (
        <>
          <path d="m16 1 5 8-5-3-3 3-2-3-2 3Z" fill="#dc9b54" />
          <path d="m8 23 2-3 2 3Zm6 4 2-3 2 3Zm6-4 2-3 2 3Z" fill="#fff0cf" />
        </>
      );
    case "inosuke":
      return (
        <>
          <path d="M5 9 3 1l8 5m10 0 8-5-2 8" fill="#91acc6" />
          <path
            d="m5 5 2 3m20-3-2 3"
            stroke="#d6a7b5"
            strokeWidth="2.3"
            strokeLinecap="round"
          />
          <ellipse cx="16" cy="24" rx="6" ry="3.8" fill="#ddb1bb" />
          <path
            d="M14 23v1m4-1v1"
            stroke="#a87490"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path d="m8 22 1 4 2-2m10 0 2 2 1-4" fill="#f3ede0" />
        </>
      );
    case "shinobu":
      return (
        <>
          <path d="M5 10Q8 0 18 3q9-2 10 7l-7-4-5 3-2-4-5 5Z" fill="#716080" />
          <g transform="translate(25 5)">
            <path
              d="M0 1q-7-8-7-2 0 4 6 5m1-3q7-8 7-2 0 4-6 5"
              fill="#a8cbbb"
              stroke="#715f84"
              strokeWidth="1"
            />
            <path d="M0 0v4" stroke="#715f84" strokeWidth="1.4" />
          </g>
          <path d="m7 24 9 4 9-4-3 6H10Z" fill="#e4eadd" />
        </>
      );
    case "naruto":
      return (
        <>
          <path d="m7 7 1-5 5 2 3-4 3 4 5-2 1 5" fill="#edcd6e" />
          <Headband />
          <path
            d="m6 21 3 1m-3 2 3 1m14-3 3-1m-3 4 3-1"
            stroke="#bd845b"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </>
      );
    case "sasuke":
      return (
        <>
          <path
            d="M4 9 3 4l5 1 3-5 5 3 6-2 7 7-7-2-4 3-4-3-5 4Z"
            fill="#59637e"
          />
          <Headband color="#616d93" />
          <path d="m10 24 6 2 6-2v5l-6 2-6-2Z" fill="#68769d" />
        </>
      );
    case "sakura":
      return (
        <>
          <path d="M5 10Q8-1 16 3q8-4 12 7l-7-4-5 4-4-4-4 5Z" fill="#d98da8" />
          <path
            d="M7 5q9-5 18 0"
            stroke="#a76379"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path d="m12 26 4-2 4 2-4 3Z" fill="#a45e78" />
        </>
      );
    case "kakashi":
      return (
        <>
          <path d="m3 8 3-6 4 1 3-3 3 3 5-3 2 4 6 2-7 5Z" fill="#e2e4df" />
          <Headband color="#626d7e" />
          <path d="M5 20q11 3 22 0l-1 6q-10 8-20 0Z" fill="#646e81" />
        </>
      );
    case "gaara":
      return (
        <>
          <path
            d="M4 10 5 5l5-1 2-4 5 3 6-1 5 6-7-2-5 4-4-4-5 5Z"
            fill="#ab6865"
          />
          <path d="M26 8h4m-4 3h4" stroke="#a07d61" strokeWidth="1.3" />
          <path d="m9 27 14-7 2 3-13 7Z" fill="#eee2c7" />
        </>
      );
    case "pikachu":
      return (
        <g fill="#df9280">
          <circle cx="6" cy="21" r="2.3" />
          <circle cx="26" cy="21" r="2.3" />
        </g>
      );
    case "eevee":
      return (
        <path
          d="m5 22 5 2 2-2 4 3 4-3 2 2 5-2-3 7-4-1-4 3-4-3-4 1Z"
          fill="#f0dfbd"
        />
      );
    case "snorlax":
      return <path d="M7 25q0-6 9-5 9-1 9 5v2q-9 5-18 0Z" fill="#eee0bc" />;
    case "psyduck":
      return (
        <>
          <path
            d="m13 5-2-4m5 4V1m3 4 2-4"
            stroke="#867666"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path d="M9 22q7-3 14 0 4 6-7 6T9 22Z" fill="#e0ba82" />
        </>
      );
    case "gengar":
      return (
        <>
          <path d="m9 7 3-5 4 4 4-4 3 5" fill="#937bb9" />
          <path d="m10 24 2 4 2-4m4 0 2 4 2-4" fill="#eee3ef" />
        </>
      );
    case "chiikawa":
      return (
        <>
          <g fill="#e0bdba">
            <circle cx="6" cy="5" r="2" />
            <circle cx="26" cy="5" r="2" />
          </g>
          <path d="m11 26 5-2 5 2-5 3Z" fill="#e3b5c3" />
        </>
      );
    case "hachiware":
      return (
        <path
          d="M4 10 5 5q6-5 11-1 7-4 12 2v4l-6-2-6-3-5 5-1-4Z"
          fill="#9abbd6"
        />
      );
    case "usagi":
      return (
        <path
          d="M12 25q4 3 8 0"
          fill="none"
          stroke="#dbc291"
          strokeWidth="2.3"
          strokeLinecap="round"
        />
      );
    case "momonga":
      return (
        <>
          <path d="M7 8q2-7 7-4l2 3 2-3q5-3 7 4l-5-1-4 3-4-3Z" fill="#a6b5d0" />
          <path d="M11 26q5-5 10 0l-5 3Z" fill="#f1eef3" />
        </>
      );
    case "kurimanju":
      return (
        <>
          <path d="M4 9Q4 1 16 2q12-3 13 6L17 6l-5 3Z" fill="#94725e" />
          <path d="M11 25q2-3 5-1 3-2 5 1l-5 2Z" fill="#94725e" />
        </>
      );
    case "kitty":
      return (
        <g transform="translate(25 7)">
          <path d="M0 0q-7-7-7-1t7 1q7-7 7-1t-7 1Z" fill="#d88195" />
          <circle r="2.2" fill="#c5677e" />
        </g>
      );
    case "melody":
      return (
        <>
          <path
            d="M5 11q-2 11 3 15m19-15q2 11-3 15"
            fill="none"
            stroke="#f6e5dc"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <g fill="#f6dfb1">
            <circle cx="7" cy="6" r="2.4" />
            <circle cx="10" cy="8" r="2.4" />
            <circle cx="6" cy="9" r="2.4" />
          </g>
          <circle cx="7.5" cy="8" r="1.3" fill="#d8b879" />
        </>
      );
    case "kuromi":
      return (
        <>
          <path d="M4 11Q4 1 16 3q12-2 12 8l-6-3-6 3-6-3Z" fill="#686077" />
          <path d="M13 5q3-3 6 0v2l-1 1v1h-4V8l-1-1Z" fill="#e8a8c4" />
          <path
            d="M14.5 6h.1m2.8 0h.1"
            stroke="#686077"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
          <Bow color="#686077" y={26} />
        </>
      );
    case "cinnamoroll":
      return <Bow color="#9ebfd9" y={26} />;
    case "pompompurin":
      return (
        <>
          <path d="M7 8Q6 2 16 2q10 0 9 6Z" fill="#a17e5b" />
          <rect x="5" y="7" width="22" height="3" rx="1.5" fill="#a17e5b" />
          <path
            d="M16 3V1"
            stroke="#a17e5b"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </>
      );
    case "pochacco":
      return (
        <>
          <path d="m11 4 3-2 2 2 3-2 2 3" fill="#656375" />
          <path d="m8 24 8 3 8-3-3 6H11Z" fill="#93b8d6" />
          <path d="m17 27 4 4h-5Z" fill="#789ebe" />
        </>
      );
    default:
      return null;
  }
}
