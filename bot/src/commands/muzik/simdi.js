import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { getQueue } from '../../systems/music.js';
import { UserError } from '../../utils/errors.js';

export default {
  aliases: ['np', 'nowplaying', 'şimdi', 'calan', 'çalan'],
  data: new SlashCommandBuilder().setName('simdi').setDescription('Şu an çalan şarkı ve kontrol paneli.').setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const queue = getQueue(interaction.guild.id);
    if (!queue?.current) throw new UserError('Şu an bir şey çalmıyor. `/cal` ile başlat.');
    // Yeni mesaj kontrol paneli olur, eskisinin butonları kapanır
    await queue.disablePanel();
    await interaction.reply({ embeds: [queue.nowPlayingEmbed()], components: queue.controls(), allowedMentions: { parse: [] } });
    queue.panel = await interaction.fetchReply().catch(() => null);
  },
};
