// Karia dışındaki izinli sunucuların kurulumu: sunucuya özel komutlar yüklenir, istatistik ve davet takibi başlar.
// homeOnly işaretli komutlar (sahip araçları gibi) yalnızca Karia'da görünür.
import { markTrackingStart, initVoiceSessions } from '../systems/stats.js';
import { cacheInvites } from '../systems/invites.js';
import { homeGuildId } from './allowedGuilds.js';

export const guildCommandData = (client, guildId) =>
  client.commands.filter((c) => !c.global && (!c.homeOnly || guildId === homeGuildId())).map((c) => c.data.toJSON());

export async function setupGuestGuild(client, guild) {
  await guild.commands.set(guildCommandData(client, guild.id));
  await guild.members.fetch().catch(() => {});
  markTrackingStart(guild.id);
  initVoiceSessions(guild);
  await cacheInvites(guild).catch(() => {});
  console.log(`✔ ${guild.name} sunucusu hazır (${guild.id})`);
}
