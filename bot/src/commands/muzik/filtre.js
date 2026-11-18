import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { kariaEmbed } from '../../utils/embeds.js';
import { requireVoice, FILTERS } from '../../systems/music.js';

const describe = (name) => `${FILTERS[name].emoji} Filtre: **${FILTERS[name].label}**`;

export default {
  aliases: ['filter', 'efekt', 'filtreler'],
  data: new SlashCommandBuilder()
    .setName('filtre')
    .setDescription('Müziğe ses filtresi: 8D, bass boost, nightcore, slowed ya da kapalı (herkes için).')
    .addStringOption((o) =>
      o
        .setName('tur')
        .setDescription('Filtre (boş bırakılırsa açık olanı gösterir)')
        .addChoices(...Object.entries(FILTERS).map(([value, f]) => ({ name: f.label, value }))),
    )
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { queue } = requireVoice(interaction.member);
    const name = interaction.options.getString('tur');
    if (name === null) return interaction.reply({ embeds: [kariaEmbed(null, 'Müzik').setDescription(describe(queue.filter))] });
    await queue.setFilter(name);
    await queue.refreshPanel();
    await interaction.reply({ embeds: [kariaEmbed(null, 'Müzik').setDescription(describe(name))] });
  },
};
