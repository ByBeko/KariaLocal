import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { kariaEmbed } from '../../utils/embeds.js';
import { voteSkip, getQueue } from '../../systems/music.js';
import { e } from '../../utils/emojis.js';

export default {
  aliases: ['skip', 's', 'geç', 'atla', 'next'],
  data: new SlashCommandBuilder().setName('gec').setDescription('Çalan şarkıyı geçer (kalabalıkta oylama yapılır).').setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const title = getQueue(interaction.guild.id)?.current?.title;
    const r = voteSkip(interaction.member);
    const text = r.skipped
      ? `${e('atla', '⏭️')} **${title}** geçildi${r.votes ? ` (${r.votes}/${r.needed} oy)` : ''}.`
      : `${e('begeni', '🗳️')} Geçme oyu verildi: **${r.votes}/${r.needed}**. Diğer dinleyiciler de \`/gec\` yazarsa geçilir.`;
    await interaction.reply({ embeds: [kariaEmbed(null, 'Müzik').setDescription(text)] });
  },
};
