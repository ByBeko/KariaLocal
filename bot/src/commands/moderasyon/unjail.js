import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { unjailMember, caseEmbed, DEFAULT_REASON } from '../../systems/moderation.js';

export default {
  level: Level.MOD,
  data: new SlashCommandBuilder()
    .setName('unjail')
    .setDescription("Bir üyeyi jail'den çıkarır ve eski rollerini geri verir.")
    .addUserOption((o) => o.setName('kullanici').setDescription('Üye').setRequired(true))
    .addStringOption((o) => o.setName('sebep').setDescription('Sebep').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const user = interaction.options.getUser('kullanici', true);
    const reason = interaction.options.getString('sebep') ?? DEFAULT_REASON;
    await interaction.deferReply();
    const c = await unjailMember(interaction.guild, user.id, { modId: interaction.user.id, reason });
    await interaction.editReply({ embeds: [caseEmbed(c)] });
  },
};
