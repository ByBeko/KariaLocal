import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { listView } from '../../systems/lists.js';

export default {
  data: new SlashCommandBuilder()
    .setName('roller')
    .setDescription('Sunucunun rollerini ve kaç kişide olduğunu gösterir.')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.reply(listView('rol', interaction.guild, interaction.user.id, 0));
  },
};
