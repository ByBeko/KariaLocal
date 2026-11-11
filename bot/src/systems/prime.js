// Prime üyeliği: süreli rol. Süre dolunca timers.js rolü otomatik alır; ilk Prime coini rol verilince coinRewards'tan gelir.
import { db } from '../core/database.js';
import { sendLog } from '../utils/logger.js';
import { UserError } from '../utils/errors.js';
import { e } from '../utils/emojis.js';
import { roleCoinAmount } from './coinRewards.js';

export const PRIME_ROLE = '1569468546713526443';
export const PRIME_DAYS = [7, 30, 90];
const DAY = 86_400_000;

const q = {
  get: db.prepare('SELECT until FROM temp_roles WHERE guild_id=? AND user_id=? AND role_id=?'),
  set: db.prepare(`INSERT INTO temp_roles (guild_id, user_id, role_id, until, mod_id) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET until = excluded.until, mod_id = excluded.mod_id`),
  del: db.prepare('DELETE FROM temp_roles WHERE guild_id=? AND user_id=? AND role_id=?'),
};

/** Prime verir; zaten süresi varsa üstüne ekler. Bitiş zamanını döner. */
export async function grantPrime(guild, member, days, modId) {
  const current = Number(q.get.get(guild.id, member.id, PRIME_ROLE)?.until ?? 0);
  const until = Math.max(current, Date.now()) + days * DAY;
  q.set.run(guild.id, member.id, PRIME_ROLE, until, modId);
  if (!member.roles.cache.has(PRIME_ROLE)) await member.roles.add(PRIME_ROLE, 'Prime üyelik');
  return until;
}

export function primeView(guild) {
  const humans = [...guild.members.cache.values()].filter((m) => !m.user.bot).sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr'));
  return {
    days: PRIME_DAYS,
    coin: roleCoinAmount(PRIME_ROLE),
    members: humans.map((m) => ({ id: m.id, name: m.displayName })),
    prime: humans.filter((m) => m.roles.cache.has(PRIME_ROLE))
      .map((m) => ({ id: m.id, name: m.displayName, until: Number(q.get.get(guild.id, m.id, PRIME_ROLE)?.until ?? 0) || null }))
      .sort((a, b) => (a.until ?? Infinity) - (b.until ?? Infinity)),
  };
}

const fetchMember = async (guild, userId) => {
  const member = /^\d{17,20}$/.test(String(userId ?? '')) ? await guild.members.fetch(String(userId)).catch(() => null) : null;
  if (!member || member.user.bot) throw new UserError('Üye bulunamadı.');
  return member;
};

/** Yönetim paneli: Prime ekler ya da süresini uzatır, üyeye haber verir. */
export async function addPrimeFromPanel(guild, admin, userId, rawDays) {
  const days = Number(rawDays);
  if (!PRIME_DAYS.includes(days)) throw new UserError('Geçersiz süre.');
  const member = await fetchMember(guild, userId);
  const until = await grantPrime(guild, member, days, admin.id);
  const stamp = `<t:${Math.floor(until / 1000)}:F>`;
  await sendLog(guild, 'log_staff', { content: `Yönetim Paneli • <@${admin.id}> <@${member.id}> üyesine **${days} gün Prime** verdi. Bitiş: ${stamp}` });
  await member.send(`${e('tac', '👑')} **Karia Prime** üyeliğin aktif! Bitiş tarihi: ${stamp}`).catch(() => {});
  return primeView(guild);
}

export async function removePrimeFromPanel(guild, admin, userId) {
  const member = await fetchMember(guild, userId);
  q.del.run(guild.id, member.id, PRIME_ROLE);
  if (member.roles.cache.has(PRIME_ROLE)) await member.roles.remove(PRIME_ROLE, `Yönetim Paneli: ${admin.displayName}`);
  await sendLog(guild, 'log_staff', { content: `Yönetim Paneli • <@${admin.id}> <@${member.id}> üyesinin Prime üyeliğini kaldırdı.` });
  return primeView(guild);
}
