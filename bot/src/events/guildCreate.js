import { Events } from 'discord.js';
import { isAllowedGuild } from '../core/allowedGuilds.js';
import { setupGuestGuild } from '../core/guildSetup.js';

// Karia Local yalnızca Karia'da ve sahibin /sunucu-izin ile izin verdiği sunucularda çalışır; başka yere eklenirse çıkar.
export default {
  name: Events.GuildCreate,
  async execute(guild) {
    if (guild.id === process.env.GUILD_ID) return;
    if (!isAllowedGuild(guild.id)) {
      console.warn(`⚠ İzinsiz sunucuya eklendi, çıkılıyor: ${guild.name} (${guild.id})`);
      await guild.leave().catch((e) => console.error('[Sunucudan çıkış]', e.message));
      return;
    }
    await setupGuestGuild(guild.client, guild).catch((e) => console.error(`[Sunucu kurulumu ${guild.name}]`, e.message));
  },
};
