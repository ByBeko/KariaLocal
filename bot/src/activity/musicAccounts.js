// Müzik hesabı bağlama: üye Spotify ya da YouTube (YouTube Music) hesabını bağlar, listelerini tek tıkla Karia'ya aktarır.
// Anahtarlar sosyal paylaşımdaki gibi SOCIAL_TOKEN_KEY ile şifreli saklanır. Giriş, etkinlikten tarayıcıda açılır;
// dönüş adresi: {SOCIAL_BASE_URL}/music/callback/{spotify|youtube}
// Not: Spotify, geliştirme modundaki uygulamalarda en fazla 5 kullanıcıya izin verir (Spotify panelinde eklenenler).
// GET  /music-accounts                     → hesaplarım
// POST /music-accounts/:platform/connect   → { url } (tarayıcıda açılır)
// POST /music-accounts/:platform/disconnect
// GET  /music-accounts/:platform/playlists → hesaptaki listeler
// POST /music-accounts/:platform/import {id, name} → listeyi Karia listesi olarak aktarır
import { randomBytes } from 'node:crypto';
import { db } from '../core/database.js';
import { UserError } from '../utils/errors.js';
import { page, seal, unseal } from '../systems/social.js';
import { coverPath, lazyTrack, MAX_IMPORT, readMusicLink } from '../systems/playlistImport.js';
import { importList } from './playlists.js';

const BASE_URL = (process.env.SOCIAL_BASE_URL || 'https://activity.karia.live').replace(/\/$/, '');
const STATE_TTL = 15 * 60_000;
const SP_API = 'https://api.spotify.com/v1';
const YT_API = 'https://www.googleapis.com/youtube/v3';

db.exec(`
  CREATE TABLE IF NOT EXISTS music_accounts (
    user_id    TEXT NOT NULL,
    platform   TEXT NOT NULL,
    name       TEXT NOT NULL,
    secrets    TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, platform)
  );
`);

const q = {
  all: db.prepare('SELECT platform, name FROM music_accounts WHERE user_id=?'),
  get: db.prepare('SELECT * FROM music_accounts WHERE user_id=? AND platform=?'),
  save: db.prepare(`INSERT INTO music_accounts (user_id, platform, name, secrets, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, platform) DO UPDATE SET name=excluded.name, secrets=excluded.secrets, expires_at=excluded.expires_at, updated_at=excluded.updated_at`),
  remove: db.prepare('DELETE FROM music_accounts WHERE user_id=? AND platform=?'),
};

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(url, options = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = data?.error;
    const text = (typeof error === 'object' ? error?.message : error) || data?.error_description || `HTTP ${res.status}`;
    throw new ApiError(String(text).slice(0, 200), res.status);
  }
  return data;
}

const form = (fields, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields) });
const redirectUri = (platform) => `${BASE_URL}/music/callback/${platform}`;
const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

// ── Spotify ──
const spotifyBasic = () => ({ Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}` });

function spotifyTrack(t) {
  if (!t || t.type === 'episode' || t.is_local || !t.name) return null;
  return { title: t.name, artist: (t.artists ?? []).map((a) => a.name).join(', '), duration: (Number(t.duration_ms) || 0) / 1000, cover: t.album?.images?.[0]?.url ?? null };
}

const spotify = {
  label: 'Spotify',
  env: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
  note: 'Spotify kuralı: sadece yöneticinin eklediği en fazla 5 hesap bağlanabilir. Herkese açık listeleri link ile aktarabilirsin.',
  authUrl: (state) => `https://accounts.spotify.com/authorize?${new URLSearchParams({ client_id: process.env.SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri('spotify'), scope: 'playlist-read-private playlist-read-collaborative user-library-read', state, show_dialog: 'true' })}`,
  async connect(code) {
    const token = await request('https://accounts.spotify.com/api/token', form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri('spotify') }, spotifyBasic()));
    let me;
    try {
      me = await request(`${SP_API}/me`, bearer(token.access_token));
    } catch (error) {
      if (error.status === 403) throw new UserError('Bu Spotify hesabı Karia\'nın Spotify uygulamasına eklenmemiş. Spotify kuralları gereği bir yöneticinin seni Spotify geliştirici panelinden eklemesi gerekir.');
      throw error;
    }
    return { name: me.display_name || me.id || 'Spotify', secrets: { access: token.access_token, refresh: token.refresh_token }, expiresAt: Date.now() + token.expires_in * 1000 };
  },
  async refresh(secrets) {
    const token = await request('https://accounts.spotify.com/api/token', form({ grant_type: 'refresh_token', refresh_token: secrets.refresh }, spotifyBasic()));
    return { secrets: { access: token.access_token, refresh: token.refresh_token || secrets.refresh }, expiresAt: Date.now() + token.expires_in * 1000 };
  },
  async playlists(access) {
    const out = [{ id: 'liked', name: 'Beğenilen Şarkılar', count: null, cover: null }];
    for (let offset = 0; offset < 100; offset += 50) {
      const batch = await request(`${SP_API}/me/playlists?limit=50&offset=${offset}`, bearer(access));
      for (const p of batch.items ?? []) {
        if (!p?.id) continue;
        out.push({ id: p.id, name: p.name, count: p.items?.total ?? p.tracks?.total ?? null, cover: coverPath(p.images?.[0]?.url) });
      }
      if (!batch.next) break;
    }
    return out;
  },
  async tracks(access, id) {
    if (id === 'liked') {
      const tracks = [];
      for (let offset = 0; tracks.length < MAX_IMPORT; offset += 50) {
        const batch = await request(`${SP_API}/me/tracks?limit=50&offset=${offset}`, bearer(access));
        tracks.push(...(batch.items ?? []).map((x) => spotifyTrack(x.item ?? x.track)).filter(Boolean));
        if (!batch.next) break;
      }
      return tracks;
    }
    if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new UserError('Liste bulunamadı.');
    const tracks = [];
    try {
      for (let offset = 0; tracks.length < MAX_IMPORT; offset += 50) {
        const batch = await request(`${SP_API}/playlists/${id}/items?limit=50&offset=${offset}`, bearer(access));
        tracks.push(...(batch.items ?? []).map((x) => spotifyTrack(x.item ?? x.track)).filter(Boolean));
        if (!batch.next) break;
      }
    } catch (error) {
      // Spotify sadece kişinin kendi ya da ortak listelerinin içeriğini verir; takip edilen listeler açık sayfadan okunur
      if (error.status !== 403 && error.status !== 404) throw error;
      return null;
    }
    return tracks;
  },
  publicLink: (id) => (id === 'liked' ? null : `https://open.spotify.com/playlist/${id}`),
};

// ── YouTube / YouTube Music (Google hesabı) ──
const isoSeconds = (text) => {
  const m = String(text ?? '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m ? (Number(m[1] ?? 0) * 86400) + (Number(m[2] ?? 0) * 3600) + (Number(m[3] ?? 0) * 60) + Number(m[4] ?? 0) : 0;
};
const ytTrack = (videoId, title, artist, duration = 0) => ({
  title,
  artist: String(artist ?? '').replace(/ - Topic$/, ''),
  duration,
  url: `https://www.youtube.com/watch?v=${videoId}`,
  thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
});

const youtube = {
  label: 'YouTube Music',
  env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  note: 'YouTube ve YouTube Music listelerin ile beğendiğin şarkılar aktarılır.',
  authUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri('youtube'), response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.readonly', access_type: 'offline', prompt: 'consent', state })}`,
  async connect(code) {
    const token = await request('https://oauth2.googleapis.com/token', form({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: 'authorization_code', redirect_uri: redirectUri('youtube'), code }));
    if (!token.refresh_token) throw new UserError('Google kalıcı izin vermedi. Google hesabındaki Karia iznini kaldırıp yeniden bağlan.');
    const channel = await request(`${YT_API}/channels?part=snippet&mine=true`, bearer(token.access_token)).catch(() => ({}));
    return { name: channel.items?.[0]?.snippet?.title || 'YouTube hesabı', secrets: { access: token.access_token, refresh: token.refresh_token }, expiresAt: Date.now() + token.expires_in * 1000 };
  },
  async refresh(secrets) {
    const token = await request('https://oauth2.googleapis.com/token', form({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: secrets.refresh }));
    return { secrets: { access: token.access_token, refresh: token.refresh_token || secrets.refresh }, expiresAt: Date.now() + token.expires_in * 1000 };
  },
  async playlists(access) {
    const out = [{ id: 'liked', name: 'Beğendiklerin', count: null, cover: null }];
    let pageToken = '';
    for (let i = 0; i < 2; i++) {
      const batch = await request(`${YT_API}/playlists?part=snippet,contentDetails&mine=true&maxResults=50${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, bearer(access));
      for (const p of batch.items ?? []) out.push({ id: p.id, name: p.snippet?.title ?? 'Liste', count: p.contentDetails?.itemCount ?? null, cover: null });
      pageToken = batch.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  },
  async tracks(access, id) {
    const tracks = [];
    let pageToken = '';
    if (id === 'liked') {
      do {
        const batch = await request(`${YT_API}/videos?part=snippet,contentDetails&myRating=like&maxResults=50${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, bearer(access));
        for (const v of batch.items ?? []) tracks.push(ytTrack(v.id, v.snippet?.title, v.snippet?.channelTitle, isoSeconds(v.contentDetails?.duration)));
        pageToken = batch.nextPageToken;
      } while (pageToken && tracks.length < MAX_IMPORT);
      return tracks;
    }
    if (!/^[\w-]{10,64}$/.test(id)) throw new UserError('Liste bulunamadı.');
    do {
      const batch = await request(`${YT_API}/playlistItems?part=snippet,contentDetails&playlistId=${id}&maxResults=50${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, bearer(access));
      for (const item of batch.items ?? []) {
        const videoId = item.contentDetails?.videoId;
        const title = item.snippet?.title;
        if (!videoId || !title || ['Deleted video', 'Private video'].includes(title)) continue;
        tracks.push(ytTrack(videoId, title, item.snippet?.videoOwnerChannelTitle));
      }
      pageToken = batch.nextPageToken;
    } while (pageToken && tracks.length < MAX_IMPORT);
    // Liste öğelerinde süre yok: videolardan 50'şerli toplanır
    const ids = tracks.slice(0, MAX_IMPORT).map((t) => t.url.slice(-11));
    for (let i = 0; i < ids.length; i += 50) {
      const batch = await request(`${YT_API}/videos?part=contentDetails&id=${ids.slice(i, i + 50).join(',')}`, bearer(access)).catch(() => ({}));
      const durations = new Map((batch.items ?? []).map((v) => [v.id, isoSeconds(v.contentDetails?.duration)]));
      for (const t of tracks.slice(i, i + 50)) t.duration = durations.get(t.url.slice(-11)) ?? 0;
    }
    return tracks;
  },
  publicLink: () => null,
};

const PLATFORMS = { spotify, youtube };
const isReady = (platform) => Boolean(process.env.SOCIAL_TOKEN_KEY) && PLATFORMS[platform].env.every((name) => process.env[name]);

// ── Oturum ──
const refreshing = new Map();

async function session(userId, platform) {
  let account = q.get.get(userId, platform);
  if (!account) throw new UserError(`${PLATFORMS[platform].label} hesabın bağlı değil.`);
  if (account.expires_at - Date.now() < 60_000) {
    const key = `${userId}:${platform}`;
    if (!refreshing.has(key)) {
      refreshing.set(key, (async () => {
        try {
          const fresh = await PLATFORMS[platform].refresh(unseal(account.secrets));
          q.save.run(userId, platform, account.name, seal(fresh.secrets), fresh.expiresAt, Date.now());
        } catch (error) {
          if (error instanceof ApiError && [400, 401].includes(error.status)) {
            q.remove.run(userId, platform);
            throw new UserError(`${PLATFORMS[platform].label} bağlantın düşmüş. Yeniden bağla.`);
          }
          throw error;
        }
      })().finally(() => refreshing.delete(key)));
    }
    await refreshing.get(key);
    account = q.get.get(userId, platform);
  }
  return unseal(account.secrets).access;
}

const connectStates = new Map(); // durum -> { platform, userId, expires }

function accountsView(userId) {
  const linked = new Map(q.all.all(userId).map((a) => [a.platform, a.name]));
  return {
    accounts: Object.entries(PLATFORMS).map(([platform, p]) => ({ platform, label: p.label, ready: isReady(platform), connected: linked.has(platform), name: linked.get(platform) ?? null, note: p.note })),
  };
}

export async function accountsRoute(method, pathname, body, member, guildId) {
  const userId = member.id;
  if (pathname === '/music-accounts') return method === 'GET' ? accountsView(userId) : { __status: 405, error: 'Geçersiz istek.' };
  const m = pathname.match(/^\/music-accounts\/(spotify|youtube)\/(\w+)$/);
  if (!m) return { __status: 404, error: 'Bulunamadı.' };
  const [, platform, action] = m;
  const p = PLATFORMS[platform];

  if (method === 'GET' && action === 'playlists') {
    const access = await session(userId, platform).catch(apiFail(p));
    return { playlists: await p.playlists(access).catch(apiFail(p)) };
  }
  if (method !== 'POST') return { __status: 405, error: 'Geçersiz istek.' };
  switch (action) {
    case 'connect': {
      if (!isReady(platform)) throw new UserError(`${p.label} bağlantısı henüz ayarlanmadı. Bir yöneticiye haber ver.`);
      const now = Date.now();
      for (const [state, saved] of connectStates) if (saved.expires < now) connectStates.delete(state);
      const state = randomBytes(24).toString('hex');
      connectStates.set(state, { platform, userId, expires: now + STATE_TTL });
      return { url: p.authUrl(state) };
    }
    case 'disconnect':
      q.remove.run(userId, platform);
      return accountsView(userId);
    case 'import': {
      const id = String(body.id ?? '').slice(0, 80);
      const access = await session(userId, platform).catch(apiFail(p));
      let tracks = await p.tracks(access, id).catch(apiFail(p));
      let name = String(body.name ?? '').trim();
      if (tracks === null) {
        // Başkasının listesi: herkese açık sayfadan okunur
        const link = p.publicLink(id);
        if (!link) throw new UserError('Bu listenin şarkıları okunamadı.');
        const read = await readMusicLink(new URL(link), userId);
        tracks = read.tracks;
        name ||= read.name;
      } else {
        // Hesaptan gelenler henüz YouTube araması değilse (Spotify) çalınırken aranacak biçime çevrilir
        tracks = tracks.slice(0, MAX_IMPORT).map((t) => (t.url ? { ...t, uploader: t.artist, live: false } : lazyTrack(t, userId)));
      }
      if (!tracks.length) throw new UserError('Bu listede aktarılabilecek şarkı yok.');
      return importList(guildId, userId, name || `${p.label} listesi`, tracks);
    }
    default:
      return { __status: 404, error: 'Bulunamadı.' };
  }
}

/** Platform hatası üyeye anlaşılır gösterilir */
const apiFail = (p) => (error) => {
  if (error instanceof ApiError) {
    if (error.status === 401) throw new UserError(`${p.label} oturumun düşmüş. Hesabı kaldırıp yeniden bağla.`);
    if (error.status === 403) throw new UserError(`${p.label} bu işleme izin vermedi.`);
    if (error.status === 429) throw new UserError(`${p.label} çok fazla istek dedi. Biraz sonra yeniden dene.`);
    throw new UserError(`${p.label} yanıt vermedi: ${error.message}`);
  }
  if (error instanceof UserError) throw error;
  // Ağ hatası / zaman aşımı
  console.warn(`[Müzik] ${p.label} isteği başarısız: ${String(error?.cause?.message ?? error?.message ?? error).slice(0, 200)}`);
  throw new UserError(`${p.label} şu an yanıt vermiyor. Biraz sonra yeniden dene.`);
};

/** GET /music/callback/:platform — tarayıcıdaki giriş buraya döner */
export async function musicCallback(res, pathname, query) {
  const m = pathname.match(/^\/music\/callback\/(spotify|youtube)$/);
  if (!m) return page(res, 404, 'Bulunamadı', 'Bu adres geçersiz.');
  const platform = m[1];
  const state = query.get('state');
  const saved = state && connectStates.get(state);
  if (state) connectStates.delete(state);
  if (!saved || saved.platform !== platform || saved.expires < Date.now()) return page(res, 400, 'Bağlantı kurulamadı', 'Bağlantının süresi dolmuş. Etkinlikten yeniden dene.');
  const code = query.get('code');
  if (!code) return page(res, 400, 'Bağlantı iptal edildi', 'İzin verilmedi. Etkinlikten yeniden deneyebilirsin.');
  const p = PLATFORMS[platform];
  try {
    const result = await p.connect(code);
    q.save.run(saved.userId, platform, String(result.name).slice(0, 80), seal(result.secrets), result.expiresAt, Date.now());
    console.log(`[Müzik] ${saved.userId} ${p.label} hesabını bağladı`);
    page(res, 200, `${p.label} bağlandı`, `${result.name} hesabın Karia'ya bağlandı. Bu sekmeyi kapatıp etkinliğe dönebilirsin.`);
  } catch (error) {
    const text = error instanceof UserError ? error.message : 'Platform bağlantıyı onaylamadı. Biraz sonra yeniden dene.';
    if (!(error instanceof UserError)) console.error(`[Müzik] ${platform} bağlantısı başarısız: ${String(error?.message ?? error).slice(0, 200)}`);
    // 502 kullanılmaz: Cloudflare 502/504'te kendi sayfasını gösterir
    page(res, error instanceof UserError ? 400 : 500, 'Bağlantı kurulamadı', text);
  }
}
