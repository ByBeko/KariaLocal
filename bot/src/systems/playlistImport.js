// Spotify, Deezer ve Apple Music linklerini okur. Giriş gerekmez: herkese açık oynatıcı sayfaları ve Deezer'ın açık API'si kullanılır.
// Şarkılar "ytsearch1:Sanatçı - Ad" olarak saklanır; YouTube'da ancak çalınırken aranır, böylece büyük listeler anında aktarılır.
import { UserError } from '../utils/errors.js';

export const MAX_IMPORT = 200;
export const EXTERNAL_HOSTS = /^(?:open\.spotify\.com|spotify\.link|(?:www\.)?deezer\.com|link\.deezer\.com|music\.apple\.com|itunes\.apple\.com)$/i;
const SHORT_HOSTS = /^(?:spotify\.link|link\.deezer\.com)$/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** Aktarılan şarkının YouTube araması; çalarken yt-dlp bunu doğrudan açar */
export const searchSource = (artist, title) => `ytsearch1:${[artist, title].filter(Boolean).join(' - ')} audio`.replace(/\s+/g, ' ').slice(0, 220);

export function lazyTrack({ title, artist, duration, cover }, requesterId = null) {
  const name = String(title ?? '').trim().slice(0, 200) || 'Bilinmeyen şarkı';
  const by = String(artist ?? '').trim().slice(0, 200);
  const url = searchSource(by, name);
  return { id: url, title: name, uploader: by, duration: Math.round(Number(duration) || 0), url, thumbnail: cover ?? null, live: false, requesterId };
}

async function fetchText(url, accept = 'text/html') {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) throw new UserError('Liste açılamadı. Herkese açık olduğundan emin ol.');
  return res.text();
}

/** Kısa linkler (spotify.link, link.deezer.com) asıl adrese çevrilir; her adımda adres yeniden denetlenir */
async function expand(url) {
  for (let i = 0; i < 4 && SHORT_HOSTS.test(url.hostname); i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const next = res?.headers.get('location');
    if (!next) throw new UserError('Kısa link açılamadı. Listenin tam linkini yapıştır.');
    url = new URL(next, url);
    if (!EXTERNAL_HOSTS.test(url.hostname)) throw new UserError('Bu link desteklenmiyor.');
  }
  return url;
}

// ── Spotify: oynatıcı (embed) sayfasındaki liste bilgisi ──
async function spotify(url) {
  const m = url.pathname.match(/^\/(?:intl-[\w-]+\/)?(?:embed\/)?(playlist|album|track)\/([A-Za-z0-9]{22})/);
  if (!m) throw new UserError('Bu Spotify linki okunamadı. Bir çalma listesi, albüm ya da şarkı linki yapıştır.');
  const html = await fetchText(`https://open.spotify.com/embed/${m[1]}/${m[2]}`);
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)?.[1];
  let entity = null;
  try {
    entity = JSON.parse(raw).props.pageProps.state.data.entity;
  } catch {}
  if (!entity) throw new UserError('Spotify listesi okunamadı. Herkese açık olduğundan emin ol.');
  const cover = entity.coverArt?.sources?.[0]?.url ?? entity.visualIdentity?.image?.[0]?.url ?? null;
  const items = m[1] === 'track' ? [entity] : entity.trackList ?? [];
  return {
    name: entity.name ?? entity.title ?? '',
    tracks: items.map((t) => ({
      title: t.title ?? t.name,
      artist: t.subtitle ?? t.artists?.map((a) => a.name).join(', '),
      duration: (Number(t.duration) || 0) / 1000,
      cover,
    })),
  };
}

// ── Deezer: açık API ──
const deezerCover = (md5) => (/^[0-9a-f]{32}$/.test(md5 ?? '') ? `https://cdn-images.dzcdn.net/images/cover/${md5}/250x250-000000-80-0-0.jpg` : null);

async function deezer(url) {
  const m = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(playlist|album|track)\/(\d+)/i);
  if (!m) throw new UserError('Bu Deezer linki okunamadı. Bir çalma listesi, albüm ya da şarkı linki yapıştır.');
  const data = JSON.parse(await fetchText(`https://api.deezer.com/${m[1].toLowerCase()}/${m[2]}`, 'application/json'));
  if (data.error) throw new UserError('Deezer listesi bulunamadı ya da gizli.');
  const items = m[1].toLowerCase() === 'track' ? [data] : data.tracks?.data ?? [];
  return {
    name: data.title ?? '',
    tracks: items.map((t) => ({ title: t.title, artist: t.artist?.name, duration: t.duration, cover: deezerCover(t.album?.md5_image ?? data.md5_image) })),
  };
}

// ── Apple Music: sayfaya gömülü sunucu verisi ──
async function apple(url) {
  const m = url.pathname.match(/^\/[a-z]{2}\/(playlist|album|song)\/(?:[^/]+\/)?([\w.-]+)$/i);
  if (!m) throw new UserError('Bu Apple Music linki okunamadı. Bir çalma listesi, albüm ya da şarkı linki yapıştır.');
  const html = await fetchText(url.href);
  const raw = html.match(/<script[^>]*id="serialized-server-data"[^>]*>(.*?)<\/script>/s)?.[1];
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {}
  if (!data) throw new UserError('Apple Music listesi okunamadı. Herkese açık olduğundan emin ol.');
  // Şarkılar bir bölümün "items" dizisinde durur; en kalabalık bölüm asıl listedir (öneriler ayrı bölümdedir)
  const groups = new Map();
  const walk = (node, parent) => {
    if (!node || typeof node !== 'object') return;
    if (node.artistName && node.title && Number(node.duration) > 0) {
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(node);
      return;
    }
    for (const value of Object.values(node)) walk(value, node);
  };
  walk(data, null);
  let items = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const songId = url.searchParams.get('i') ?? (m[1].toLowerCase() === 'song' ? m[2] : null);
  if (songId) items = items.filter((t) => String(t.id) === songId).slice(0, 1).concat(items).slice(0, 1);
  // Albüm sayfasında şarkıların ayrı kapağı yok: albüm kapağı kullanılır
  const pageArt = html.match(/<meta property="og:image" content="([^"]*)"/)?.[1]?.replace(/\/[^/]+$/, '/300x300bb.jpg') ?? null;
  const art = (t) => t.artwork?.dictionary?.url?.replace('{w}x{h}bb.{f}', '300x300bb.jpg') ?? pageArt;
  const name = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? '';
  return {
    name: name.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/ (?:on|-) Apple Music$/i, '').trim(),
    tracks: items.map((t) => ({ title: t.title, artist: t.artistName, duration: Number(t.duration) / 1000, cover: art(t) })),
  };
}

export const isExternalLink = (url) => EXTERNAL_HOSTS.test(url.hostname);

/** Spotify / Deezer / Apple Music linki → { name, tracks } (şarkılar çalınırken YouTube'da aranır) */
export async function readMusicLink(link, requesterId) {
  const url = await expand(link);
  const host = url.hostname.toLowerCase();
  const read = host.includes('spotify') ? spotify : host.includes('deezer') ? deezer : apple;
  const { name, tracks } = await read(url);
  const usable = tracks.filter((t) => t.title).slice(0, MAX_IMPORT).map((t) => lazyTrack(t, requesterId));
  if (!usable.length) throw new UserError('Listede aktarılabilecek şarkı bulunamadı.');
  return { name: String(name).slice(0, 40), tracks: usable };
}

// ── Kapaklar: Etkinlik dış resimleri yükleyemez, bilinen kaynaklar sunucu üzerinden verilir ──
const COVER_SOURCES = {
  sp: { test: /^https:\/\/(?:i\.scdn\.co|image-cdn-[a-z]{2}\.spotifycdn\.com)\/image\/([0-9a-f]{40})$/, key: /^[0-9a-f]{40}$/, url: (k) => `https://i.scdn.co/image/${k}` },
  dz: { test: /^https:\/\/cdn-images\.dzcdn\.net\/images\/cover\/([0-9a-f]{32})\//, key: /^[0-9a-f]{32}$/, url: (k) => `https://cdn-images.dzcdn.net/images/cover/${k}/250x250-000000-80-0-0.jpg` },
  am: {
    test: /^https:\/\/is\d-ssl\.mzstatic\.com\/image\/thumb\/([\w./-]+\.(?:jpg|png|jpeg|tif|webp))\/300x300bb\.jpg$/i,
    key: /^[\w-]{10,400}$/,
    encode: (p) => Buffer.from(p).toString('base64url'),
    url: (k) => {
      const p = Buffer.from(k, 'base64url').toString();
      return /^[\w./-]+$/.test(p) && !p.includes('..') ? `https://is1-ssl.mzstatic.com/image/thumb/${p}/300x300bb.jpg` : null;
    },
  },
};

/** Kayıtlı kapak adresi → etkinliğin yükleyebileceği yol (bilinmeyen kaynaklar gösterilmez) */
export function coverPath(url) {
  if (!url) return null;
  for (const [kind, source] of Object.entries(COVER_SOURCES)) {
    const m = String(url).match(source.test);
    if (m) return `cover/${kind}/${source.encode ? source.encode(m[1]) : m[1]}.jpg`;
  }
  return null;
}

/** Kapak yolundaki tür ve anahtar → asıl resim adresi */
export function coverSource(kind, key) {
  const source = COVER_SOURCES[kind];
  return source && source.key.test(key) ? source.url(key) : null;
}
