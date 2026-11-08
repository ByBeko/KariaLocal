import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { checkTarget, notifyUser, recordCase, caseEmbed, countActiveWarns } from '../../systems/moderation.js';
import { getSetting } from '../../core/settings.js';
import { replyError } from '../../utils/embeds.js';

const AUTO_MUTE = 3_600_000; // 1 saat

export default {
  aliases: ['warn'],
  level: Level.STAFF,
  data: new SlashCommandBuilder()
    .setName('uyar')
    .setDescription('Bir üyeye uyarı verir. Uyarı sınırına ulaşınca otomatik susturulur.')
    .addUserOption((o) => o.setName('kullanici').setDescription('Üye').setRequired(true))
    .addStringOption((o) => o.setName('sebep').setDescription('Sebep').setRequired(true).setMaxLength(500))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const member = interaction.options.getMember('kullanici');
    const reason = interaction.options.getString('sebep', true);
    const { guild } = interaction;
    if (!member) return replyError(interaction, 'Bu kişi sunucuda değil.');

    const problem = checkTarget(interaction.member, member, 'warn');
    if (problem) return replyError(interaction, problem);

    const c = await recordCase(guild, { userId: member.id, modId: interaction.user.id, type: 'warn', reason });
    await notifyUser(member.user, guild, { type: 'warn', reason });

    const count = countActiveWarns(guild.id, member.id);
    const limit = getSetting(guild.id, 'warn_limit');
    const embed = caseEmbed(c).setFooter({ text: `Aktif uyarı: ${count}${limit ? ` / ${limit}` : ''}` });
    await interaction.reply({ embeds: [embed] });

    if (limit > 0 && count % limit === 0 && member.moderatable) {
      const autoReason = `Otomatik: ${count} uyarıya ulaştı`;
      await member.timeout(AUTO_MUTE, autoReason);
      await notifyUser(member.user, guild, { type: 'mute', reason: autoReason, duration: AUTO_MUTE });
      const muteCase = await recordCase(guild, {
        userId: member.id, modId: interaction.client.user.id, type: 'mute', reason: autoReason, duration: AUTO_MUTE,
      });
      await interaction.followUp({ embeds: [caseEmbed(muteCase)] });
    }
  },
};
