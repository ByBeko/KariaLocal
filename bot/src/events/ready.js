import { Events, ActivityType } from 'discord.js';
import config from '../config.js';
import { setCommandIds } from '../utils/commandRefs.js';
import { startServerCheck } from '../systems/serverCheck.js';
import { startActivityServer } from '../activity/server.js';
import { startWebApi } from '../web/api.js';
import { startJailTimer } from '../systems/moderation.js';
import { startMinecraftLoop } from '../systems/minecraft.js';
import { cleanupTempChannels } from '../systems/tempvoice.js';
import { markTrackingStart, initVoiceSessions } from '../systems/stats.js';
import { warmUpAI } from '../systems/ai.js';
import { cacheInvites } from '../systems/invites.js';
import { setLevelClient, seedFromStats } from '../systems/levels.js';
import { startTimers } from '../systems/timers.js';
import { loadAppEmojis } from '../utils/emojis.js';
import { setupLogs, LOG_CHANNELS } from '../commands/yonetim/kurulum.js';
import { getSetting } from '../core/settings.js';

const BOT_DESCRIPTION = [
  "Karia'nın özel botuyum.",
  'Tüm komutlar için /yardım',
  '',
  '`Müzik` `Seviye` `Ekonomi` `Koruma` `Yapay zeka`',
].join('\n');

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`✔ ${client.user.tag} olarak giriş yapıldı.`);
    console.log(`✔ ${await loadAppEmojis(client)} Karia emojisi yüklendi.`);
    // Discord, botların özel durumunda sunucu/uygulama emojisine izin vermez; bu yüzden düz yazı
    client.user.setPresence({ activities: [{ type: ActivityType.Custom, name: 'custom', state: 'Karia Local | /yardım' }], status: 'online' });

    const guildId = process.env.GUILD_ID;
    const guild = guildId && (await client.guilds.fetch(guildId).catch(() => null));
    if (guild) {
      // Sunucuya özel komutlar anında güncellenir; aynı komut iki listede olursa / menüsünde çift görünür
      const guildCommands = await guild.commands.set(client.commands.filter((c) => !c.global).map((c) => c.data.toJSON()));
      // Tek tek eklenir: toplu güncelleme, Etkinlik açılınca oluşan giriş komutunu silmeye çalışıp hata verir
      const globalCommands = await Promise.all(client.commands.filter((c) => c.global).map((c) => client.application.commands.create(c.data.toJSON())));
      setCommandIds([...guildCommands.values(), ...globalCommands]);
      console.log(`✔ ${client.commands.size} komut ${guild.name} sunucusuna yüklendi.`);
      await client.application.fetch();
      if (client.application.description !== BOT_DESCRIPTION) {
        await client.application.edit({ description: BOT_DESCRIPTION }).catch((e) => console.error('[Bot açıklaması]', e.message));
      }
      await guild.members.fetch(); // log/takviye karşılaştırmaları için üyeleri önbelleğe al
      await cleanupTempChannels(guild);
      markTrackingStart(guild.id);
      initVoiceSessions(guild);
      await cacheInvites(guild); // kim hangi davetle girdi takibi
      const seeded = seedFromStats(guild.id);
      if (seeded) console.log(`✔ Seviye sistemi: ${seeded} üyeye mevcut aktivitesinden başlangıç XP'si verildi.`);
      // Loglar kuruluysa yeni eklenen log kanallarını da tamamla
      if (LOG_CHANNELS.some(([key]) => getSetting(guild.id, key)) && LOG_CHANNELS.some(([key]) => !guild.channels.cache.has(getSetting(guild.id, key)))) {
        console.log(`✔ ${await setupLogs(guild).catch((e) => `Log kanalları tamamlanamadı: ${e.message}`)}`);
      }
      startServerCheck(guild);
      startActivityServer(client);
      startWebApi(client);
    } else {
      console.warn('⚠ GUILD_ID ayarlı değil ya da bot o sunucuda değil; komutlar yüklenmedi.');
      const guilds = client.guilds.cache.map((g) => `${g.name} (${g.id})`);
      console.warn(`  Botun bulunduğu sunucular: ${guilds.join(', ') || 'hiçbiri — botu davet linkiyle sunucuya ekle'}`);
    }

    setLevelClient(client);
    startJailTimer(client);
    startTimers(client); // süreli roller, çekilişler
    startMinecraftLoop(client);
    warmUpAI(); // beklemeden arka planda
  },
};
