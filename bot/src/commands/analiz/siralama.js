import { SlashCommandBuilder } from 'discord.js';
import { PERIOD_CHOICES } from '../../systems/stats.js';
import { rankingView } from '../../systems/rankings.js';

export default {
  aliases: ['top', 'lb', 'sunucutop'],
  data: new SlashCommandBuilder()
    .setName('siralama')
    .setDescription('Seviye, coin, mesaj, ses ve davet sıralamaları.')
    .addStringOption((o) =>
      o
        .setName('tur')
        .setDescription('Neye göre? (varsayılan: seviye)')
        .addChoices(
          { name: 'Seviye', value: 'seviye' },
          { name: 'Coin', value: 'para' },
          { name: 'Mesaj', value: 'mesaj' },
          { name: 'Ses', value: 'ses' },
          { name: 'Davet', value: 'davet' },
        ),
    )
    .addIntegerOption((o) => o.setName('sure').setDescription('Zaman aralığı, mesaj/ses için (varsayılan: son 7 gün)').addChoices(...PERIOD_CHOICES)),

  async execute(interaction) {
    const type = interaction.options.getString('tur') ?? 'seviye';
    const days = interaction.options.getInteger('sure') ?? 7;
    await interaction.reply(rankingView(interaction.guild, interaction.user.id, type, days));
  },
};
