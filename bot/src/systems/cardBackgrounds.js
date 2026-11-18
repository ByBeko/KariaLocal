// Seviye kartı arka planları: yöneticiler etkinlik panelinden yükler, üyeler coinle satın alıp kartlarında kullanır.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { db } from '../core/database.js';
import { UserError } from '../utils/errors.js';
import { takeMoney, getBalance } from './economy.js';
import { getProfile, getRewards } from './levels.js';
import { rankCard, CARD_W, CARD_H } from './cards.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS card_backgrounds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    price      INTEGER NOT NULL,
    image      BLOB NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1, -- 0: mağazadan kaldırıldı, sahipleri kullanmaya devam eder
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS card_owned (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    bg_id    INTEGER NOT NULL,
    at       INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, bg_id)
  );
  CREATE TABLE IF NOT EXISTS card_selected (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    bg_id    INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
`);

const q = {
  list: db.prepare('SELECT id, name, price, active FROM card_backgrounds WHERE guild_id=? ORDER BY id DESC'),
  get: db.prepare('SELECT id, name, price, active FROM card_backgrounds WHERE guild_id=? AND id=?'),
  image: db.prepare('SELECT image FROM card_backgrounds WHERE id=?'),
  add: db.prepare('INSERT INTO card_backgrounds (guild_id, name, price, image, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  hide: db.prepare('UPDATE card_backgrounds SET active=0 WHERE guild_id=? AND id=?'),
  price: db.prepare('UPDATE card_backgrounds SET price=?, name=? WHERE guild_id=? AND id=?'),
  owned: db.prepare('SELECT bg_id FROM card_owned WHERE guild_id=? AND user_id=?'),
  owns: db.prepare('SELECT 1 FROM card_owned WHERE guild_id=? AND user_id=? AND bg_id=?'),
  own: db.prepare('INSERT OR IGNORE INTO card_owned (guild_id, user_id, bg_id, at) VALUES (?, ?, ?, ?)'),
  owners: db.prepare('SELECT COUNT(*) n FROM card_owned WHERE guild_id=? AND bg_id=?'),
  selected: db.prepare('SELECT bg_id FROM card_selected WHERE guild_id=? AND user_id=?'),
  select: db.prepare('INSERT INTO card_selected (guild_id, user_id, bg_id) VALUES (?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET bg_id=excluded.bg_id'),
  unselect: db.prepare('DELETE FROM card_selected WHERE guild_id=? AND user_id=?'),
};

const MAX_UPLOAD = 6 * 1024 * 1024;
const MAX_PRICE = 10_000_000;
const imageCache = new Map(); // id -> Buffer (az sayıda, küçük JPEG)

export function backgroundImage(id) {
  const key = Number(id);
  if (!imageCache.has(key)) {
    const row = q.image.get(key);
    if (!row) return null;
    imageCache.set(key, Buffer.from(row.image));
  }
  return imageCache.get(key);
}

/** Üyenin kartında kullandığı arka plan resmi (yoksa null) */
export function selectedBackground(guildId, userId) {
  const row = q.selected.get(guildId, userId);
  return row ? backgroundImage(row.bg_id) : null;
}

const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
function cleanPrice(price) {
  const n = Math.trunc(Number(price));
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) throw new UserError(`Fiyat 0 ile ${MAX_PRICE.toLocaleString('tr-TR')} arasında olmalı.`);
  return n;
}

/** Yüklenen resmi kart boyutuna (cover) kırpıp JPEG'e çevirir */
async function toCardImage(dataUrl) {
  const match = String(dataUrl ?? '').match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new UserError('PNG, JPG, WEBP ya da GIF resmi seç.');
  const raw = Buffer.from(match[2], 'base64');
  if (raw.length > MAX_UPLOAD) throw new UserError('Resim en çok 6 MB olabilir.');
  let img;
  try {
    img = await loadImage(raw);
  } catch {
    throw new UserError('Resim okunamadı.');
  }
  if (img.width < 200 || img.height < 60) throw new UserError('Resim çok küçük (en az 934×282 önerilir).');
  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext('2d');
  const scale = Math.max(CARD_W / img.width, CARD_H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
  return canvas.encode('jpeg', 88);
}

const view = (r, extra = {}) => ({ id: Number(r.id), name: r.name, price: Number(r.price), active: Boolean(r.active), image: `cardbg/${r.id}.jpg`, ...extra });

// ── Üye tarafı ──
export function shopView(guildId, userId) {
  const owned = new Set(q.owned.all(guildId, userId).map((r) => Number(r.bg_id)));
  const selected = Number(q.selected.get(guildId, userId)?.bg_id ?? 0) || null;
  const items = q.list.all(guildId)
    .filter((r) => r.active || owned.has(Number(r.id)))
    .map((r) => view(r, { owned: owned.has(Number(r.id)), selected: selected === Number(r.id) }));
  return { items, selected, balance: getBalance(guildId, userId) };
}

export function buyBackground(guildId, userId, id) {
  const bg = q.get.get(guildId, Number(id));
  if (!bg || !bg.active) throw new UserError('Bu kart artık mağazada yok.');
  if (q.owns.get(guildId, userId, bg.id)) throw new UserError('Bu karta zaten sahipsin.');
  if (bg.price > 0) takeMoney(guildId, userId, Number(bg.price));
  q.own.run(guildId, userId, bg.id, Date.now());
  q.select.run(guildId, userId, bg.id); // satın alınan kart hemen takılır
  return shopView(guildId, userId);
}

export function useBackground(guildId, userId, id) {
  if (id === null || id === 0 || id === '0') {
    q.unselect.run(guildId, userId);
    return shopView(guildId, userId);
  }
  if (!q.owns.get(guildId, userId, Number(id))) throw new UserError('Önce bu kartı satın almalısın.');
  q.select.run(guildId, userId, Number(id));
  return shopView(guildId, userId);
}

/** Üyenin kendi bilgileriyle seviye kartı çizer. bgId: null → taktığı kart, 0 → varsayılan, sayı → o arka plan (önizleme) */
export async function cardPreview(guild, member, bgId) {
  const guildId = guild.id;
  let background = null;
  if (Number(bgId) === 0 && bgId !== null) {
    background = null;
  } else if (bgId) {
    const bg = q.get.get(guildId, Number(bgId));
    if (!bg) throw new UserError('Kart bulunamadı.');
    background = backgroundImage(bg.id);
  } else {
    background = selectedBackground(guildId, member.id);
  }
  const png = await rankCard(cardData(guild, member, background));
  return { image: `data:image/png;base64,${Buffer.from(png).toString('base64')}` };
}

/** /seviye ve önizleme için ortak kart verisi */
export function cardData(guild, member, background = selectedBackground(guild.id, member.id)) {
  const p = getProfile(guild.id, member.id);
  const next = getRewards(guild.id).find((r) => r.level > p.level);
  const nextRole = next && guild.roles.cache.get(next.roleId);
  return {
    name: member.displayName,
    tag: member.user.username,
    avatarURL: member.displayAvatarURL({ extension: 'png', size: 256 }),
    color: member.displayHexColor,
    level: p.level,
    rank: p.rank,
    xp: p.xp,
    current: p.current,
    needed: p.needed,
    nextReward: nextRole ? `@${nextRole.name} (seviye ${next.level})` : null,
    background,
  };
}

// ── Yönetici tarafı ──
export function adminList(guildId) {
  return { items: q.list.all(guildId).filter((r) => r.active).map((r) => view(r, { owners: Number(q.owners.get(guildId, r.id).n) })) };
}

export async function addBackground(guildId, memberId, { name, price, image }) {
  const title = cleanName(name);
  if (!title) throw new UserError('Karta bir isim ver.');
  const jpeg = await toCardImage(image);
  q.add.run(guildId, title, cleanPrice(price), jpeg, memberId, Date.now());
  return { ...adminList(guildId), added: title };
}

export function editBackground(guildId, id, { name, price }) {
  const bg = q.get.get(guildId, Number(id));
  if (!bg || !bg.active) throw new UserError('Kart bulunamadı.');
  q.price.run(cleanPrice(price), cleanName(name) || bg.name, guildId, bg.id);
  return adminList(guildId);
}

export function removeBackground(guildId, id) {
  const bg = q.get.get(guildId, Number(id));
  if (!bg || !bg.active) throw new UserError('Kart bulunamadı.');
  q.hide.run(guildId, bg.id);
  return { ...adminList(guildId), removed: bg.name };
}
