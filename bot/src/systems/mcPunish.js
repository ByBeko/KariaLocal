// Minecraft ceza kayıtları: KariaCore (yetkili ve Grim AntiCheat cezaları) buraya yazar, karia.live/minecraft paneli okur.
// IP adresleri yalnızca panel yöneticilerine gösterilir ve 90 gün sonra silinir.
import { isIP } from 'node:net';
import { db } from '../core/database.js';
import { UserError } from '../utils/errors.js';

const IP_TTL = 90 * 86_400_000;
const TYPES = new Set(['ban', 'mute', 'kick', 'unban', 'unmute']);
const SOURCES = new Set(['yetkili', 'konsol', 'grim']);

db.exec(`
  CREATE TABLE IF NOT EXISTS mc_punishments (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    type TEXT NOT NULL,
    uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    ip TEXT,
    reason TEXT NOT NULL,
    staff TEXT NOT NULL,
    staff_uuid TEXT,
    source TEXT NOT NULL,
    at INTEGER NOT NULL,
    until INTEGER NOT NULL DEFAULT 0,
    ref_id TEXT,
    revoked_at INTEGER,
    revoked_by TEXT,
    received_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS mc_punishments_uuid ON mc_punishments (guild_id, uuid);
  CREATE INDEX IF NOT EXISTS mc_punishments_at ON mc_punishments (guild_id, at);
`);

const q = {
  insert: db.prepare(`INSERT OR IGNORE INTO mc_punishments (id, guild_id, type, uuid, name, ip, reason, staff, staff_uuid, source, at, until, ref_id, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  revoke: db.prepare('UPDATE mc_punishments SET revoked_at=?, revoked_by=? WHERE id=? AND guild_id=? AND revoked_at IS NULL'),
  purgeIp: db.prepare('UPDATE mc_punishments SET ip=NULL WHERE ip IS NOT NULL AND at<?'),
  latest: db.prepare('SELECT * FROM mc_punishments WHERE guild_id=? ORDER BY at DESC LIMIT 500'),
  byUuid: db.prepare('SELECT * FROM mc_punishments WHERE guild_id=? AND uuid=? ORDER BY at DESC LIMIT 50'),
  link: db.prepare('SELECT uuid, name FROM mc_links WHERE guild_id=? AND user_id=?'),
  counts: db.prepare(`SELECT
      SUM(CASE WHEN type='ban' AND revoked_at IS NULL AND (until=0 OR until>?) THEN 1 ELSE 0 END) AS bans,
      SUM(CASE WHEN type='mute' AND revoked_at IS NULL AND (until=0 OR until>?) THEN 1 ELSE 0 END) AS mutes,
      SUM(CASE WHEN at>? AND type IN ('ban','mute','kick') THEN 1 ELSE 0 END) AS day,
      SUM(CASE WHEN source='grim' THEN 1 ELSE 0 END) AS grim
    FROM mc_punishments WHERE guild_id=?`),
};

const clean = (value, max) => String(value ?? '').replace(/[\p{Cc}§]/gu, '').trim().slice(0, max);
const uuidOk = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const time = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 && n < 8_000_000_000_000 ? n : null;
};

let lastPurge = 0;

/** Eklentiden gelen kayıt. Aynı kimlik ikinci kez gelirse yok sayılır (eklenti ağ hatasında yeniden gönderir). */
export function recordPunishment(guildId, body) {
  const id = String(body.id ?? '');
  const type = String(body.type ?? '');
  const uuid = String(body.uuid ?? '').toLowerCase();
  const name = String(body.name ?? '');
  const source = String(body.source ?? '');
  const at = time(body.at);
  const until = time(body.until ?? 0);
  if (!/^K[A-Z0-9]{6}$/.test(id) || !TYPES.has(type) || !uuidOk(uuid) || !/^\.?[A-Za-z0-9_]{1,16}$/.test(name) || !SOURCES.has(source) || at === null || until === null) {
    throw new UserError('Geçersiz ceza kaydı.');
  }
  const ip = body.ip && isIP(String(body.ip)) ? String(body.ip) : null;
  const staffUuid = body.staffUuid && uuidOk(String(body.staffUuid).toLowerCase()) ? String(body.staffUuid).toLowerCase() : null;
  const refId = /^K[A-Z0-9]{6}$/.test(String(body.refId ?? '')) ? String(body.refId) : null;
  const staff = clean(body.staff, 32) || 'Bilinmiyor';
  const now = Date.now();

  const inserted = Number(q.insert.run(id, guildId, type, uuid, name, ip, clean(body.reason, 200) || '-', staff, staffUuid, source, at, until, refId, now).changes) > 0;
  if (inserted && refId && (type === 'unban' || type === 'unmute')) q.revoke.run(at, staff, refId, guildId);
  if (now - lastPurge > 3_600_000) {
    lastPurge = now;
    q.purgeIp.run(now - IP_TTL);
  }
  return { ok: true, duplicate: !inserted };
}

function view(row, withPrivate) {
  const now = Date.now();
  const lasting = row.type === 'ban' || row.type === 'mute';
  const active = lasting && !row.revoked_at && (Number(row.until) === 0 || Number(row.until) > now);
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    reason: row.reason,
    staff: row.staff,
    source: row.source,
    at: Number(row.at),
    until: Number(row.until),
    active,
    revokedAt: row.revoked_at ? Number(row.revoked_at) : null,
    revokedBy: row.revoked_by ?? null,
    refId: row.ref_id ?? null,
    ...(withPrivate ? { uuid: row.uuid, ip: row.ip ?? null } : {}),
  };
}

/** Yönetici görünümü: son 500 kayıt (IP ve UUID dahil) ve özet sayılar */
export function punishmentLog(guildId) {
  const now = Date.now();
  const c = q.counts.get(now, now, now - 86_400_000, guildId) ?? {};
  return {
    summary: { bans: Number(c.bans ?? 0), mutes: Number(c.mutes ?? 0), day: Number(c.day ?? 0), grim: Number(c.grim ?? 0) },
    rows: q.latest.all(guildId).map((r) => view(r, true)),
  };
}

/** Üyenin kendi bağlı Minecraft hesabının ceza durumu (IP gösterilmez) */
export function myPunishments(guildId, userId) {
  const link = q.link.get(guildId, userId);
  if (!link) return { linked: false, rows: [] };
  return { linked: true, name: link.name, rows: q.byUuid.all(guildId, link.uuid).map((r) => view(r, false)) };
}
