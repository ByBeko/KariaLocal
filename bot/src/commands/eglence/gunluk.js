import { SlashCommandBuilder } from 'discord.js';
import { claimDaily, fmt, ensureEnabled } from '../../systems/economy.js';

export default {
  aliases: ['daily', 'gunlukodul', 'günlük'],
  data: new SlashCommandBuilder().setName('gunluk').setDescription('Günlük 10 coin ödülünü al.'),

  async execute(interaction) {
    ensureEnabled(interaction.guild.id);
    const { amount, balance } = claimDaily(interaction.guild.id, interaction.user.id);
    await interaction.reply({ content: `Günlük ödülün: +${fmt(amount)}\nBakiyen: ${fmt(balance)}`, allowedMentions: { parse: [] } });
  },
};
