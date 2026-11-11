import { MessageFlags } from 'discord.js';
import { roleProblem } from '../systems/buttonRoles.js';
import { replyError, replySuccess } from '../utils/embeds.js';

export default {
  prefix: 'butonrol',
  async execute(interaction, [roleId]) {
    const { member, guild } = interaction;
    const role = guild.roles.cache.get(roleId);
    const problem = roleProblem(guild, role);
    if (problem) return replyError(interaction, problem);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, 'Buton rol');
      return replySuccess(interaction, `Kaldırıldı: ${role}`);
    }
    await member.roles.add(role, 'Buton rol');
    return replySuccess(interaction, `Eklendi: ${role}`);
  },
};
