import { e } from '../../utils/emojis.js';
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { getCase, deactivateCase } from '../../systems/moderation.js';
import { replyError, replySuccess } from '../../utils/embeds.js';
import { sendLog } from '../../utils/logger.js';

export default {
  level: Level.MOD,
  data: new SlashCommandBuilder()
    .setName('uyari-sil')
    .setDescription('Vaka numarasıyla bir uyarıyı siler.')
    .addIntegerOption((o) => o.setName('vaka').setDescription('Vaka numarası (/sicil ile bakabilirsin)').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const id = interaction.options.getInteger('vaka', true);
    const c = getCase(interaction.guild.id, id);
    if (!c || c.type !== 'warn') return replyError(interaction, `#${id} numaralı bir uyarı bulunamadı.`);
    if (!c.active) return replyError(interaction, 'Bu uyarı zaten silinmiş.');

    deactivateCase(id);
    await sendLog(interaction.guild, 'log_mod', {
      content: `${e('cop', '🗑️')} <@${interaction.user.id}>, <@${c.user_id}> kullanıcısının **#${id}** numaralı uyarısını sildi.`,
    });
    await replySuccess(interaction, `**#${id}** numaralı uyarı silindi.`);
  },
};
