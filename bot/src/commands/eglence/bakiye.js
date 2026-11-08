import { SlashCommandBuilder } from 'discord.js';
import { getBalance, fmt, ensureEnabled } from '../../systems/economy.js';

export default {
  aliases: ['para', 'cuzdan', 'bal', 'cüzdan'],
  data: new SlashCommandBuilder()
    .setName('bakiye')
    .setDescription('Karia coin bakiyeni gösterir.')
    .addUserOption((o) => o.setName('kullanici').setDescription('Başkasının bakiyesi')),

  async execute(interaction) {
    ensureEnabled(interaction.guild.id);
    const user = interaction.options.getUser('kullanici') ?? interaction.user;
    const balance = fmt(getBalance(interaction.guild.id, user.id));
    await interaction.reply({ content: user.id === interaction.user.id ? `Bakiyen: ${balance}` : `${user} bakiyesi: ${balance}`, allowedMentions: { parse: [] } });
  },
};
