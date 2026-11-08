import { getSetting } from '../core/settings.js';
import { replyError, replySuccess } from '../utils/embeds.js';
import { e } from '../utils/emojis.js';

export default {
  prefix: 'dogrula',
  async execute(interaction) {
    const roleId = getSetting(interaction.guild.id, 'member_role');
    if (!roleId) return replyError(interaction, 'Üye rolü henüz ayarlanmamış. Yetkililere haber ver.');
    if (interaction.member.roles.cache.has(roleId)) return replyError(interaction, `Zaten doğrulanmışsın. ${e('onayli', '🙂')}`);

    await interaction.member.roles.add(roleId, 'Doğrulama butonu');
    await replySuccess(interaction, `Hoş geldin! Artık **${interaction.guild.name}** sunucusunun tamamını görebilirsin.`);
  },
};
