import { MessageFlags } from 'discord.js';
import { getSetting } from '../core/settings.js';
import { membersWithoutRole } from '../systems/audit.js';
import { getLevel, Level } from '../utils/permissions.js';
import { replyError, replySuccess } from '../utils/embeds.js';

const running = new Set();

export default {
  prefix: 'denetim',
  async execute(interaction, [action]) {
    if (getLevel(interaction.member) < Level.ADMIN) return replyError(interaction, 'Bu işlem için Yönetici yetkisi gerekiyor.');

    if (action === 'uye-rolu') {
      const { guild } = interaction;
      const roleId = getSetting(guild.id, 'member_role');
      if (!roleId) return replyError(interaction, 'Üye rolü ayarlı değil.');
      if (running.has(guild.id)) return replyError(interaction, 'Bu işlem zaten sürüyor.');

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      running.add(guild.id);
      let given = 0;
      try {
        for (const member of membersWithoutRole(guild).values()) {
          await member.roles.add(roleId, `Denetim düzeltmesi: ${interaction.user.tag}`).then(() => given++).catch(() => {});
        }
      } finally {
        running.delete(guild.id);
      }
      await replySuccess(interaction, `**${given}** üyeye <@&${roleId}> rolü verildi.`);
    }
  },
};
