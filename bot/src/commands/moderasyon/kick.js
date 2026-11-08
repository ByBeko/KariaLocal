import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { checkTarget, notifyUser, recordCase, caseEmbed, DEFAULT_REASON } from '../../systems/moderation.js';
import { replyError } from '../../utils/embeds.js';

export default {
  aliases: ['at'],
  level: Level.MOD,
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Bir üyeyi sunucudan atar.')
    .addUserOption((o) => o.setName('kullanici').setDescription('Atılacak üye').setRequired(true))
    .addStringOption((o) => o.setName('sebep').setDescription('Sebep').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const member = interaction.options.getMember('kullanici');
    const reason = interaction.options.getString('sebep') ?? DEFAULT_REASON;
    if (!member) return replyError(interaction, 'Bu kişi sunucuda değil.');

    const problem = checkTarget(interaction.member, member, 'kick');
    if (problem) return replyError(interaction, problem);

    await notifyUser(member.user, interaction.guild, { type: 'kick', reason });
    await member.kick(`${interaction.user.tag}: ${reason}`);
    const c = await recordCase(interaction.guild, { userId: member.id, modId: interaction.user.id, type: 'kick', reason });
    await interaction.reply({ embeds: [caseEmbed(c)] });
  },
};
