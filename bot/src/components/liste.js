import { MessageFlags } from 'discord.js';
import { listView } from '../systems/lists.js';

export default {
  prefix: 'liste',
  async execute(interaction, [kind, ownerId, page]) {
    // Başkasının listesine dokunan kendi listesini gizli olarak alır
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ ...listView(kind, interaction.guild, interaction.user.id, Number(page)), flags: MessageFlags.Ephemeral });
    }
    await interaction.update(listView(kind, interaction.guild, ownerId, Number(page)));
  },
};
