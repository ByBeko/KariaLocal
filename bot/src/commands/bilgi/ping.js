import { SlashCommandBuilder } from 'discord.js';
import { brandEmbed } from '../../utils/embeds.js';
import { e } from '../../utils/emojis.js';

export default {
  data: new SlashCommandBuilder().setName('ping').setDescription('Botun gecikmesini gösterir.'),

  async execute(interaction) {
    const uptime = Math.floor((Date.now() - interaction.client.uptime) / 1000);
    await interaction.reply({
      embeds: [
        brandEmbed().setDescription(`${e('simsek', '🏓')} **Gecikme:** ${interaction.client.ws.ping} ms\n${e('kumsaati', '⏱️')} **Açılış:** <t:${uptime}:R>`),
      ],
    });
  },
};
