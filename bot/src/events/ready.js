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
import { loadAppEmojis, e } from '../utils/emojis.js';
import { setEmbedClient } from '../utils/embeds.js';
import { setupLogs, LOG_CHANNELS } from '../commands/yonetim/kurulum.js';
import { getSetting } from '../core/settings.js';
import { isAllowedGuild } from '../core/allowedGuilds.js';
import { guildCommandData, setupGuestGuild } from '../core/guildSetup.js';

// Bot profilindeki "Hakkında" yazısı ve etiketler. Emojiler Karia'nın turkuaz uygulama emojileridir,
// bu yüzden açılışta emojiler yüklendikten sonra kurulur. Discord sınırı 400 karakter.
const DESCRIPTION_LIMIT = 400;
const describe = (icon) => [
  `${icon('icon_turkuaz', '💠')} Karia'nın resmi botuyum`,
  `${icon('baglanti', '🌐')} https://karia.live/`,
  `${icon('asagi', '⬇️')} Komutlar aşağıda`,
].join('\n');
// Özel emojilerle sınırı aşarsa normal emojilerle yazılır
const botDescription = () => {
  const custom = describe(e);
  return custom.length <= DESCRIPTION_LIMIT ? custom : describe((_, fallback) => fallback);
};
// Öne çıkan özellikler profilde etiket olarak görünür (en çok 5, her biri en çok 20 karakter)
const BOT_TAGS = ['Müzik', 'Seviye & Ekonomi', 'Oyunlar', 'Moderasyon & Koruma', 'Yapay Zeka'];

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`✔ ${client.user.tag} olarak giriş yapıldı.`);
    console.log(`✔ ${await loadAppEmojis(client)} Karia emojisi yüklendi.`);
    setEmbedClient(client);
    // Discord botlarda yalnızca ad ve alt satıra izin verir; resim ve buton gösterilemez
    client.user.setPresence({ activities: [{ type: ActivityType.Playing, name: '/yardım | karia.live' }], status: 'online' });

    const guildId = process.env.GUILD_ID;
    const guild = guildId && (await client.guilds.fetch(guildId).catch(() => null));
    if (guild) {
      // Bot kapalıyken izinsiz bir sunucuya eklendiyse oradan çık; izinli sunucular kurulur
      for (const other of client.guilds.cache.values()) {
        if (other.id === guildId) continue;
        if (!isAllowedGuild(other.id)) await other.leave().catch((e) => console.error('[Sunucudan çıkış]', e.message));
        else await setupGuestGuild(client, other).catch((e) => console.error(`[Sunucu kurulumu ${other.name}]`, e.message));
      }
      // Sunucuya özel komutlar anında güncellenir; aynı komut iki listede olursa / menüsünde çift görünür
      const guildCommands = await guild.commands.set(guildCommandData(client, guild.id));
      // Tek tek eklenir: toplu güncelleme, Etkinlik açılınca oluşan giriş komutunu silmeye çalışıp hata verir
      const globalCommands = await Promise.all(client.commands.filter((c) => c.global).map((c) => client.application.commands.create(c.data.toJSON())));
      setCommandIds([...guildCommands.values(), ...globalCommands]);
      console.log(`✔ ${client.commands.size} komut ${guild.name} sunucusuna yüklendi.`);
      await client.application.fetch();
      const description = botDescription();
      const sorted = (tags) => [...tags].sort().join('|'); // Discord etiketleri farklı sırayla döndürebilir
      const tagsChanged = sorted(client.application.tags ?? []) !== sorted(BOT_TAGS);
      if (client.application.description !== description || tagsChanged) {
        await client.application.edit({ description, tags: BOT_TAGS }).catch((e) => console.error('[Bot açıklaması]', e.message));
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
