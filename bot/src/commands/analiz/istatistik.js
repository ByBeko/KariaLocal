import { SlashCommandBuilder } from 'discord.js';
import { userStats, sparkline, formatVoice, PERIOD_CHOICES, periodName } from '../../systems/stats.js';
import { brandEmbed } from '../../utils/embeds.js';
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

    const embed = brandEmbed()
      .setAuthor({ name: `${member?.displayName ?? user.username} • ${periodName(days)}`, iconURL: user.displayAvatarURL() })
      .addFields(
        { name: `${e('mesaj', '💬')} Mesaj`, value: `**${s.messages}**\nSıra: ${rank(s.messageRank)}`, inline: true },
        { name: `${e('mikrofon', '🎙️')} Ses`, value: `**${formatVoice(s.voiceSeconds)}**\nSıra: ${rank(s.voiceRank)}`, inline: true },
        { name: `${e('takvim', '📅')} Aktif gün`, value: `**${s.activeDays}**`, inline: true },
        { name: 'En çok yazdığı kanallar', value: channels, inline: true },
        { name: 'En çok durduğu ses kanalları', value: voiceChannels, inline: true },
        { name: 'Son 14 gün (mesaj)', value: `\`${sparkline(s.daily.map((d) => d.value))}\`` },
      )
      .setThumbnail(user.displayAvatarURL({ size: 256 }));

    if (member?.joinedTimestamp) embed.setFooter({ text: 'Sunucuya katılım' }).setTimestamp(member.joinedTimestamp);
    if (member?.joinedTimestamp) embed.setDescription(`Katıldı: ${relativeTime(member.joinedTimestamp)}`);
    await interaction.reply({ embeds: [embed] });
  },
};
