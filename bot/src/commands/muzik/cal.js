import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { brandEmbed } from '../../utils/embeds.js';
import { playQuery, formatTime } from '../../systems/music.js';

export default {
  aliases: ['play', 'p', 'çal', 'oynat'],
  data: new SlashCommandBuilder()
    .setName('cal')
    .setDescription("YouTube'dan şarkı çalar ya da sıraya ekler (isim, link ya da oynatma listesi).")
    .addStringOption((o) => o.setName('sarki').setDescription('Şarkı adı ya da YouTube/SoundCloud linki').setRequired(true).setMaxLength(500))
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.deferReply();
    const query = interaction.options.getString('sarki', true);
    const { queue, tracks, added, playlist, wasPlaying } = await playQuery(interaction.member, interaction.channel, query);
    const first = tracks[0];

    let embed;
    if (playlist) {
      const total = tracks.slice(0, added).reduce((a, t) => a + t.duration, 0);
      embed = brandEmbed().setDescription(
        `${e('pano', '📃')} **${added}** şarkı sıraya eklendi${added < tracks.length ? ` (sıra sınırı yüzünden ${tracks.length - added} tanesi eklenemedi)` : ''} • toplam ${formatTime(total)}`,
      );
    } else if (wasPlaying) {
      const position = queue.tracks.indexOf(first) + 1;
      const wait = Math.max(0, (queue.current?.duration ?? 0) - queue.position) + queue.tracks.slice(0, position - 1).reduce((a, t) => a + t.duration, 0);
      embed = brandEmbed()
        .setDescription(`${e('arti_rozet', '➕')} Sıraya eklendi: **[${first.title}](${first.url})** \`${formatTime(first.duration)}\`\nSıradaki yeri: **#${position}** • yaklaşık ${formatTime(wait)} sonra`)
        .setThumbnail(first.thumbnail);
    } else {
      embed = brandEmbed()
        .setDescription(`${e('kumsaati', '⏳')} Hazırlanıyor: **[${first.title}](${first.url})** \`${formatTime(first.duration)}\``)
        .setThumbnail(first.thumbnail);
    }
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
