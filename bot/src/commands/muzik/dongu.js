import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { kariaEmbed } from '../../utils/embeds.js';
import { requireVoice, LOOP_NAMES } from '../../systems/music.js';
import { e } from '../../utils/emojis.js';

const icon = (mode) => (mode === 'off' ? e('ok', '➡️') : e('yenile', mode === 'track' ? '🔂' : '🔁'));

export default {
  aliases: ['loop', 'döngü', 'tekrar', 'repeat'],
  data: new SlashCommandBuilder()
    .setName('dongu')
    .setDescription('Tekrar modu: kapalı, şarkı ya da tüm sıra (boşsa sıradaki moda geçer).')
    .addStringOption((o) =>
      o.setName('mod').setDescription('Mod').addChoices({ name: 'Kapalı', value: 'off' }, { name: 'Şarkı', value: 'track' }, { name: 'Sıra', value: 'queue' }),
    )
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { queue } = requireVoice(interaction.member);
    const mode = queue.cycleLoop(interaction.options.getString('mod') ?? undefined);
    await queue.refreshPanel();
    await interaction.reply({ embeds: [kariaEmbed(null, 'Müzik').setDescription(`${icon(mode)} Döngü: **${LOOP_NAMES[mode]}**`)] });
  },
};
