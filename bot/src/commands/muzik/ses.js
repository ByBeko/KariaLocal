import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { brandEmbed } from '../../utils/embeds.js';
import { requireVoice } from '../../systems/music.js';
import { e } from '../../utils/emojis.js';

export default {
  aliases: ['volume', 'vol', 'sesduzeyi'],
  data: new SlashCommandBuilder()
    .setName('ses')
    .setDescription('Müziğin ses düzeyi (herkes için).')
    .addIntegerOption((o) => o.setName('duzey').setDescription('0-150 (varsayılan 70)').setMinValue(0).setMaxValue(150))
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { queue } = requireVoice(interaction.member);
    const level = interaction.options.getInteger('duzey');
    if (level === null) return interaction.reply({ embeds: [brandEmbed().setDescription(`${e('kulaklik', '🔊')} Ses düzeyi: **%${queue.volume}**`)] });
    const old = queue.volume;
    queue.setVolume(level);
    await queue.refreshPanel();
    await interaction.reply({ embeds: [brandEmbed().setDescription(`${(level === 0 ? e('ses_kapali', '🔇') : e('kulaklik', '🔊'))} Ses düzeyi: %${old} → **%${level}**`)] });
  },
};
