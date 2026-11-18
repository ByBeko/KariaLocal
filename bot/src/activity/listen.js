// Etkinlikte bot olmadan dinleme: şarkı sunucuda m4a olarak indirilip önbelleğe alınır, etkinlik <audio> ile çalar.
// Kişisel dinlemede sıra tarayıcıdadır. Ortak dinlemede sıra burada, etkinlik odasına (instanceId) göre tutulur:
// odadaki herkes şarkının başladığı ana göre aynı yeri çalar.
// POST /listen/search {query}            → şarkılar (link ya da arama)
// POST /listen/prepare {src, next}       → { audio, duration } (next arka planda hazırlanır)
// GET  /party/:oda                       → oda durumu
// POST /party/:oda/:hamle                → join, leave, add {tracks}, search {query}, list {id, shuffle}, pause, skip, previous, stop, shuffle, loop, remove {index}
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UserError } from '../utils/errors.js';
import { downloadAudio, isPlayableSource, resolveQuery } from '../systems/music.js';
import { coverPath } from '../systems/playlistImport.js';
import { listTracks } from './playlists.js';

const CACHE_DIR = path.join(process.env.KARIA_DATA_DIR || path.join(import.meta.dirname, '..', '..', 'data'), 'music-cache');
const CACHE_LIMIT = Math.max(100, Number(process.env.MUSIC_CACHE_MB) || 1024) * 1024 * 1024;
const MAX_DOWNLOADS = 2; // aynı anda indirilen şarkı: VM'yi yormasın
const LINK_TTL = 6 * 3600_000;
const START_DELAY = 1500; // ortak odada şarkı herkes yükleyebilsin diye biraz sonra başlar
const LISTENER_TTL = 20_000;
const ROOM_TTL = 15 * 60_000;
const MAX_ROOM_TRACKS = 200;
const SECRET = randomBytes(32); // ses bağlantılarını imzalar; yeniden başlatınca eski bağlantılar geçersiz olur

mkdirSync(CACHE_DIR, { recursive: true });

const keyOf = (src) => createHash('sha256').update(src).digest('hex').slice(0, 32);
const ytOf = (url) => url?.match(/(?:[?&]v=|youtu\.be\/)([\w-]{11})/)?.[1] ?? null;

// ── Kapaklar: etkinlik i.ytimg.com'u yükleyemez; sadece burada görülen videoların kapağı verilir ──
const seenThumbs = new Set();
const rememberThumb = (id) => {
  if (!id) return;
  if (seenThumbs.size > 2000) seenThumbs.clear();
  seenThumbs.add(id);
};
export const isKnownThumb = (id) => seenThumbs.has(id);

/** İstemciye giden şarkı özeti */
function brief(t) {
  const yt = ytOf(t.url) ?? (/^[\w-]{11}$/.test(t.yt ?? '') ? t.yt : null);
  rememberThumb(yt);
  return { src: t.url, title: t.title, artist: t.uploader ?? '', duration: Number(t.duration) || 0, thumb: yt, cover: coverPath(t.thumbnail), thumbnail: t.thumbnail ?? null };
}

/** İstemciden gelen şarkı (kaynak ve kapak denetlenir) */
function fromClient(t) {
  if (!isPlayableSource(t?.src)) throw new UserError('Bu şarkı çalınamaz.');
  const thumbnail = typeof t.thumbnail === 'string' && coverPath(t.thumbnail) ? t.thumbnail : null;
  return { url: t.src, title: String(t.title ?? '').slice(0, 200) || 'Bilinmeyen şarkı', uploader: String(t.artist ?? '').slice(0, 200), duration: Math.max(0, Number(t.duration) || 0), thumbnail };
}

// ── Önbellek ──
const pending = new Map(); // anahtar -> indirme sözü
let running = 0;
const waiting = [];

async function withSlot(action) {
  while (running >= MAX_DOWNLOADS) await new Promise((resolve) => waiting.push(resolve));
  running++;
  try {
    return await action();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function readMeta(key) {
  try {
    return JSON.parse(readFileSync(path.join(CACHE_DIR, `${key}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** Önbellek sınırı aşılınca en uzun süredir çalınmayan şarkılar silinir */
function trimCache() {
  const files = readdirSync(CACHE_DIR)
    .filter((name) => name.endsWith('.m4a'))
    .map((name) => {
      try {
        const stat = statSync(path.join(CACHE_DIR, name));
        return { key: name.slice(0, -4), size: stat.size, used: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  let total = files.reduce((sum, f) => sum + f.size, 0);
  if (total <= CACHE_LIMIT) return;
  files.sort((a, b) => a.used - b.used);
  for (const f of files) {
    if (total <= CACHE_LIMIT * 0.85) break;
    if (pending.has(f.key) || Date.now() - f.used < 10 * 60_000) continue;
    for (const ext of ['m4a', 'json']) rmSync(path.join(CACHE_DIR, `${f.key}.${ext}`), { force: true });
    total -= f.size;
  }
}

// Yarım kalmış indirmeler (bot kapanırken) temizlenir
for (const name of readdirSync(CACHE_DIR)) if (name.includes('.dl.')) rmSync(path.join(CACHE_DIR, name), { force: true });

/** Şarkıyı çalınabilir hale getirir (önbellekte yoksa indirir). Dönüş: { key, duration, yt } */
export function prepare(src, hint = {}) {
  if (!isPlayableSource(src)) return Promise.reject(new UserError('Bu şarkı çalınamaz.'));
  const key = keyOf(src);
  const file = path.join(CACHE_DIR, `${key}.m4a`);
  const meta = existsSync(file) && readMeta(key);
  if (meta) {
    const now = new Date();
    try {
      utimesSync(file, now, now);
    } catch {}
    rememberThumb(meta.yt);
    return Promise.resolve(meta);
  }
  if (!pending.has(key)) {
    const job = withSlot(async () => {
      const info = await downloadAudio({ url: src, title: String(hint.title ?? ''), duration: Number(hint.duration) || 0 }, file);
      const saved = { key, duration: info.duration || Number(hint.duration) || 0, yt: /^[\w-]{11}$/.test(info.id) ? info.id : null };
      writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(saved));
      rememberThumb(saved.yt);
      return saved;
    }).finally(() => {
      pending.delete(key);
      try {
        trimCache();
      } catch (error) {
        console.warn('[Müzik önbelleği]', error.message);
      }
    });
    pending.set(key, job);
  }
  return pending.get(key);
}

// ── İmzalı ses bağlantısı: <audio> başlık gönderemez, erişim bağlantının imzasıyla denetlenir ──
const sign = (text) => createHmac('sha256', SECRET).update(text).digest('base64url').slice(0, 22);

function audioLink(key) {
  const exp = (Date.now() + LINK_TTL).toString(36);
  return `audio/${key}.${exp}.${sign(`${key}.${exp}`)}.m4a`;
}

/** GET /api/audio/:imzalı-ad → m4a (Range destekli: ileri sarma ve iOS için gerekli) */
export function serveAudio(req, res, name) {
  const fail = (status) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end();
  };
  const m = name.match(/^([0-9a-f]{32})\.([0-9a-z]{6,12})\.([\w-]{22})\.m4a$/);
  if (!m) return fail(404);
  const expected = Buffer.from(sign(`${m[1]}.${m[2]}`));
  if (expected.length !== m[3].length || !timingSafeEqual(expected, Buffer.from(m[3])) || parseInt(m[2], 36) < Date.now()) return fail(403);
  const file = path.join(CACHE_DIR, `${m[1]}.m4a`);
  let size;
  try {
    size = statSync(file).size;
  } catch {
    return fail(404);
  }
  let start = 0;
  let end = size - 1;
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    } else start = Math.max(0, size - Number(range[2]));
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
  }
  const headers = { 'Content-Type': 'audio/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'private, max-age=21600' };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

// ── Kişisel dinleme ──
export async function listenRoute(method, pathname, body, member) {
  if (method !== 'POST') return { __status: 405, error: 'Geçersiz istek.' };
  if (pathname === '/listen/search') {
    const query = String(body.query ?? '').trim().slice(0, 500);
    if (!query) throw new UserError('Şarkı adı ya da link yaz.');
    const { tracks, playlist } = await resolveQuery(query, member.id);
    return { tracks: tracks.filter((t) => !t.live).slice(0, MAX_ROOM_TRACKS).map(brief), playlist };
  }
  if (pathname === '/listen/prepare') {
    const src = String(body.src ?? '');
    const meta = await prepare(src, { title: body.title, duration: body.duration });
    if (body.next && isPlayableSource(body.next)) prepare(body.next).catch(() => {}); // sıradaki beklemeden başlasın
    return { audio: audioLink(meta.key), duration: meta.duration, yt: meta.yt };
  }
  return { __status: 404, error: 'Bulunamadı.' };
}

// ── Ortak dinleme odaları ──
const rooms = new Map(); // etkinlik odası -> oda

function getRoom(id, create) {
  let room = rooms.get(id);
  if (!room && create) {
    room = { id, tracks: [], history: [], current: null, loop: 'off', listeners: new Map(), touched: Date.now(), notice: '' };
    rooms.set(id, room);
  }
  return room ?? null;
}

const roomPosition = (c) => (!c?.startAt ? 0 : c.pausedAt !== null ? c.pausedAt : Math.max(0, (Date.now() - c.startAt) / 1000));

function startTrack(room, track) {
  const current = { track, audio: null, duration: track.duration, yt: ytOf(track.url), startAt: null, pausedAt: null };
  room.current = current;
  prepare(track.url, track)
    .then((meta) => {
      if (room.current !== current) return;
      current.audio = audioLink(meta.key);
      current.duration = meta.duration || track.duration;
      current.yt = meta.yt ?? current.yt;
      current.startAt = Date.now() + START_DELAY;
      const next = room.loop === 'track' ? null : room.tracks[0];
      if (next) prepare(next.url, next).catch(() => {});
    })
    .catch((error) => {
      if (room.current !== current) return;
      room.notice = `${track.title} çalınamadı: ${error instanceof UserError ? error.message : 'bir hata oluştu.'}`;
      advance(room, { failed: true });
    });
}

/** Sıradaki şarkıya geçer; döngü ayarına göre biten şarkı tekrar ya da sona eklenir */
function advance(room, { force = false, failed = false } = {}) {
  const finished = room.current?.track;
  if (finished && !failed) {
    if (room.loop === 'track' && !force) room.tracks.unshift(finished);
    else {
      room.history.push(finished);
      if (room.history.length > 20) room.history.shift();
      if (room.loop === 'queue') room.tracks.push(finished);
    }
  }
  const next = room.tracks.shift();
  if (next) startTrack(room, next);
  else room.current = null;
}

/** Bitmiş şarkı, oda bakılınca ilerletilir (odadakiler 2 saniyede bir sorar) */
function tick(room) {
  const c = room.current;
  if (c?.startAt && c.pausedAt === null && c.duration && roomPosition(c) >= c.duration + 1) advance(room);
}

function roomView(room, userId) {
  tick(room);
  const c = room.current;
  const now = Date.now();
  for (const [id, l] of room.listeners) if (now - l.at > LISTENER_TTL) room.listeners.delete(id);
  const notice = room.notice;
  if (notice) room.notice = '';
  return {
    party: true,
    now,
    playing: Boolean(c),
    loading: Boolean(c && !c.startAt),
    paused: Boolean(c && c.pausedAt !== null),
    current: c ? { ...brief(c.track), thumb: c.yt, duration: c.duration } : null,
    audio: c?.audio ?? null,
    startAt: c?.startAt ?? null,
    position: roomPosition(c),
    loop: room.loop,
    canBack: room.history.length > 0,
    upcoming: room.tracks.slice(0, 50).map(brief),
    remaining: room.tracks.length,
    listeners: [...room.listeners.values()].map((l) => l.name),
    me: userId,
    notice: notice || undefined,
  };
}

function addToRoom(room, tracks) {
  const space = MAX_ROOM_TRACKS - room.tracks.length;
  if (space <= 0) throw new UserError(`Sıra dolu (en fazla ${MAX_ROOM_TRACKS} şarkı).`);
  const added = tracks.filter((t) => !t.live).slice(0, space);
  room.tracks.push(...added);
  if (!room.current) advance(room);
  return added.length;
}

export async function partyRoute(method, pathname, body, member, guildId) {
  const m = pathname.match(/^\/party\/([\w.:-]{4,120})(?:\/(\w+))?$/);
  if (!m) return { __status: 404, error: 'Bulunamadı.' };
  const [, roomId, action] = m;
  const room = getRoom(roomId, method === 'POST' && action === 'join');
  if (!room) return method === 'GET' ? { party: true, playing: false, upcoming: [], remaining: 0, listeners: [], now: Date.now(), closed: true } : { __status: 404, error: 'Ortak dinleme odası kapanmış. Yeniden katıl.' };
  room.touched = Date.now();
  if (action !== 'leave') room.listeners.set(member.id, { name: member.displayName, at: Date.now() });
  if (method === 'GET' && !action) return roomView(room, member.id);
  if (method !== 'POST' || !action) return { __status: 405, error: 'Geçersiz istek.' };

  const needCurrent = () => {
    if (!room.current) throw new UserError('Şu an bir şey çalmıyor.');
    return room.current;
  };
  let notice = '';
  switch (action) {
    case 'join':
      break;
    case 'leave':
      room.listeners.delete(member.id);
      return { ok: true };
    case 'add':
      notice = `${addToRoom(room, (Array.isArray(body.tracks) ? body.tracks : []).slice(0, MAX_ROOM_TRACKS).map(fromClient))} şarkı sıraya eklendi.`;
      break;
    case 'search': {
      const query = String(body.query ?? '').trim().slice(0, 500);
      if (!query) throw new UserError('Şarkı adı ya da link yaz.');
      const { tracks } = await resolveQuery(query, member.id);
      notice = `${addToRoom(room, tracks)} şarkı sıraya eklendi.`;
      break;
    }
    case 'list': {
      const { list, tracks } = listTracks(guildId, member.id, body.id);
      if (body.shuffle) {
        for (let i = tracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
        }
      }
      notice = `${list.name}: ${addToRoom(room, tracks)} şarkı sıraya eklendi.`;
      break;
    }
    case 'pause': {
      const c = needCurrent();
      if (!c.startAt) break;
      if (c.pausedAt === null) c.pausedAt = roomPosition(c);
      else {
        c.startAt = Date.now() - c.pausedAt * 1000 + 600;
        c.pausedAt = null;
      }
      break;
    }
    case 'skip':
      needCurrent();
      advance(room, { force: true });
      break;
    case 'previous': {
      const prev = room.history.pop();
      if (!prev) throw new UserError('Önceki şarkı yok.');
      if (room.current) room.tracks.unshift(room.current.track);
      startTrack(room, prev);
      break;
    }
    case 'stop':
      room.tracks = [];
      room.current = null;
      break;
    case 'shuffle':
      if (room.tracks.length < 2) throw new UserError('Karıştırmak için sırada en az 2 şarkı olmalı.');
      for (let i = room.tracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [room.tracks[i], room.tracks[j]] = [room.tracks[j], room.tracks[i]];
      }
      break;
    case 'loop':
      room.loop = { off: 'track', track: 'queue', queue: 'off' }[room.loop];
      break;
    case 'remove': {
      const index = Number(body.index);
      if (!Number.isInteger(index) || !room.tracks[index]) throw new UserError('Şarkı bulunamadı.');
      room.tracks.splice(index, 1);
      break;
    }
    default:
      return { __status: 404, error: 'Bulunamadı.' };
  }
  const view = roomView(room, member.id);
  return notice ? { ...view, notice } : view;
}

// Boş odalar kapanır
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    for (const [userId, l] of room.listeners) if (now - l.at > LISTENER_TTL) room.listeners.delete(userId);
    if (!room.listeners.size && now - room.touched > ROOM_TTL) rooms.delete(id);
  }
}, 60_000).unref();
