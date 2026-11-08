import { SlashCommandBuilder, version as djsVersion } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { brandEmbed } from '../../utils/embeds.js';
import { formatDuration } from '../../utils/time.js';
import { aiModelName } from '../../systems/ai.js';
import config from '../../config.js';

export default {
  aliases: ['botinfo', 'bb'],
  data: new SlashCommandBuilder().setName('bot-bilgi').setDescription('Karia botu hakkında bilgi.'),

  async execute(interaction) {
    const { client } = interaction;
    const mem = process.memoryUsage().rss / 1024 / 1024;
    const embed = brandEmbed()
      .setAuthor({ name: `${client.user.username} • Bot bilgisi`, iconURL: client.user.displayAvatarURL() })
      .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
      .setDescription(`Karia sunucusuna özel yapılmış bot. Komutlar \`/\` ya da \`${config.prefix}\` ön ekiyle çalışır. Tüm liste: \`/yardim\``)
      .addFields(
        { name: `${e('tac', '👑')} Sahibi`, value: `<@${config.owner.id}>`, inline: true },
        { name: `${e('kumsaati', '⏱️')} Açık kalma`, value: formatDuration(client.uptime), inline: true },
        { name: `${e('simsek', '🏓')} Gecikme`, value: `${client.ws.ping} ms`, inline: true },
        { name: `${e('kod', '🧠')} Bellek`, value: `${mem.toFixed(0)} MB`, inline: true },
        { name: `${e('pano', '📜')} Komut`, value: `${client.commands.size}`, inline: true },
        { name: `${e('robot', '🤖')} Yapay zeka`, value: aiModelName, inline: true },
        { name: `${e('araclar', '🧰')} Altyapı`, value: `Node.js ${process.version}\ndiscord.js v${djsVersion}`, inline: true },
      );
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
