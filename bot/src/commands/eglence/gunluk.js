import { SlashCommandBuilder } from 'discord.js';
import { claimDaily, nextDaily, fmt, ensureEnabled } from '../../systems/economy.js';
import { kariaEmbed, label } from '../../utils/embeds.js';

export default {
  aliases: ['daily', 'gunlukodul', 'günlük'],
  data: new SlashCommandBuilder().setName('gunluk').setDescription('Günlük 100 coin ödülünü al.'),

  async execute(interaction) {
    ensureEnabled(interaction.guild.id);
    const { amount, balance } = claimDaily(interaction.guild.id, interaction.user.id);
    const embed = kariaEmbed(interaction.client, 'Günlük Ödül', { icon: interaction.user.displayAvatarURL() })
      .setTitle('Ödülün hesabına eklendi')
      .addFields(
        { name: label('hediye', '🎁', 'Ödül'), value: `+${fmt(amount)}`, inline: true },
        { name: label('coin', '🪙', 'Bakiye'), value: fmt(balance), inline: true },
        { name: label('kumsaati', '⏱️', 'Sonraki'), value: `<t:${Math.floor(nextDaily(interaction.guild.id, interaction.user.id) / 1000)}:R>`, inline: true },
      );
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
