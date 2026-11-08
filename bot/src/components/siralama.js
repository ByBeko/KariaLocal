import { MessageFlags } from 'discord.js';
import { rankingView } from '../systems/rankings.js';

export default {
  prefix: 'siralama',
  async execute(interaction, [ownerId, type, days]) {
    // Başkasının sıralamasına dokunan kendi görünümünü gizli olarak alır
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ ...rankingView(interaction.guild, interaction.user.id, type, Number(days)), flags: MessageFlags.Ephemeral });
    }
    await interaction.update(rankingView(interaction.guild, ownerId, type, Number(days)));
  },
};
