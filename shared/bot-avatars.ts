export const botAvatars = [
  { id: "orbit", label: "紫色圓圓", color: "#9254ff" },
  { id: "cloud", label: "藍色雲朵", color: "#61a5ff" },
  { id: "bean", label: "綠色豆豆", color: "#6bc99b" },
  { id: "spark", label: "橘色星星", color: "#ffb365" },
  { id: "bloom", label: "粉色花花", color: "#ee8fbe" },
  { id: "cube", label: "黃色方方", color: "#e9cd68" },
] as const;

export function isBotAvatar(value: unknown): value is string {
  return botAvatars.some((avatar) => avatar.id === value);
}
