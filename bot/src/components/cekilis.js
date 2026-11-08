import { MessageFlags } from 'discord.js';
import { toggleEntry, getGiveaway } from '../systems/giveaway.js';
import { e } from '../utils/emojis.js';

export default {
  prefix: 'cekilis',
  async execute(interaction) {
    const g = getGiveaway(interaction.message.id);
    if (!g || g.ended) return interaction.reply({ content: 'Bu çekiliş bitti.', flags: MessageFlags.Ephemeral });
    if (g.role_id && !interaction.member.roles.cache.has(g.role_id)) {
      return interaction.reply({ content: `Bu çekilişe katılmak için <@&${g.role_id}> rolüne sahip olmalısın.`, flags: MessageFlags.Ephemeral });
    }
    const r = toggleEntry(interaction.message.id, interaction.user.id);
    await interaction.update(r.view);
    await interaction
      .followUp({
        content: r.joined ? `${e('konfeti', '🎉')} Çekilişe katıldın! Bol şans.` : 'Çekilişten çıktın. Tekrar katılmak için butona bas.',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  },
};
