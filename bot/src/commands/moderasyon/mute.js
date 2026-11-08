import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { checkTarget, notifyUser, recordCase, caseEmbed, DEFAULT_REASON } from '../../systems/moderation.js';
import { replyError } from '../../utils/embeds.js';
import { parseDuration } from '../../utils/time.js';

const MAX_TIMEOUT = 28 * 86_400_000;

export default {
  aliases: ['sustur', 'timeout'],
  level: Level.STAFF,
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Bir üyeyi belirli bir süre susturur (zaman aşımı).')
    .addUserOption((o) => o.setName('kullanici').setDescription('Susturulacak üye').setRequired(true))
    .addStringOption((o) => o.setName('sure').setDescription('Örn: 10dk, 1sa, 2g, 1sa30dk (en fazla 28g)').setRequired(true))
    .addStringOption((o) => o.setName('sebep').setDescription('Sebep').setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const member = interaction.options.getMember('kullanici');
    const duration = parseDuration(interaction.options.getString('sure', true));
    const reason = interaction.options.getString('sebep') ?? DEFAULT_REASON;

    if (!member) return replyError(interaction, 'Bu kişi sunucuda değil.');
    if (!duration) return replyError(interaction, 'Geçersiz süre. Örnek: `10dk`, `1sa`, `2g`, `1sa30dk`');
    if (duration > MAX_TIMEOUT) return replyError(interaction, 'Susturma en fazla 28 gün olabilir. Daha uzunu için `/jail` kullan.');

    const problem = checkTarget(interaction.member, member, 'mute');
    if (problem) return replyError(interaction, problem);

    await member.timeout(duration, `${interaction.user.tag}: ${reason}`);
    await notifyUser(member.user, interaction.guild, { type: 'mute', reason, duration });
    const c = await recordCase(interaction.guild, {
      userId: member.id, modId: interaction.user.id, type: 'mute', reason, duration,
    });
    await interaction.reply({ embeds: [caseEmbed(c)] });
  },
};
