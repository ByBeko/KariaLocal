import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { replySuccess } from '../../utils/embeds.js';

export default {
  aliases: ['sil', 'clear'],
  level: Level.STAFF,
  data: new SlashCommandBuilder()
    .setName('temizle')
    .setDescription('Kanaldaki son mesajları siler (14 günden eski mesajlar silinemez).')
    .addIntegerOption((o) => o.setName('sayi').setDescription('Kaç mesaj (1-100)').setMinValue(1).setMaxValue(100).setRequired(true))
    .addUserOption((o) => o.setName('kullanici').setDescription('Sadece bu kişinin mesajları'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const amount = interaction.options.getInteger('sayi', true);
    const user = interaction.options.getUser('kullanici');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let toDelete;
    if (user) {
      const recent = await interaction.channel.messages.fetch({ limit: 100 });
      toDelete = [...recent.filter((m) => m.author.id === user.id).values()].slice(0, amount);
    } else {
      toDelete = amount;
    }

    const deleted = await interaction.channel.bulkDelete(toDelete, true);
    await replySuccess(interaction, `${deleted.size} mesaj silindi.${user ? ` (${user})` : ''}`);
  },
};
