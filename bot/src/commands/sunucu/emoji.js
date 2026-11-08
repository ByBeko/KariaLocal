import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { listView } from '../../systems/lists.js';

export default {
  aliases: ['emojiler'],
  data: new SlashCommandBuilder()
    .setName('emoji')
    .setDescription('Sunucunun tüm emojilerini gösterir.')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.reply(listView('emoji', interaction.guild, interaction.user.id, 0));
  },
};
