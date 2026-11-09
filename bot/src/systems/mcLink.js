// Minecraft hesabını Discord hesabına bağlar. Minecraft ayrı para tutmaz: bakiye botun cüzdanıdır (economy tablosu).
import { randomInt } from 'node:crypto';
import { db } from '../core/database.js';
import { UserError } from '../utils/errors.js';
import { addMoney, getBalance, takeMoney } from './economy.js';

const CODE_TTL = 10 * 60_000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW = 10 * 60_000;
const MAX_AMOUNT = 1_000_000_000;

const q = {
  byUser: db.prepare('SELECT * FROM mc_links WHERE guild_id=? AND user_id=?'),
  byUuid: db.prepare('SELECT * FROM mc_links WHERE guild_id=? AND uuid=?'),
  link: db.prepare('INSERT INTO mc_links (guild_id, user_id, uuid, name, linked_at) VALUES (?, ?, ?, ?, ?)'),
  unlink: db.prepare('DELETE FROM mc_links WHERE guild_id=? AND user_id=?'),
  rename: db.prepare('UPDATE mc_links SET name=? WHERE guild_id=? AND uuid=?'),
  purgeCodes: db.prepare('DELETE FROM mc_link_codes WHERE expires_at<? OR (guild_id=? AND uuid=?)'),
  addCode: db.prepare('INSERT INTO mc_link_codes (code, guild_id, uuid, name, expires_at) VALUES (?, ?, ?, ?, ?)'),
  getCode: db.prepare('SELECT * FROM mc_link_codes WHERE code=? AND guild_id=?'),
  dropCode: db.prepare('DELETE FROM mc_link_codes WHERE code=?'),
  getTx: db.prepare('SELECT * FROM mc_transactions WHERE guild_id=? AND tx_id=?'),
  addTx: db.prepare('INSERT INTO mc_transactions (guild_id, tx_id, uuid, amount, balance, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
};

const attempts = new Map(); // kullanıcı -> { count, at }

function cleanUuid(value) {
  const uuid = String(value ?? '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) throw new UserError('Geçersiz oyuncu kimliği.');
  return uuid;
}

function cleanName(value) {
  const name = String(value ?? '');
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) throw new UserError('Geçersiz oyuncu adı.');
  return name;
}

function newCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Sitede gösterilecek bağlantı bilgisi; bağlı değilse null */
export function linkOf(guildId, userId) {
  const row = q.byUser.get(guildId, userId);
  return row ? { name: row.name, linkedAt: Number(row.linked_at) } : null;
}

/** Oyuncu oyunda bağlama komutunu yazınca çağrılır */
export function createLinkCode(guildId, rawUuid, rawName) {
  const uuid = cleanUuid(rawUuid);
  const name = cleanName(rawName);
  if (q.byUuid.get(guildId, uuid)) return { linked: true };
  q.purgeCodes.run(Date.now(), guildId, uuid);
  const code = newCode();
  q.addCode.run(code, guildId, uuid, name, Date.now() + CODE_TTL);
  return { linked: false, code, expiresInSeconds: CODE_TTL / 1000 };
}

/** Kullanıcı oyunda aldığı kodu sitede girince çağrılır. Tahmin denemeleri kullanıcı başına sınırlıdır. */
export function redeemLinkCode(guildId, userId, rawCode) {
  const now = Date.now();
  const tries = attempts.get(userId);
  if (tries && now - tries.at < ATTEMPT_WINDOW && tries.count >= MAX_ATTEMPTS) throw new UserError('Çok fazla hatalı deneme yaptın. 10 dakika sonra tekrar dene.');
  if (q.byUser.get(guildId, userId)) throw new UserError('Hesabın zaten bağlı. Önce mevcut bağlantıyı kaldır.');

  const row = q.getCode.get(String(rawCode ?? '').trim().toUpperCase(), guildId);
  if (!row || Number(row.expires_at) < now) {
    if (attempts.size > 5000) attempts.clear();
    const fresh = !tries || now - tries.at >= ATTEMPT_WINDOW;
    attempts.set(userId, { count: fresh ? 1 : tries.count + 1, at: fresh ? now : tries.at });
    throw new UserError('Kod geçersiz ya da süresi dolmuş.');
  }
  if (q.byUuid.get(guildId, row.uuid)) throw new UserError('Bu Minecraft hesabı başka bir Discord hesabına bağlı.');

  q.link.run(guildId, userId, row.uuid, row.name, now);
  q.dropCode.run(row.code);
  attempts.delete(userId);
  return linkOf(guildId, userId);
}

export function unlink(guildId, userId) {
  if (!Number(q.unlink.run(guildId, userId).changes)) throw new UserError('Bağlı bir Minecraft hesabın yok.');
}

function linkedPlayer(guildId, rawUuid) {
  const row = q.byUuid.get(guildId, cleanUuid(rawUuid));
  if (!row) throw new UserError('Bu Minecraft hesabı bağlı değil.');
  return row;
}

/** Oyuncu bağlı mı, bakiyesi ne */
export function playerView(guildId, rawUuid) {
  const row = q.byUuid.get(guildId, cleanUuid(rawUuid));
  if (!row) return { linked: false };
  return { linked: true, discordId: row.user_id, balance: getBalance(guildId, row.user_id) };
}

/** Oyuncunun adı değişince günceller */
export function touchPlayer(guildId, rawUuid, rawName) {
  q.rename.run(cleanName(rawName), guildId, cleanUuid(rawUuid));
}

/**
 * Oyun içi harcama veya kazanç. amount eksiyse düşer, bakiye yetmezse hata verir.
 * txId her işlem için tekildir: ağ hatasında aynı istek tekrar gelse para iki kez işlenmez.
 */
export function changeBalance(guildId, rawUuid, rawAmount, rawTxId, rawReason) {
  const amount = Number(rawAmount);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > MAX_AMOUNT) throw new UserError('Geçersiz miktar.');
  const txId = String(rawTxId ?? '');
  if (!/^[\w-]{8,64}$/.test(txId)) throw new UserError('Geçersiz işlem numarası.');

  const done = q.getTx.get(guildId, txId);
  if (done) return { balance: Number(done.balance), duplicate: true };

  const { user_id: userId, uuid } = linkedPlayer(guildId, rawUuid);
  const balance = amount > 0 ? addMoney(guildId, userId, amount) : takeMoney(guildId, userId, -amount);
  q.addTx.run(guildId, txId, uuid, amount, balance, String(rawReason ?? '').slice(0, 120), Date.now());
  return { balance, duplicate: false };
}
