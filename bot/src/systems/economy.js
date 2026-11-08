// Sunucu içi sanal para (gerçek değeri yok). Herkes ilk kullanımda başlangıç coini alır; sonrası günlük ödül, oyunlar ve transferdir.
import { db } from '../core/database.js';
import { e } from '../utils/emojis.js';
import { getSetting } from '../core/settings.js';
import { UserError } from '../utils/errors.js';
import { formatDuration } from '../utils/time.js';

export const currency = () => e('dolar2', '🪙');
export const MIN_BET = 10;
export const MAX_BET = 50_000;
export const STARTING_BALANCE = 200;
export const DAILY_REWARD = 10;
const DAILY_COOLDOWN = 20 * 3_600_000;

const q = {
  get: db.prepare('SELECT * FROM economy WHERE guild_id=? AND user_id=?'),
  ensure: db.prepare('INSERT OR IGNORE INTO economy (guild_id, user_id, wallet) VALUES (?, ?, ?)'),
  add: db.prepare('UPDATE economy SET wallet = wallet + ? WHERE guild_id=? AND user_id=?'),
  // Bakiye yetiyorsa düşer (changes = 0 ise yetmedi): aynı anda iki oyunla eksiye düşülemez
  take: db.prepare('UPDATE economy SET wallet = wallet - ? WHERE guild_id=? AND user_id=? AND wallet >= ?'),
  set: db.prepare('UPDATE economy SET wallet = ? WHERE guild_id=? AND user_id=?'),
  // Süresi dolmadıysa satır değişmez: aynı anda iki istekle iki kez alınamaz
  daily: db.prepare('UPDATE economy SET daily_at=? WHERE guild_id=? AND user_id=? AND daily_at<=?'),
  board: db.prepare('SELECT user_id, wallet FROM economy WHERE guild_id=? AND wallet>0 ORDER BY wallet DESC LIMIT ?'),
};

const ensure = (guildId, userId) => q.ensure.run(guildId, userId, STARTING_BALANCE);

export const getBalance = (guildId, userId) => Number(q.get.get(guildId, userId)?.wallet ?? STARTING_BALANCE);
export const richBoard = (guildId, limit = 15) => q.board.all(guildId, limit).map((r) => ({ userId: r.user_id, value: Number(r.wallet) }));
export const fmt = (n) => `**${Number(n).toLocaleString('tr-TR')}** ${currency()}`;

export function addMoney(guildId, userId, amount) {
  ensure(guildId, userId);
  q.add.run(Math.trunc(amount), guildId, userId);
  return getBalance(guildId, userId);
}

/** Parayı düşer; yetmezse UserError */
export function takeMoney(guildId, userId, amount) {
  ensure(guildId, userId);
  if (!Number(q.take.run(amount, guildId, userId, amount).changes)) {
    throw new UserError(`Bakiyen yetmiyor. Bakiyen: ${fmt(getBalance(guildId, userId))}`);
  }
  return getBalance(guildId, userId);
}

export function setMoney(guildId, userId, amount) {
  ensure(guildId, userId);
  q.set.run(Math.max(0, Math.trunc(amount)), guildId, userId);
}

export function ensureEnabled(guildId) {
  if (!getSetting(guildId, 'economy_enabled')) throw new UserError('Ekonomi ve oyunlar bu sunucuda kapalı.');
}

/** Günlük ödülün bir sonraki alınabileceği zaman (ms); 0 ise hemen alınabilir */
export function nextDaily(guildId, userId) {
  const at = Number(q.get.get(guildId, userId)?.daily_at ?? 0) + DAILY_COOLDOWN;
  return at > Date.now() ? at : 0;
}

export function claimDaily(guildId, userId) {
  ensure(guildId, userId);
  const now = Date.now();
  if (!Number(q.daily.run(now, guildId, userId, now - DAILY_COOLDOWN).changes)) {
    throw new UserError(`Günlük ödülünü zaten aldın. **${formatDuration(nextDaily(guildId, userId) - now)}** sonra tekrar gel.`);
  }
  return { amount: DAILY_REWARD, balance: addMoney(guildId, userId, DAILY_REWARD) };
}

/** "500", "1.000", "1k", "hepsi", "yarısı" → sayı. Bahis sınırlarını kontrol eder. */
export function parseBet(input, guildId, userId) {
  const balance = getBalance(guildId, userId);
  const text = String(input ?? '').toLocaleLowerCase('tr').replace(/[.,\s]/g, '');
  let amount;
  if (['hepsi', 'tümü', 'tumu', 'all', 'max'].includes(text)) amount = Math.min(balance, MAX_BET);
  else if (['yarısı', 'yarisi', 'yarım', 'half'].includes(text)) amount = Math.floor(balance / 2);
  else {
    const m = text.match(/^(\d+)(k|b)?$/);
    if (!m) throw new UserError('Geçerli bir miktar yaz. Örnek: `100`, `1k`, `hepsi`, `yarısı`');
    amount = Number(m[1]) * (m[2] ? 1000 : 1);
  }
  if (amount < MIN_BET) throw new UserError(`En az ${fmt(MIN_BET)} yatırabilirsin. Bakiyen: ${fmt(balance)}`);
  if (amount > MAX_BET) throw new UserError(`En fazla ${fmt(MAX_BET)} yatırabilirsin.`);
  if (amount > balance) throw new UserError(`Bakiyen yetmiyor. Bakiyen: ${fmt(balance)}`);
  return amount;
}

/** Kullanıcı başına tek oyun (blackjack sürerken başka bahis açılmasın) */
const playing = new Set();
export function lockGame(guildId, userId) {
  const key = `${guildId}:${userId}`;
  if (playing.has(key)) throw new UserError('Zaten devam eden bir oyunun var, önce onu bitir.');
  playing.add(key);
  return () => playing.delete(key);
}
