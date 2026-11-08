import { MessageFlags } from 'discord.js';
import { getRoleMenu } from '../systems/panels.js';
import { replySuccess } from '../utils/embeds.js';

export default {
  prefix: 'roller',
  async execute(interaction, [action]) {
    const { member, guild } = interaction;
    const menuRoles = getRoleMenu(guild.id).map((r) => r.role_id).filter((id) => guild.roles.cache.get(id)?.editable);
    const selected = action === 'sec' ? interaction.values : [];

    const add = selected.filter((id) => menuRoles.includes(id) && !member.roles.cache.has(id));
    const remove = menuRoles.filter((id) => !selected.includes(id) && member.roles.cache.has(id));

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (add.length) await member.roles.add(add, 'Rol menüsü');
    if (remove.length) await member.roles.remove(remove, 'Rol menüsü');

    const parts = [];
    if (add.length) parts.push(`Eklendi: ${add.map((id) => `<@&${id}>`).join(' ')}`);
    if (remove.length) parts.push(`Kaldırıldı: ${remove.map((id) => `<@&${id}>`).join(' ')}`);
    await replySuccess(interaction, parts.join('\n') || 'Değişiklik yok.');
  },
};
