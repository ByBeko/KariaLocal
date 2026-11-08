import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { checkTarget, notifyUser, recordCase, caseEmbed, DEFAULT_REASON } from '../../systems/moderation.js';
import { replyError } from '../../utils/embeds.js';

export default {
  aliases: ['yasakla'],
  level: Level.MOD,
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bir kullanıcıyı sunucudan yasaklar.')
    .addUserOption((o) => o.setName('kullanici').setDescription('Yasaklanacak kişi').setRequired(true))
    .addStringOption((o) => o.setName('sebep').setDescription('Yasaklama sebebi').setMaxLength(500))
    .addIntegerOption((o) =>
      o.setName('mesaj_sil').setDescription('Son kaç günün mesajları silinsin? (0-7)').setMinValue(0).setMaxValue(7),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const user = interaction.options.getUser('kullanici', true);
    const reason = interaction.options.getString('sebep') ?? DEFAULT_REASON;
    const days = interaction.options.getInteger('mesaj_sil') ?? 0;
    const { guild } = interaction;

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (member) {
      const problem = checkTarget(interaction.member, member, 'ban');
      if (problem) return replyError(interaction, problem);
      await notifyUser(user, guild, { type: 'ban', reason });
    }

    await guild.members.ban(user.id, {
      reason: `${interaction.user.tag}: ${reason}`,
      deleteMessageSeconds: days * 86_400,
    });
    const c = await recordCase(guild, { userId: user.id, modId: interaction.user.id, type: 'ban', reason });
    await interaction.reply({ embeds: [caseEmbed(c)] });
  },
};
