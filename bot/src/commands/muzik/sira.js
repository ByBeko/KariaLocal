import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { kariaEmbed, replySuccess } from '../../utils/embeds.js';
import { getQueue, requireVoice, formatTime, LOOP_NAMES } from '../../systems/music.js';
import { UserError } from '../../utils/errors.js';
import { isStaff } from '../../utils/permissions.js';

const PER_PAGE = 10;

export default {
  aliases: ['queue', 'q', 'sıra', 'liste'],
  defaultSub: 'liste',
  data: new SlashCommandBuilder()
    .setName('sira')
    .setDescription('Müzik sırası: listele, şarkı çıkar, temizle.')
    .addSubcommand((s) =>
      s
        .setName('liste')
        .setDescription('Sıradaki şarkılar')
        .addIntegerOption((o) => o.setName('sayfa').setDescription('Sayfa').setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('sil')
        .setDescription('Sıradan bir şarkıyı çıkarır')
        .addIntegerOption((o) => o.setName('numara').setDescription('Sıradaki numarası').setMinValue(1).setRequired(true)),
    )
    .addSubcommand((s) => s.setName('temizle').setDescription('Sırayı boşaltır (çalan şarkı devam eder)'))
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'liste') {
      const queue = getQueue(interaction.guild.id);
      if (!queue?.current) throw new UserError('Şu an bir şey çalmıyor. `/cal` ile başlat.');
      const pages = Math.max(1, Math.ceil(queue.tracks.length / PER_PAGE));
      const page = Math.min(interaction.options.getInteger('sayfa') ?? 1, pages);
      const start = (page - 1) * PER_PAGE;
      const lines = queue.tracks
        .slice(start, start + PER_PAGE)
        .map((t, i) => `\`${start + i + 1}.\` [${t.title.slice(0, 60)}](${t.url}) \`${formatTime(t.duration)}\` • <@${t.requesterId}>`);
      const total = queue.tracks.reduce((a, t) => a + t.duration, 0) + Math.max(0, queue.current.duration - queue.position);
      const embed = kariaEmbed(interaction.client, 'Müzik Sırası', { footer: `Sayfa ${page}/${pages}` })
        .setTitle(`${queue.tracks.length} şarkı sırada`)
        .setDescription(
          `${e('oynat', '▶️')} **Çalıyor:** [${queue.current.title.slice(0, 70)}](${queue.current.url}) \`${formatTime(queue.position)} / ${formatTime(queue.current.duration)}\`\n\n` +
            (lines.join('\n') || '*Sırada şarkı yok. `/cal` ile ekle.*'),
        )
        .addFields(
          { name: `${e('kumsaati', '⏱️')} Toplam`, value: `**${formatTime(total)}**`, inline: true },
          { name: `${e('yenile', '🔁')} Döngü`, value: `**${LOOP_NAMES[queue.loop]}**`, inline: true },
          { name: `${e('kulaklik', '🔊')} Ses`, value: `**%${queue.volume}**`, inline: true },
        );
      return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    }

    const { queue } = requireVoice(interaction.member);

    if (sub === 'sil') {
      const n = interaction.options.getInteger('numara', true);
      const track = queue.tracks[n - 1];
      if (!track) throw new UserError(`Sırada ${n}. şarkı yok. Sırada ${queue.tracks.length} şarkı var.`);
      if (track.requesterId !== interaction.user.id && !isStaff(interaction.member)) throw new UserError('Sadece kendi eklediğin şarkıları çıkarabilirsin.');
      queue.tracks.splice(n - 1, 1);
      queue.invalidatePrefetch();
      return replySuccess(interaction, `**${track.title}** sıradan çıkarıldı.`, false);
    }

    // temizle
    if (!isStaff(interaction.member) && queue.tracks.some((t) => t.requesterId !== interaction.user.id)) {
      // Başkalarının şarkıları varsa sadece kendi şarkılarını temizler
      const before = queue.tracks.length;
      queue.tracks = queue.tracks.filter((t) => t.requesterId !== interaction.user.id);
      queue.invalidatePrefetch();
      return replySuccess(interaction, `Senin eklediğin **${before - queue.tracks.length}** şarkı sıradan çıkarıldı.`, false);
    }
    const count = queue.tracks.length;
    queue.tracks = [];
    queue.invalidatePrefetch();
    await queue.refreshPanel();
    await replySuccess(interaction, `Sıra temizlendi (${count} şarkı).`, false);
  },
};
