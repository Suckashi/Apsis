export const botAvatars = [
  { id: "orbit", label: "紫色圓圓", color: "#9254ff", series: "basic" },
  { id: "cloud", label: "藍色雲朵", color: "#61a5ff", series: "basic" },
  { id: "bean", label: "綠色豆豆", color: "#6bc99b", series: "basic" },
  { id: "spark", label: "橘色星星", color: "#ffb365", series: "basic" },
  { id: "bloom", label: "粉色花花", color: "#ee8fbe", series: "basic" },
  { id: "cube", label: "黃色方方", color: "#e9cd68", series: "basic" },
  { id: "captain", label: "頭像 07", color: "#ef7772", series: "voyage" },
  { id: "swordsman", label: "頭像 08", color: "#80c597", series: "voyage" },
  { id: "navigator", label: "頭像 09", color: "#ffba77", series: "voyage" },
  { id: "cook", label: "頭像 10", color: "#f1ce77", series: "voyage" },
  { id: "doctor", label: "頭像 11", color: "#d9a47f", series: "voyage" },
  { id: "scholar", label: "頭像 12", color: "#ae9ddd", series: "voyage" },
  { id: "elf", label: "頭像 13", color: "#a7d2c3", series: "magic" },
  { id: "mage", label: "頭像 14", color: "#b9a0dc", series: "magic" },
  { id: "fighter", label: "頭像 15", color: "#ea9b87", series: "magic" },
  { id: "hero", label: "頭像 16", color: "#9bbce6", series: "magic" },
  { id: "priest", label: "頭像 17", color: "#9aba95", series: "magic" },
  { id: "dwarf", label: "頭像 18", color: "#ba967c", series: "magic" },
  { id: "anya", label: "頭像 19", color: "#edabc1", series: "spy" },
  { id: "yor", label: "頭像 20", color: "#baabc9", series: "spy" },
  { id: "loid", label: "頭像 21", color: "#b3c8a8", series: "spy" },
  { id: "bond", label: "頭像 22", color: "#e9e1d1", series: "spy" },
  { id: "tanjiro", label: "頭像 23", color: "#84bea6", series: "slayer" },
  { id: "nezuko", label: "頭像 24", color: "#ecafbc", series: "slayer" },
  { id: "zenitsu", label: "頭像 25", color: "#f1cb79", series: "slayer" },
  { id: "inosuke", label: "頭像 26", color: "#abc2d6", series: "slayer" },
  { id: "shinobu", label: "頭像 27", color: "#bba6d8", series: "slayer" },
  { id: "naruto", label: "頭像 28", color: "#f1b879", series: "ninja" },
  { id: "sasuke", label: "頭像 29", color: "#9daecc", series: "ninja" },
  { id: "sakura", label: "頭像 30", color: "#edafc0", series: "ninja" },
  { id: "kakashi", label: "頭像 31", color: "#a8beb6", series: "ninja" },
  { id: "gaara", label: "頭像 32", color: "#d8a096", series: "ninja" },
  { id: "pikachu", label: "頭像 33", color: "#f3d773", series: "pokemon" },
  { id: "eevee", label: "頭像 34", color: "#caa17e", series: "pokemon" },
  { id: "snorlax", label: "頭像 35", color: "#8db8bd", series: "pokemon" },
  { id: "psyduck", label: "頭像 36", color: "#eed395", series: "pokemon" },
  { id: "gengar", label: "頭像 37", color: "#aa93ce", series: "pokemon" },
  { id: "chiikawa", label: "頭像 38", color: "#eee4d7", series: "chiikawa" },
  { id: "hachiware", label: "頭像 39", color: "#dce8ef", series: "chiikawa" },
  { id: "usagi", label: "頭像 40", color: "#f1dfb0", series: "chiikawa" },
  { id: "momonga", label: "頭像 41", color: "#dce0ec", series: "chiikawa" },
  { id: "kurimanju", label: "頭像 42", color: "#dbba94", series: "chiikawa" },
  { id: "kitty", label: "頭像 43", color: "#eee7dd", series: "sanrio" },
  { id: "melody", label: "頭像 44", color: "#ebacc3", series: "sanrio" },
  { id: "kuromi", label: "頭像 45", color: "#c3b5d6", series: "sanrio" },
  {
    id: "cinnamoroll",
    label: "頭像 46",
    color: "#deedf3",
    series: "sanrio",
  },
  { id: "pompompurin", label: "頭像 47", color: "#efda9c", series: "sanrio" },
  { id: "pochacco", label: "頭像 48", color: "#e9e5db", series: "sanrio" },
] as const;

export const botAvatarSeries = [
  { id: "basic", label: "基本款" },
  { id: "voyage", label: "系列 2" },
  { id: "magic", label: "系列 3" },
  { id: "spy", label: "系列 4" },
  { id: "slayer", label: "系列 5" },
  { id: "ninja", label: "系列 6" },
  { id: "pokemon", label: "系列 7" },
  { id: "chiikawa", label: "系列 8" },
  { id: "sanrio", label: "系列 9" },
] as const satisfies readonly {
  id: (typeof botAvatars)[number]["series"];
  label: string;
}[];

export type BotAvatarId = (typeof botAvatars)[number]["id"];

export function isBotAvatar(value: unknown): value is BotAvatarId {
  return botAvatars.some((avatar) => avatar.id === value);
}
