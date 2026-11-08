import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { setAfk } from '../../systems/afk.js';
import { replySuccess } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('AFK olur. Biri seni etiketlerse sebebini söylerim, yazınca AFK biter.')
    .addStringOption((o) => o.setName('sebep').setDescription('Neden AFK’sın?').setMaxLength(100))
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const reason = interaction.options.getString('sebep') ?? 'Sebep belirtilmedi';
    setAfk(interaction.guild.id, interaction.user.id, reason);
    await replySuccess(interaction, `AFK oldun: ${reason}`, false);
  },
};
