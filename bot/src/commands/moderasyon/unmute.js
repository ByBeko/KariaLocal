import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { recordCase, caseEmbed, DEFAULT_REASON } from '../../systems/moderation.js';
import { replyError } from '../../utils/embeds.js';

export default {
  level: Level.STAFF,
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Bir üyenin susturmasını kaldırır.')
    .addUserOption((o) => o.setName('kullanici').setDescription('Üye').setRequired(true))
    .addStringOption((o) => o.setName('sebep').setDescription('Sebep').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const member = interaction.options.getMember('kullanici');
    const reason = interaction.options.getString('sebep') ?? DEFAULT_REASON;
    if (!member) return replyError(interaction, 'Bu kişi sunucuda değil.');
    if (!member.isCommunicationDisabled()) return replyError(interaction, 'Bu kişi susturulmuş değil.');
    if (!member.moderatable) return replyError(interaction, 'Bu kişiye işlem yapmak için yetkim yetmiyor.');

    await member.timeout(null, `${interaction.user.tag}: ${reason}`);
    const c = await recordCase(interaction.guild, { userId: member.id, modId: interaction.user.id, type: 'unmute', reason });
    await interaction.reply({ embeds: [caseEmbed(c)] });
  },
};
