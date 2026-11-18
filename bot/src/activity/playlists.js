// Etkinlikteki kişisel çalma listeleri. Şarkının bilgisi kaydedilir; çalarken yeniden aranmaz.
// GET  /playlists                 → listelerim
// GET  /playlists/:id             → listedeki şarkılar
// POST /playlists {name}          → yeni liste
// POST /playlists/import {url}     → linkteki listeyi (YouTube, Spotify, Deezer, Apple Music, SoundCloud) yeni liste olarak aktarır
// POST /playlists/:id/:hamle      → add {source: current|queue|query|tracks, query, tracks}, remove {index}, rename {name}, cover {image: jpeg data URL | null}, delete, play {shuffle}
// GET  /plcover/:id.jpg (server.js) → listenin kendi kapağı (listCoverImage)
import { db } from '../core/database.js';
import { UserError } from '../utils/errors.js';
import { getQueue, resolveQuery, playTracks, isPlayableSource } from '../systems/music.js';
import { coverPath } from '../systems/playlistImport.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS playlists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id INTEGER NOT NULL,
    pos         INTEGER NOT NULL,
    title       TEXT NOT NULL,
    uploader    TEXT NOT NULL DEFAULT '',
    duration    INTEGER NOT NULL DEFAULT 0,
    url         TEXT NOT NULL,
    thumbnail   TEXT,
    PRIMARY KEY (playlist_id, pos)
  );
`);

// Listenin kendi kapağı (profil resmi): istemcide 192px JPEG'e küçültülür, burada saklanır
if (!db.prepare('PRAGMA table_info(playlists)').all().some((column) => column.name === 'image')) {
  db.exec('ALTER TABLE playlists ADD COLUMN image BLOB');
  db.exec('ALTER TABLE playlists ADD COLUMN image_at INTEGER');
}
const MAX_COVER = 12 * 1024;

const MAX_LISTS = 20;
const MAX_TRACKS = 200;

const q = {
  lists: db.prepare(`SELECT p.id, p.name, p.image_at, COUNT(t.pos) AS count, COALESCE(SUM(t.duration), 0) AS duration
    FROM playlists p LEFT JOIN playlist_tracks t ON t.playlist_id = p.id
    WHERE p.guild_id=? AND p.user_id=? GROUP BY p.id ORDER BY p.created_at DESC`),
  count: db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE guild_id=? AND user_id=?'),
  get: db.prepare('SELECT * FROM playlists WHERE id=? AND guild_id=? AND user_id=?'),
  create: db.prepare('INSERT INTO playlists (guild_id, user_id, name, created_at) VALUES (?, ?, ?, ?)'),
  rename: db.prepare('UPDATE playlists SET name=? WHERE id=?'),
  setImage: db.prepare('UPDATE playlists SET image=?, image_at=? WHERE id=?'),
  image: db.prepare('SELECT image FROM playlists WHERE id=?'),
  remove: db.prepare('DELETE FROM playlists WHERE id=?'),
  tracks: db.prepare('SELECT * FROM playlist_tracks WHERE playlist_id=? ORDER BY pos'),
  firstTracks: db.prepare('SELECT url, thumbnail FROM playlist_tracks WHERE playlist_id=? ORDER BY pos LIMIT 12'),
  clearTracks: db.prepare('DELETE FROM playlist_tracks WHERE playlist_id=?'),
  addTrack: db.prepare('INSERT INTO playlist_tracks (playlist_id, pos, title, uploader, duration, url, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?)'),
};

function cleanName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) throw new UserError('Listeye bir ad ver.');
  return name;
}

function own(guildId, userId, id) {
  const list = q.get.get(Number(id), guildId, userId);
  if (!list) throw new UserError('Bu çalma listesi bulunamadı.');
  return list;
}

const ytId = (url) => url.match(/[?&]v=([\w-]{11})/)?.[1] ?? null;

// Liste kartı kapağı: ilk şarkıların farklı kapaklarından en çok 4'ü (aktarılan kapak ya da YouTube küçük resmi)
function listCovers(listId) {
  const covers = [];
  for (const t of q.firstTracks.all(listId)) {
    const yt = ytId(t.url) ?? t.thumbnail?.match(/^https:\/\/i\.ytimg\.com\/vi\/([\w-]{11})\//)?.[1];
    const src = coverPath(t.thumbnail) ?? (yt ? `thumb/${yt}.jpg` : null);
    if (src && !covers.includes(src)) covers.push(src);
    if (covers.length === 4) break;
  }
  return covers;
}

function view(list) {
  const tracks = q.tracks.all(list.id).map((t) => ({ title: t.title, artist: t.uploader, duration: Number(t.duration), yt: ytId(t.url), src: t.url, cover: coverPath(t.thumbnail), thumbnail: t.thumbnail }));
  return { id: list.id, name: list.name, image: imageUrl(list), tracks, duration: tracks.reduce((s, t) => s + t.duration, 0) };
}

const imageUrl = (list) => (list.image_at ? `plcover/${list.id}.jpg?v=${list.image_at}` : null);

/** Kapak resmi (server.js /plcover/:id.jpg); liste kimliği tahmin edilse bile yalnızca resim döner */
export function listCoverImage(id) {
  return q.image.get(Number(id))?.image ?? null;
}

/** Etkinlikte (bot olmadan) çalınan şarkılar istemciden gelir: kaynak ve kapak denetlenir */
function clientTracks(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new UserError('Eklenecek şarkı yok.');
  const tracks = raw.slice(0, MAX_TRACKS).filter((t) => isPlayableSource(t?.src)).map((t) => {
    const thumbnail = typeof t.thumbnail === 'string' && (coverPath(t.thumbnail) || /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/hqdefault\.jpg$/.test(t.thumbnail)) ? t.thumbnail : null;
    return { title: String(t.title ?? '').slice(0, 200) || 'Bilinmeyen şarkı', uploader: String(t.artist ?? '').slice(0, 200), duration: Math.max(0, Math.trunc(Number(t.duration) || 0)), url: t.src, thumbnail };
  });
  if (!tracks.length) throw new UserError('Bu şarkılar listeye eklenemez.');
  return tracks;
}

/** Listedeki şarkılar, çalma sırasına eklenecek biçimde */
export function listTracks(guildId, userId, id, requesterId = userId) {
  const list = own(guildId, userId, id);
  const rows = q.tracks.all(list.id);
  if (!rows.length) throw new UserError('Liste boş, önce şarkı ekle.');
  const tracks = rows.map((t) => {
    const yt = ytId(t.url);
    return { id: yt ?? t.url, title: t.title, duration: Number(t.duration), uploader: t.uploader, url: t.url, thumbnail: t.thumbnail ?? (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null), live: false, requesterId };
  });
  return { list, tracks };
}

/** Dışarıdan gelen şarkılarla yeni liste açar (link ya da bağlı hesap aktarımı) */
export function importList(guildId, userId, name, tracks) {
  if (Number(q.count.get(guildId, userId).n) >= MAX_LISTS) throw new UserError(`En fazla ${MAX_LISTS} çalma listen olabilir. Önce birini sil.`);
  const id = Number(q.create.run(guildId, userId, cleanName(name || 'Aktarılan liste'), Date.now()).lastInsertRowid);
  const list = own(guildId, userId, id);
  try {
    const added = addTracks(list, tracks);
    return { list: view(list), notice: `${list.name}: ${added} şarkı aktarıldı.` };
  } catch (error) {
    q.remove.run(id); // boş liste kalmasın
    throw error;
  }
}

/** Şarkıları sırayla yeniden yazar (silme ve eklemede sıra boşluksuz kalır) */
function writeTracks(listId, tracks) {
  db.exec('BEGIN');
  try {
    q.clearTracks.run(listId);
    tracks.forEach((t, i) => q.addTrack.run(listId, i, t.title, t.uploader ?? '', Math.trunc(Number(t.duration) || 0), t.url, t.thumbnail ?? null));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function addTracks(list, incoming) {
  const tracks = q.tracks.all(list.id);
  const urls = new Set(tracks.map((t) => t.url));
  const fresh = incoming.filter((t) => t.url && !t.live && !urls.has(t.url) && urls.add(t.url));
  if (!fresh.length) throw new UserError('Bu şarkılar zaten listede.');
  const room = MAX_TRACKS - tracks.length;
  if (room <= 0) throw new UserError(`Bir listede en fazla ${MAX_TRACKS} şarkı olabilir.`);
  const added = fresh.slice(0, room);
  writeTracks(list.id, [...tracks.map((t) => ({ ...t, uploader: t.uploader })), ...added]);
  return added.length;
}

export async function playlistRoute(method, path, body, member, guildId) {
  const userId = member.id;

  if (path === '/playlists') {
    if (method === 'GET') return { lists: q.lists.all(guildId, userId).map((l) => ({ id: l.id, name: l.name, count: Number(l.count), duration: Number(l.duration), covers: listCovers(l.id), image: imageUrl(l) })) };
    if (method !== 'POST') return { __status: 405, error: 'Geçersiz istek.' };
    if (Number(q.count.get(guildId, userId).n) >= MAX_LISTS) throw new UserError(`En fazla ${MAX_LISTS} çalma listen olabilir.`);
    const id = Number(q.create.run(guildId, userId, cleanName(body.name), Date.now()).lastInsertRowid);
    return { list: view(own(guildId, userId, id)) };
  }

  if (path === '/playlists/import') {
    if (method !== 'POST') return { __status: 405, error: 'Geçersiz istek.' };
    const url = String(body.url ?? '').trim().slice(0, 500);
    if (!/^https?:\/\//i.test(url)) throw new UserError('Listenin linkini yapıştır.');
    const { tracks, name } = await resolveQuery(url, userId);
    return importList(guildId, userId, name, tracks);
  }

  const match = path.match(/^\/playlists\/(\d+)(?:\/(\w+))?$/);
  if (!match) return { __status: 404, error: 'Bulunamadı.' };
  const list = own(guildId, userId, match[1]);
  const action = match[2];
  if (method === 'GET' && !action) return { list: view(list) };
  if (method !== 'POST' || !action) return { __status: 405, error: 'Geçersiz istek.' };

  switch (action) {
    case 'add': {
      let incoming;
      if (body.source === 'current' || body.source === 'queue') {
        const queue = getQueue(guildId);
        if (!queue?.current) throw new UserError('Şu an bir şey çalmıyor.');
        incoming = body.source === 'current' ? [queue.current] : [queue.current, ...queue.tracks];
      } else if (body.source === 'tracks') {
        incoming = clientTracks(body.tracks);
      } else {
        const query = String(body.query ?? '').trim().slice(0, 500);
        if (!query) throw new UserError('Şarkı adı ya da link yaz.');
        incoming = (await resolveQuery(query, userId)).tracks;
      }
      const added = addTracks(list, incoming);
      return { list: view(list), notice: `${added} şarkı eklendi.` };
    }
    case 'remove': {
      const tracks = q.tracks.all(list.id);
      const index = Number(body.index);
      if (!Number.isInteger(index) || index < 0 || index >= tracks.length) throw new UserError('Şarkı bulunamadı.');
      tracks.splice(index, 1);
      writeTracks(list.id, tracks);
      return { list: view(list) };
    }
    case 'move': {
      const tracks = q.tracks.all(list.id);
      const from = Number(body.index);
      const to = from + (body.dir === 'up' ? -1 : 1);
      if (!Number.isInteger(from) || !tracks[from] || !tracks[to]) throw new UserError('Taşınamaz.');
      [tracks[from], tracks[to]] = [tracks[to], tracks[from]];
      writeTracks(list.id, tracks);
      return { list: view(list) };
    }
    case 'rename':
      q.rename.run(cleanName(body.name), list.id);
      return { list: view(own(guildId, userId, list.id)) };
    case 'cover': {
      if (body.image == null) {
        q.setImage.run(null, null, list.id);
      } else {
        const m = String(body.image).match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
        const image = m ? Buffer.from(m[1], 'base64') : null;
        if (!image || image.length > MAX_COVER || image[0] !== 0xff || image[1] !== 0xd8) throw new UserError('Resim yüklenemedi, başka bir resim dene.');
        q.setImage.run(image, Date.now(), list.id);
      }
      return { list: view(own(guildId, userId, list.id)) };
    }
    case 'delete':
      q.clearTracks.run(list.id);
      q.remove.run(list.id);
      return { ok: true };
    case 'play': {
      const { tracks } = listTracks(guildId, userId, list.id);
      if (body.shuffle) {
        for (let i = tracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
        }
      }
      const channel = member.voice.channel;
      if (!channel) throw new UserError('Önce bir ses kanalına gir.');
      const { added } = await playTracks(member, channel, tracks);
      return { notice: `${list.name}: ${added} şarkı sıraya eklendi.` };
    }
    default:
      return { __status: 404, error: 'Bulunamadı.' };
  }
}
