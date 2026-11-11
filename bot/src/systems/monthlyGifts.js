// Top.gg oy sayımı ve aylık hediyeler: ayın en çok oy verenleri ile takviye çekilişi.
import { db } from '../core/database.js';
import { getSetting, setSetting } from '../core/settings.js';
import { grantOnce, skipRoleCoinOnce } from './coinRewards.js';
import { findGuideChannel } from './guide.js';
import { grantPrime, PRIME_ROLE } from './prime.js';
import { sendLog } from '../utils/logger.js';
import { e } from '../utils/emojis.js';

const GIFT_DAYS = 30;
const VOTE_GAP = 11 * 3_600_000; // Top.gg aynı oyu yeniden iletirse iki kez sayılmaz
const BOOST_PRIZE = 1_000;

const q = {
  get: db.prepare('SELECT last_at FROM votes WHERE guild_id=? AND user_id=? AND month=?'),
  add: db.prepare(`INSERT INTO votes (guild_id, user_id, month, count, last_at) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(guild_id, user_id, month) DO UPDATE SET count = count + 1, last_at = excluded.last_at`),
  top: db.prepare('SELECT user_id, count FROM votes WHERE guild_id=? AND month=? ORDER BY count DESC, last_at ASC LIMIT 25'),
  tempGet: db.prepare('SELECT until FROM temp_roles WHERE guild_id=? AND user_id=? AND role_id=?'),
  tempSet: db.prepare(`INSERT INTO temp_roles (guild_id, user_id, role_id, until, mod_id) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET until = excluded.until, mod_id = excluded.mod_id`),
};

/** Türkiye saatine göre ay: 2026-11 */
export const monthKey = (at = Date.now()) => new Date(at + 3 * 3_600_000).toISOString().slice(0, 7);

/** Top.gg bildirimini sayar; kısa sürede gelen tekrarı atlar. */
export function recordVote(guildId, userId, now = Date.now()) {
  const month = monthKey(now);
  if (now - Number(q.get.get(guildId, userId, month)?.last_at ?? 0) < VOTE_GAP) return false;
  q.add.run(guildId, userId, month, now);
  return true;
}

const givePrime = (guild, member) => grantPrime(guild, member, GIFT_DAYS, guild.client.user.id);

async function announce(guild, key, content, userIds) {
  const channel = findGuideChannel(guild, key);
  if (channel?.isTextBased()) await channel.send({ content, allowedMentions: { users: userIds } }).catch(() => {});
  await sendLog(guild, 'log_level', { content, allowedMentions: { parse: [] } });
}

async function voteGifts(guild, month) {
  const done = `gift_vote_done_${month}`;
  if (getSetting(guild.id, done)) return;
  let winner = null;
  let votes = 0;
  for (const row of q.top.all(guild.id, month)) {
    const member = await guild.members.fetch(row.user_id).catch(() => null);
    if (member && !member.user.bot) { winner = member; votes = Number(row.count); break; }
  }
  if (winner) {
    skipRoleCoinOnce(guild.id, winner.id, PRIME_ROLE); // Oy ödülü yalnızca Prime'dır, rol coini verilmez
    await givePrime(guild, winner);
  }
  setSetting(guild.id, done, '1');
  if (winner) await announce(guild, 'oy-ver', `${e('kupa', '🏆')} **${month} ayının en çok oy vereni:** ${winner} • ${votes} oy • ${GIFT_DAYS} gün Prime kazandı!`, [winner.id]);
}

async function boostGift(guild, month) {
  const done = `gift_boost_done_${month}`;
  if (getSetting(guild.id, done)) return;
  const pickKey = `gift_boost_pick_${month}`;
  await guild.members.fetch().catch(() => null);
  const boosters = [...(guild.roles.premiumSubscriberRole?.members.values() ?? [])].filter((m) => !m.user.bot);
  // Kazanan önce kaydedilir: hata sonrası yeniden denemede başkası seçilmez
  if (!getSetting(guild.id, pickKey) && boosters.length) setSetting(guild.id, pickKey, boosters[Math.floor(Math.random() * boosters.length)].id);
  const winner = boosters.find((m) => m.id === getSetting(guild.id, pickKey));
  if (winner) {
    grantOnce(guild.id, winner.id, `gift:boost:${month}`, BOOST_PRIZE);
    await givePrime(guild, winner);
    await announce(guild, 'takviyeler', `${e('hediye', '🎁')} **${month} takviye çekilişi:** ${winner} ${GIFT_DAYS} gün Prime ve **${BOOST_PRIZE.toLocaleString('tr-TR')}** coin kazandı!`, [winner.id]);
  }
  setSetting(guild.id, done, '1');
}

let busy = false;
let retryAt = 0;

/** Ay değişince biten ayın hediyelerini dağıtır. timers.js her 15 sn çağırır. */
export async function tickMonthlyGifts(client) {
  const now = Date.now();
  if (busy || now < retryAt) return;
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;
  const current = monthKey(now);
  const last = getSetting(guild.id, 'gifts_month');
  if (last === current) return;
  if (!last) return setSetting(guild.id, 'gifts_month', current);

  busy = true;
  try {
    if (getSetting(guild.id, 'economy_enabled')) {
      await voteGifts(guild, last);
      await boostGift(guild, last);
    }
    setSetting(guild.id, 'gifts_month', current);
  } catch (error) {
    retryAt = now + 3_600_000;
    console.error('[Aylık hediye]', error.message);
  } finally {
    busy = false;
  }
}
