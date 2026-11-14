import { SlashCommandBuilder } from 'discord.js';
import { kariaEmbed, label, bar, pingQuality } from '../../utils/embeds.js';
import { Level } from '../../utils/permissions.js';

export default {
  level: Level.STAFF, // yetkili panelinde görünür
  data: new SlashCommandBuilder().setName('ping').setDescription('Botun gecikmesini gösterir.'),

  async execute(interaction) {
    const { client } = interaction;
    const ws = Math.round(client.ws.ping);
    const reply = Math.max(0, Date.now() - (interaction.createdTimestamp ?? Date.now()));
    const started = Math.floor((Date.now() - client.uptime) / 1000);
    await interaction.reply({
      embeds: [
        kariaEmbed(client, 'Gecikme')
          .setTitle(`${pingQuality(ws)} bağlantı`)
          .addFields(
            { name: label('simsek', '📶', 'WebSocket'), value: `**${ws} ms**\n${bar(1 - Math.min(ws, 500) / 500)}`, inline: true },
            { name: label('mesaj', '💬', 'Yanıt'), value: `**${reply} ms**\n${bar(1 - Math.min(reply, 1000) / 1000)}`, inline: true },
            { name: label('kumsaati', '⏱️', 'Açılış'), value: `<t:${started}:R>`, inline: true },
          ),
      ],
    });
  },
};
