import { MessageFlags } from 'discord.js';
import { castVote } from '../systems/polls.js';
import { e } from '../utils/emojis.js';

export default {
  prefix: 'anket',
  async execute(interaction, [, choice]) {
    const result = castVote(interaction.message.id, interaction.user.id, Number(choice));
    if (!result) return interaction.reply({ content: `${e('carpi', '❌')} Bu anket sona erdi.`, flags: MessageFlags.Ephemeral });
    await interaction.update(result.view);
    await interaction
      .followUp({ content: `${e('onayli', '✅')} ${result.removed ? 'Oyun geri alındı.' : 'Oyun kaydedildi.'}`, flags: MessageFlags.Ephemeral })
      .catch(() => {});
  },
};
