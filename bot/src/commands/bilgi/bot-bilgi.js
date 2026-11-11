import os from 'node:os';
import path from 'node:path';
import { SlashCommandBuilder, AttachmentBuilder, ChannelType, version as djsVersion } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { kariaEmbed, bar, label, linkRow, pingQuality } from '../../utils/embeds.js';
import { aiModelName } from '../../systems/ai.js';
import config from '../../config.js';

const COVER = path.join(import.meta.dirname, '../../activity/public/cover.png');
const gb = (bytes) => (bytes / 1024 ** 3).toFixed(1);

/** Botun kısa süredeki işlemci kullanımı (tüm çekirdeklere oranla) */
async function cpuPercent() {
  const start = process.cpuUsage();
  const t = performance.now();
  await new Promise((r) => setTimeout(r, 200));
  const used = process.cpuUsage(start);
  return ((used.user + used.system) / 1000 / (performance.now() - t) / os.cpus().length) * 100;
}

export default {
  aliases: ['botinfo', 'bb', 'botbilgi'],
  data: new SlashCommandBuilder().setName('bot-bilgi').setDescription('Karia Local botu hakkında bilgi.'),

  async execute(interaction) {
    const { client, guild } = interaction;
    const sentAt = interaction.createdTimestamp ?? Date.now();
    const cpu = await cpuPercent();
    const reply = Math.max(0, Date.now() - sentAt - 200);
    const ws = Math.round(client.ws.ping);

    const rss = process.memoryUsage().rss;
    const total = os.totalmem();
    const used = total - os.freemem();
    const commands = [...client.commands.values()];
    const aliases = commands.reduce((sum, c) => sum + (c.aliases?.length ?? 0), 0);
    const humans = guild.members.cache.filter((m) => !m.user.bot).size;
    const textChannels = guild.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory).size;
    const load = os.loadavg()[0];

    const embed = kariaEmbed(client, 'Bot Bilgileri')
      .setTitle(client.user.username)
      .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
      .setDescription([
        'Müzik, seviye, ekonomi, koruma ve yapay zekâ tek botta.',
        `${e('nokta_yesil', '🟢')} **Çevrimiçi** · ${e('kumsaati', '⏱️')} <t:${Math.floor((Date.now() - client.uptime) / 1000)}:R> açıldı`,
        `${e('kod', '💻')} **Geliştirici** <@${config.owner.id}>`,
      ].join('\n'))
      .addFields(
        { name: label('arkadaslar', '👥', 'Erişim'), value: `**${humans}** üye\n**${textChannels}** kanal\n**${guild.roles.cache.size - 1}** rol`, inline: true },
        { name: label('pano', '📜', 'Komutlar'), value: `**${commands.length}** slash\n**${aliases}** \`${config.prefix}\` kısayolu\n**${config.prefixes.length}** ön ek`, inline: true },
        { name: label('simsek', '📶', 'Gecikme'), value: `WS **${ws} ms**\nYanıt **${reply} ms**\n${pingQuality(ws)}`, inline: true },
        { name: label('istatistik', '💾', 'Bellek'), value: `Bot **${Math.round(rss / 1024 ** 2)} MB**\n${bar(used / total)}\n${gb(used)}/${gb(total)} GB`, inline: true },
        { name: label('ayarlar', '⚙️', 'İşlemci'), value: `Bot **%${cpu.toFixed(1)}**\n${bar(cpu / 100)}\n${load ? `Yük ${load.toFixed(2)} · ` : ''}${os.cpus().length} çekirdek`, inline: true },
        { name: label('araclar', '🧰', 'Altyapı'), value: `discord.js **${djsVersion}**\nNode **${process.versions.node}**\n${aiModelName}`, inline: true },
      )
      .setImage('attachment://karia.png');

    await interaction.reply({
      embeds: [embed],
      files: [new AttachmentBuilder(COVER, { name: 'karia.png' })],
      components: [linkRow()],
      allowedMentions: { parse: [] },
    });
  },
};
