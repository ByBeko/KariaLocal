// Şarkı sözleri: LRCLIB (lrclib.net, ücretsiz, anahtarsız). Zaman damgalı sözler varsa etkinlikte şarkıyla birlikte akar.
// GET /lyrics?title=&artist=&duration= → { found, instrumental, synced: [[saniye, satır]] | null, plain }
const API = 'https://lrclib.net/api/search';
const UA = 'LyricsClient/1.0'; // LRCLIB uygulamayı tanıtan bir User-Agent ister; istenirse uygulama adıyla değiştirilebilir
const cache = new Map(); // anahtar -> sonuç
const MAX_CACHE = 300;

// YouTube başlıklarındaki gürültü: (Official Video), [Lyrics], (Klip) ...
const NOISE = /[([{【]\s*[^)\]}】]*\b(official|video|audio|lyrics?|klip|clip|hd|hq|4k|visuali[sz]er|mv|m\/v|remaster(ed)?|canlı|live|performance)\b[^)\]}】]*[)\]}】]/gi;
const cleanArtist = (artist) => String(artist ?? '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s*\(?official\)?$/i, '').trim();
const firstArtist = (artist) => artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b)\s*/i)[0].trim();

/** Başlık ve sanatçıyı aramaya uygun hale getirir ("Sanatçı - Şarkı (Official Video)" gibi YouTube başlıkları dahil) */
function normalize(rawTitle, rawArtist) {
  let title = String(rawTitle ?? '').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  let artist = cleanArtist(rawArtist);
  const dash = title.match(/^(.+?)\s+[-–—|]\s+(.+)$/);
  if (dash && (!artist || dash[1].toLowerCase().includes(firstArtist(artist).toLowerCase()) || artist.toLowerCase().includes(dash[1].toLowerCase()))) {
    artist = dash[1].trim();
    title = dash[2].trim();
  }
  title = title.replace(/["“”]/g, '').trim();
  return { title, artist, bare: title.replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/\s+/g, ' ').trim() };
}

async function search(params) {
  const res = await fetch(`${API}?${new URLSearchParams(params)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (!res?.ok) return [];
  return res.json().catch(() => []);
}

/** En uygun kayıt: süresi yakın ve zaman damgalı olan öne çıkar */
function pick(items, duration) {
  const usable = items.filter((t) => t.syncedLyrics || t.plainLyrics || t.instrumental);
  if (!usable.length) return null;
  const off = (t) => (duration ? Math.abs(Number(t.duration) - duration) : 0);
  const close = duration ? usable.filter((t) => off(t) <= 6) : usable;
  const pool = close.length ? close : usable;
  return pool.slice().sort((a, b) => (Boolean(b.syncedLyrics) - Boolean(a.syncedLyrics)) || off(a) - off(b))[0];
}

/** "[01:02.34] satır" biçimini [[62.34, "satır"]] dizisine çevirir */
function parseLrc(text) {
  const lines = [];
  for (const row of String(text).split('\n')) {
    const stamps = [...row.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!stamps.length) continue;
    const words = row.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) lines.push([Number(s[1]) * 60 + Number(s[2].replace(':', '.')), words]);
  }
  return lines.sort((a, b) => a[0] - b[0]);
}

export async function lyricsRoute(query) {
  const raw = { title: String(query.get('title') ?? '').slice(0, 200), artist: String(query.get('artist') ?? '').slice(0, 200) };
  const duration = Math.max(0, Math.round(Number(query.get('duration')) || 0));
  if (!raw.title.trim()) return { found: false };
  const { title, artist, bare } = normalize(raw.title, raw.artist);
  const key = `${title}|${artist}|${Math.round(duration / 10)}`.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  // Önce tam ad, sonra parantezsiz ad ve ilk sanatçı, en son serbest arama
  const tries = [
    artist && { track_name: title, artist_name: artist },
    artist && (bare !== title || firstArtist(artist) !== artist) && { track_name: bare, artist_name: firstArtist(artist) },
    { q: `${artist ? `${firstArtist(artist)} ` : ''}${bare}` },
  ].filter(Boolean);
  let best = null;
  for (const params of tries) {
    best = pick(await search(params), duration);
    if (best) break;
  }
  const result = best
    ? {
      found: true,
      title: best.trackName,
      artist: best.artistName,
      instrumental: Boolean(best.instrumental),
      synced: best.syncedLyrics ? parseLrc(best.syncedLyrics) : null,
      plain: best.plainLyrics ?? null,
    }
    : { found: false };
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}
