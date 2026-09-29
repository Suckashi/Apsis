import { botAvatars } from "../shared/bot-avatars.ts";
import { AvatarCostume, collectibleShapes } from "./avatar-costume.tsx";
import { friendBodyTransforms } from "./avatar-friends.tsx";

export function BrandMark({
  size = 26,
  avatar = "orbit",
}: {
  size?: number;
  avatar?: string;
}) {
  const preset = botAvatars.find((item) => item.id === avatar) || botAvatars[0];
  const shape = collectibleShapes[preset.id] ?? preset.id;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      data-avatar={preset.id}
    >
      <AvatarCostume avatar={preset.id} layer="back" />
      <g transform={friendBodyTransforms[preset.id]}>
        <g fill={preset.color}>
          {shape === "orbit" && <circle cx="16" cy="16" r="14" />}
          {shape === "cloud" && (
            <path d="M8 28a7 7 0 0 1-4-13 8 8 0 0 1 13-9 8 8 0 0 1 11 9 7 7 0 0 1-4 13Z" />
          )}
          {shape === "bean" && (
            <path d="M25 3C14-2 2 8 2 19c0 9 9 14 17 10 5-3 4-7 7-10 6-6 6-13-1-16Z" />
          )}
          {shape === "spark" && (
            <path d="m16 1 5 8 9 2-5 9 1 10-10-4-10 4 1-10-5-9 9-2Z" />
          )}
          {shape === "bloom" && (
            <path d="M16 5C23-3 33 7 27 14c9 6 1 19-8 13C12 35 0 27 5 19-4 12 5 0 13 5Z" />
          )}
          {shape === "cube" && (
            <rect
              x="3"
              y="3"
              width="26"
              height="26"
              rx="8"
              transform="rotate(-8 16 16)"
            />
          )}
        </g>
        <ellipse
          cx="11.5"
          cy="14.5"
          rx="1.9"
          ry="4.3"
          transform="rotate(17 11.5 14.5)"
          fill="#201333"
        />
        <ellipse
          cx="20.5"
          cy="14.5"
          rx="1.9"
          ry="4.3"
          transform="rotate(-17 20.5 14.5)"
          fill="#201333"
        />
        <AvatarCostume avatar={preset.id} />
      </g>
    </svg>
  );
}
