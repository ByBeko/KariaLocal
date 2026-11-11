import { Events } from 'discord.js';

// Karia Local yalnızca Karia sunucusunda çalışır: başka bir sunucuya eklenirse hemen çıkar.
export default {
  name: Events.GuildCreate,
  async execute(guild) {
    const home = process.env.GUILD_ID;
    if (!home || guild.id === home) return;
    console.warn(`⚠ İzinsiz sunucuya eklendi, çıkılıyor: ${guild.name} (${guild.id})`);
    await guild.leave().catch((e) => console.error('[Sunucudan çıkış]', e.message));
  },
};
