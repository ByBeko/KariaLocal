import { SlashCommandBuilder } from 'discord.js';
import { userStats, sparkline, formatVoice, PERIOD_CHOICES, periodName } from '../../systems/stats.js';
import { kariaEmbed, label } from '../../utils/embeds.js';
import { relativeTime } from '../../utils/time.js';
import { e } from '../../utils/emojis.js';

export default {
  aliases: ['stat', 'i'],
  data: new SlashCommandBuilder()
    .setName('istatistik')
    .setDescription('Bir üyenin mesaj ve ses istatistikleri.')
    .addUserOption((o) => o.setName('kullanici').setDescription('Kimin? (boş = sen)'))
    .addIntegerOption((o) => o.setName('sure').setDescription('Zaman aralığı (varsayılan: son 7 gün)').addChoices(...PERIOD_CHOICES)),

  async execute(interaction) {
    const user = interaction.options.getUser('kullanici') ?? interaction.user;
    const member = interaction.options.getMember('kullanici') ?? (user.id === interaction.user.id ? interaction.member : null);
    const days = interaction.options.getInteger('sure') ?? 7;
    const s = userStats(interaction.guild.id, user.id, days);

    const rank = (r) => (r ? `**#${r.rank}** / ${r.of}` : '—');
    const channels = s.topChannels.map((c) => `<#${c.channelId}> · ${c.messages}`).join('\n') || 'Henüz mesaj yok';
    const voiceChannels = s.topVoiceChannels.map((c) => `<#${c.channelId}> · ${formatVoice(c.seconds)}`).join('\n') || 'Henüz ses yok';

    const embed = kariaEmbed(interaction.client, 'İstatistikler', { icon: user.displayAvatarURL() })
      .setTitle(member?.displayName ?? user.username)
      .setDescription([
        `${e('takvim', '📅')} **${periodName(days)}**`,
        ...(member?.joinedTimestamp ? [`${e('giris', '📥')} **Katıldı** ${relativeTime(member.joinedTimestamp)}`] : []),
      ].join(' · '))
      .addFields(
        { name: label('mesaj', '💬', 'Mesaj'), value: `**${s.messages}** mesaj\nSıra ${rank(s.messageRank)}`, inline: true },
        { name: label('mikrofon', '🎙️', 'Ses'), value: `**${formatVoice(s.voiceSeconds)}**\nSıra ${rank(s.voiceRank)}`, inline: true },
        { name: label('takvim2', '📆', 'Aktiflik'), value: `**${s.activeDays}** aktif gün`, inline: true },
        { name: label('pano', '📝', 'Yazdığı kanallar'), value: channels, inline: true },
        { name: label('kulaklik', '🔊', 'Ses kanalları'), value: voiceChannels, inline: true },
        { name: label('istatistik', '📈', 'Son 14 gün'), value: `\`${sparkline(s.daily.map((d) => d.value))}\`` },
      )
      .setThumbnail(user.displayAvatarURL({ size: 256 }));
    await interaction.reply({ embeds: [embed] });
  },
};
