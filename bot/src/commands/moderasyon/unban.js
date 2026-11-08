import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { recordCase, caseEmbed, DEFAULT_REASON } from '../../systems/moderation.js';
import { replyError } from '../../utils/embeds.js';

export default {
  level: Level.MOD,
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Bir kullanıcının yasağını kaldırır.')
    .addStringOption((o) => o.setName('kullanici_id').setDescription('Yasağı kalkacak kişinin ID\'si').setRequired(true))
    .addStringOption((o) => o.setName('sebep').setDescription('Sebep').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const userId = interaction.options.getString('kullanici_id', true).replace(/\D/g, '');
    const reason = interaction.options.getString('sebep') ?? DEFAULT_REASON;
    const { guild } = interaction;

    if (!/^\d{17,20}$/.test(userId)) return replyError(interaction, 'Geçerli bir kullanıcı ID\'si yaz.');
    const ban = await guild.bans.fetch(userId).catch(() => null);
    if (!ban) return replyError(interaction, 'Bu ID ile yasaklanmış bir kullanıcı yok.');

    await guild.members.unban(userId, `${interaction.user.tag}: ${reason}`);
    const c = await recordCase(guild, { userId, modId: interaction.user.id, type: 'unban', reason });
    await interaction.reply({ embeds: [caseEmbed(c)] });
  },
};
