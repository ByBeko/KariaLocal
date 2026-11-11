import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { kariaEmbed } from '../../utils/embeds.js';
import { requireVoice } from '../../systems/music.js';
import { e } from '../../utils/emojis.js';

export default {
  aliases: ['pause', 'resume', 'devam'],
  data: new SlashCommandBuilder().setName('duraklat').setDescription('Müziği duraklatır ya da devam ettirir.').setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { queue } = requireVoice(interaction.member);
    const paused = queue.togglePause();
    await queue.refreshPanel();
    await interaction.reply({ embeds: [kariaEmbed(null, 'Müzik').setDescription(paused ? `${e('duraklat', '⏸️')} Duraklatıldı. Devam için tekrar yaz.` : `${e('oynat', '▶️')} Devam ediyor.`)] });
  },
};
