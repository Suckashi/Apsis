import type { BotAvatarId } from "../shared/bot-avatars.ts";
import { FriendCostume, friendShapes } from "./avatar-friends.tsx";

// Original silhouettes and eyes, with small flat costume accents.
export const collectibleShapes: Partial<Record<BotAvatarId, BotAvatarId>> = {
  ...friendShapes,
  captain: "orbit",
  swordsman: "bean",
  navigator: "cloud",
  cook: "cube",
  doctor: "orbit",
  scholar: "bloom",
  elf: "bean",
  mage: "orbit",
  fighter: "spark",
  hero: "cloud",
  priest: "cube",
  dwarf: "cube",
};

export function AvatarCostume({
  avatar,
  layer = "front",
}: {
  avatar: BotAvatarId;
  layer?: "back" | "front";
}) {
  if (layer === "back") {
    switch (avatar) {
      case "doctor":
        return (
          <path
            d="M7 10 3 6V2m0 4 3-2m19 6 4-4V2m0 4-3-2"
            fill="none"
            stroke="#a37961"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case "elf":
        return (
          <path
            d="M7 7Q1 8 2 17l2 7 4-4V9Zm18-1q6 1 5 10l-2 7-4-4V8Z"
            fill="#ece8df"
          />
        );
      case "swordsman":
        return (
          <g strokeLinecap="round">
            <path
              d="m23 25 6-11m-4 13 5-6m-8 5 5-18"
              stroke="#e1d1a3"
              strokeWidth="2"
            />
            <path
              d="m27 14 3 2m-2 5 3 2m-6-14 4 1"
              stroke="#777190"
              strokeWidth="1.5"
            />
          </g>
        );
      case "dwarf":
        return (
          <>
            <path
              d="M29 19v11"
              stroke="#977b64"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path d="M28 20q-3 0-3 4h6v-7Z" fill="#a5adbf" />
          </>
        );
      default:
        return <FriendCostume avatar={avatar} layer={layer} />;
    }
  }
  switch (avatar) {
    case "captain":
      return (
        <>
          <path d="M7 8V6C7-1 25-1 25 6v2Z" fill="#edca7d" />
          <path d="M7 5q9-2 18 0v3H7Z" fill="#d57570" />
          <ellipse cx="16" cy="8" rx="15" ry="2.5" fill="#f7d996" />
        </>
      );
    case "swordsman":
      return (
        <>
          <path d="M8 8q7-6 18-3l1 4Q17 6 7 11Z" fill="#3b846c" />
          <path d="m25 6 5 3-4 3" fill="#3b846c" />
        </>
      );
    case "navigator":
      return (
        <g transform="translate(25 25)">
          <circle r="5" fill="#f5de9c" />
          <path d="m0-3 1.2 3L0 3l-1.2-3Z" fill="#558c94" />
          <path d="m-3 0 3-1 3 1-3 1Z" fill="#558c94" />
        </g>
      );
    case "cook":
      return (
        <>
          <path
            d="M7 8c0-4 6-4 6-1 0 2-3 2-3 0"
            fill="none"
            stroke="#aa8849"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path
            d="M10 24q0-1 1.5-.5L16 26l4.5-2.5q1.5-.5 1.5.5v4q0 1-1.5.5L16 26l-4.5 2.5q-1.5.5-1.5-.5Z"
            fill="#535771"
          />
        </>
      );
    case "doctor":
      return (
        <>
          <path d="M7 9V5q0-4 4-4h10q4 0 4 4v4Z" fill="#dd94b2" />
          <rect x="4" y="7" width="24" height="4" rx="2" fill="#efb0c9" />
          <path
            d="m14 3 4 3m0-3-4 3"
            stroke="#fff0df"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      );
    case "scholar":
      return (
        <>
          <path d="M8 24q4-2 8 0 4-2 8 0v6q-4-2-8 0-4-2-8 0Z" fill="#f0dcb1" />
          <path d="M16 24v5" stroke="#c6ad8c" strokeWidth="1" />
        </>
      );
    case "elf":
      return (
        <>
          <path
            d="M5 10C7 0 23-2 27 7l-4 2-4-5q0 5-4 6l-1-5q-3 5-9 5Z"
            fill="#f6f1e8"
          />
          <path d="m7 14-6-3q0 6 6 7m18-5 6-3q0 6-6 7" fill="#a7d2c3" />
          <path d="M4 17v2m24-3v2" stroke="#c6ab70" strokeWidth="1.3" />
          <path
            d="M4 18q-3 3 0 4 3-1 0-4m24-1q-3 3 0 4 3-1 0-4"
            fill="#c98298"
          />
        </>
      );
    case "mage":
      return (
        <>
          <path d="M5 9C7 0 25 0 27 9H18l-2-3-2 3Z" fill="#886aad" />
          <path d="m10 26 6 2 6-2-2 4h-8Z" fill="#f2eddf" />
          <path
            d="M28 14v15"
            stroke="#ac946d"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="28" cy="13" r="3.6" fill="#e8cf8d" />
          <circle cx="28" cy="13" r="1.7" fill="#8dbda9" />
        </>
      );
    case "fighter":
      return (
        <>
          <path d="m16 1 5 8-5-3-2 3-1-3-3 3Z" fill="#c56c68" />
          <path
            d="M6 24q0-4 4-3 3 1 2 5H6Zm14 2q-1-5 2-5 4-1 4 3v2Z"
            fill="#8e809b"
          />
        </>
      );
    case "hero":
      return (
        <>
          <path d="M8 7q3-7 9-4l5 4-6-1-3 3-1-3Z" fill="#759bcd" />
          <path d="m8 23 8 3 8-3 3 6q-11 5-22 0Z" fill="#f0ecdf" />
          <circle cx="16" cy="26" r="1.8" fill="#ccb477" />
        </>
      );
    case "priest":
      return (
        <>
          <g fill="none" stroke="#547667" strokeWidth="1.1">
            <ellipse cx="11" cy="14.5" rx="4.3" ry="5.2" />
            <ellipse cx="21" cy="14.5" rx="4.3" ry="5.2" />
            <path d="M15.3 14q.7-1 1.4 0M5 13l1.7.5m18.6 0L27 13" />
          </g>
          <path d="m10 25 6 2 6-2-2 5h-8Z" fill="#f2eddb" />
        </>
      );
    case "dwarf":
      return (
        <>
          <path d="M4 9V7C4-1 28-1 28 7v2Z" fill="#a1a9b7" />
          <path d="M16 2v7" stroke="#e3d1a6" strokeWidth="2.4" />
          <rect x="3" y="7" width="26" height="3" rx="1.5" fill="#dfcba2" />
          <path
            d="M8 22q4-2 8 1 4-3 8-1l-2 5-3-1-3 4-3-4-3 1Z"
            fill="#9d765d"
          />
        </>
      );
    default:
      return <FriendCostume avatar={avatar} layer={layer} />;
  }
}
