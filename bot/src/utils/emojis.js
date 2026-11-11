// Karia'nın kendi emojileri: botun "uygulama emojileri" (Developer Portal → Emojis). Sunucu emoji yuvası harcamaz,
// bot her yerde kullanabilir. Açılışta Discord'dan okunur; bulunamayan emoji yerine verilen normal emoji kullanılır.
const map = new Map(); // "alev" -> "<:Karia_alev:123>"

export async function loadAppEmojis(client) {
  const emojis = await client.application.emojis.fetch().catch(() => null);
  if (!emojis) return 0;
  map.clear();
  for (const emoji of emojis.values()) map.set(emoji.name.replace(/^Karia_/i, '').toLowerCase(), emoji.toString());
  return map.size;
}

/** Karia emojisi; yüklü değilse yedek (unicode) emoji döner. Örn: e('alev', '🔥') */
export const e = (key, fallback = '') => map.get(key) ?? fallback;

/** Panel seçimleri için yüklü Karia emojileri */
export const emojiList = () => [...map].map(([name, value]) => ({ name, value })).sort((a, b) => a.name.localeCompare(b.name, 'tr'));

/** Yapay zeka metnindeki normal emojileri siler (özel Karia emojilerine dokunmaz). */
export const stripEmojis = (text) =>
  text.replace(/(?![©®™])\p{Extended_Pictographic}️?(‍\p{Extended_Pictographic}️?)*[ \t]?/gu, '').trim();
