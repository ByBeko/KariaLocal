import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { replySuccess } from '../../utils/embeds.js';

export default {
  level: Level.STAFF,
  data: new SlashCommandBuilder()
    .setName('yavasmod')
    .setDescription('Kanala yavaş mod koyar.')
    .addIntegerOption((o) =>
      o.setName('saniye').setDescription('Mesajlar arası bekleme (0 = kapalı, en fazla 21600)').setMinValue(0).setMaxValue(21600).setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const seconds = interaction.options.getInteger('saniye', true);
    await interaction.channel.setRateLimitPerUser(seconds, `${interaction.user.tag} tarafından`);
    await replySuccess(interaction, seconds ? `Yavaş mod **${seconds} saniye** olarak ayarlandı.` : 'Yavaş mod kapatıldı.', false);
  },
};
