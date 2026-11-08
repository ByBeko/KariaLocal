import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { brandEmbed } from '../../utils/embeds.js';
import { requireVoice } from '../../systems/music.js';
import { UserError } from '../../utils/errors.js';

export default {
  aliases: ['shuffle', 'karıştır', 'kariştir'],
  data: new SlashCommandBuilder().setName('karistir').setDescription('Sıradaki şarkıları karıştırır.').setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { queue } = requireVoice(interaction.member);
    if (queue.tracks.length < 2) throw new UserError('Karıştırmak için sırada en az 2 şarkı olmalı.');
    queue.shuffle();
    await interaction.reply({ embeds: [brandEmbed().setDescription(`${e('yenile', '🔀')} Sıradaki **${queue.tracks.length}** şarkı karıştırıldı.`)] });
  },
};
