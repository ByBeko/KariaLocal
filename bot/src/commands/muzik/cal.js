import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { kariaEmbed } from '../../utils/embeds.js';
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
      embed = kariaEmbed(interaction.client, 'Çalma Listesi Eklendi')
        .setTitle(`${added} şarkı sıraya eklendi`)
        .addFields(
          { name: `${e('pano', '📃')} Şarkı`, value: `**${added}**${added < tracks.length ? ` / ${tracks.length}` : ''}`, inline: true },
          { name: `${e('kumsaati', '⏱️')} Süre`, value: `**${formatTime(total)}**`, inline: true },
          { name: `${e('kullanici', '👤')} İsteyen`, value: `${interaction.user}`, inline: true },
        );
      if (added < tracks.length) embed.setDescription(`Sıra sınırı yüzünden ${tracks.length - added} şarkı eklenemedi.`);
    } else if (wasPlaying) {
      const position = queue.tracks.indexOf(first) + 1;
      const wait = Math.max(0, (queue.current?.duration ?? 0) - queue.position) + queue.tracks.slice(0, position - 1).reduce((a, t) => a + t.duration, 0);
      embed = kariaEmbed(interaction.client, 'Sıraya Eklendi')
        .setDescription(`${e('arti_rozet', '➕')} **[${first.title}](${first.url})**`)
        .addFields(
          { name: `${e('kumsaati', '⏱️')} Süre`, value: `**${formatTime(first.duration)}**`, inline: true },
          { name: `${e('pano', '📃')} Sıradaki yeri`, value: `**#${position}**`, inline: true },
          { name: `${e('oynat', '▶️')} Başlama`, value: `~${formatTime(wait)} sonra`, inline: true },
        )
        .setThumbnail(first.thumbnail);
    } else {
      embed = kariaEmbed(interaction.client, 'Müzik')
        .setDescription(`${e('kumsaati', '⏳')} Hazırlanıyor: **[${first.title}](${first.url})** \`${formatTime(first.duration)}\``)
        .setThumbnail(first.thumbnail);
    }
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
