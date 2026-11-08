// Emoji / çıkartma yardımcıları (üye ve yetkili komutları ortak kullanır)
const EMOJI_RE = /<(a?):(\w{2,32}):(\d{17,20})>/;

/** "<:ad:id>", "ad", id ya da URL → { id?, name?, animated?, url? } */
export function parseEmoji(input) {
  const text = input.trim();
  const m = text.match(EMOJI_RE);
  if (m) return { animated: Boolean(m[1]), name: m[2], id: m[3], url: `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? 'gif' : 'png'}` };
  if (/^\d{17,20}$/.test(text)) return { id: text };
  if (/^https?:\/\//.test(text)) return { url: text };
  return { name: text.replaceAll(':', '') };
}

export function findGuildEmoji(guild, input) {
  const p = parseEmoji(input);
  return (p.id && guild.emojis.cache.get(p.id)) || (p.name && guild.emojis.cache.find((e) => e.name.toLowerCase() === p.name.toLowerCase())) || null;
}

export const findSticker = (guild, name) =>
  guild.stickers.cache.find((s) => s.name.toLowerCase() === name.toLowerCase().trim()) ?? guild.stickers.cache.get(name.trim());

export const emojiSlots = (guild) => [50, 100, 150, 250][guild.premiumTier] ?? 50;
export const stickerSlots = (guild) => [5, 15, 30, 60][guild.premiumTier] ?? 5;
