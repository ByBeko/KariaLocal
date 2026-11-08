// Süreli roller ve çekilişler için 15 saniyelik zamanlayıcı
import { e } from '../utils/emojis.js';
import { db } from '../core/database.js';
import { sendLog } from '../utils/logger.js';
import { endGiveaway } from './giveaway.js';
import { tickWeeklyUpdate } from './updates.js';
import { endDuePolls } from './polls.js';

const q = {
  dueRoles: db.prepare('SELECT * FROM temp_roles WHERE until <= ?'),
  delRole: db.prepare('DELETE FROM temp_roles WHERE guild_id=? AND user_id=? AND role_id=?'),
  addRole: db.prepare(`INSERT INTO temp_roles (guild_id, user_id, role_id, until, mod_id) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET until=excluded.until, mod_id=excluded.mod_id`),
  dueGiveaways: db.prepare('SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= ?'),
};

export const scheduleRoleRemoval = (guildId, userId, roleId, until, modId) => q.addRole.run(guildId, userId, roleId, until, modId);
export const cancelRoleRemoval = (guildId, userId, roleId) => q.delRole.run(guildId, userId, roleId);

async function tick(client) {
  const now = Date.now();
  for (const row of q.dueRoles.all(now)) {
    q.delRole.run(row.guild_id, row.user_id, row.role_id);
    const guild = client.guilds.cache.get(row.guild_id);
    const member = await guild?.members.fetch(row.user_id).catch(() => null);
    if (!member?.roles.cache.has(row.role_id)) continue;
    const ok = await member.roles.remove(row.role_id, 'Süreli rolün süresi doldu').then(() => true).catch(() => false);
    await sendLog(guild, 'log_role', {
      content: `${e('zil', '⏰')} ${member} üyesinin süreli rolü <@&${row.role_id}> ${ok ? 'süresi dolduğu için alındı' : 'alınamadı (yetkim yetmiyor)'}. (veren: <@${row.mod_id}>)`,
    });
  }
  for (const row of q.dueGiveaways.all(now)) {
    await endGiveaway(client, row.message_id).catch((e) => console.error('[Çekiliş bitir]', e.message));
  }
  await endDuePolls(client, now);
  await tickWeeklyUpdate(client);
}

export function startTimers(client) {
  setInterval(() => tick(client).catch((e) => console.error('[Zamanlayıcı]', e.message)), 15_000);
  tick(client).catch(() => {});
}
