import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { checkTarget, notifyUser, jailMember, caseEmbed, DEFAULT_REASON } from '../../systems/moderation.js';
import { replyError } from '../../utils/embeds.js';
import { parseDuration } from '../../utils/time.js';

export default {
  level: Level.MOD,
  data: new SlashCommandBuilder()
    .setName('jail')
    .setDescription("Bir üyenin rollerini alıp jail'e atar. Süre verilmezse kalıcıdır.")
    .addUserOption((o) => o.setName('kullanici').setDescription('Üye').setRequired(true))
    .addStringOption((o) => o.setName('sure').setDescription('Örn: 1sa, 3g, 1hf (boş = süresiz)'))
    .addStringOption((o) => o.setName('sebep').setDescription('Sebep').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const member = interaction.options.getMember('kullanici');
    const durationText = interaction.options.getString('sure');
    const reason = interaction.options.getString('sebep') ?? DEFAULT_REASON;
    if (!member) return replyError(interaction, 'Bu kişi sunucuda değil.');

    const duration = durationText ? parseDuration(durationText) : null;
    if (durationText && !duration) return replyError(interaction, 'Geçersiz süre. Örnek: `1sa`, `3g`, `1hf`');

    const problem = checkTarget(interaction.member, member, 'jail');
    if (problem) return replyError(interaction, problem);

    await interaction.deferReply();
    const c = await jailMember(member, { modId: interaction.user.id, reason, duration });
    await notifyUser(member.user, interaction.guild, { type: 'jail', reason, duration });
    await interaction.editReply({ embeds: [caseEmbed(c)] });
  },
};
