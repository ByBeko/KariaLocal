import { e } from '../../utils/emojis.js';
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { serverStats, sparkline, bar, formatVoice, PERIOD_CHOICES, periodName } from '../../systems/stats.js';
import { brandEmbed } from '../../utils/embeds.js';

function change(now, before) {
  if (before === null) return '';
  if (before === 0) return now > 0 ? ` (${e('parilti', '🆕')})` : '';
  const pct = Math.round(((now - before) / before) * 100);
  return ` (${pct >= 0 ? `${e('yukari', '📈')} +` : `${e('asagi', '📉')} `}${pct}%)`;
}

export default {
  level: Level.STAFF,
  aliases: ['rapor'],
  data: new SlashCommandBuilder()
    .setName('analiz')
    .setDescription('Sunucu aktivite raporu: mesaj, ses, en aktifler, yoğun saatler, büyüme.')
    .addIntegerOption((o) => o.setName('sure').setDescription('Zaman aralığı (varsayılan: son 7 gün)').addChoices(...PERIOD_CHOICES))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild } = interaction;
    const days = interaction.options.getInteger('sure') ?? 7;
    const s = serverStats(guild.id, days);
    const humans = guild.members.cache.filter((m) => !m.user.bot).size;

    // Yoğun saatler: 4 saatlik dilimler
    const slots = Array.from({ length: 6 }, (_, i) => ({
      label: `${String(i * 4).padStart(2, '0')}-${String(i * 4 + 4).padStart(2, '0')}`,
      value: s.hours.slice(i * 4, i * 4 + 4).reduce((a, b) => a + b, 0),
    }));
    const slotMax = Math.max(...slots.map((x) => x.value));
    const peakHour = s.hours.indexOf(Math.max(...s.hours));

    const users = s.topUsers.map((u, i) => `\`${i + 1}.\` <@${u.userId}> · ${u.value}`).join('\n') || '—';
    const voiceUsers = s.topVoiceUsers.map((u, i) => `\`${i + 1}.\` <@${u.userId}> · ${formatVoice(u.value)}`).join('\n') || '—';
    const channels = s.topChannels.slice(0, 5).map((c) => `<#${c.channelId}> · ${c.messages}`).join('\n') || '—';

    const embed = brandEmbed()
      .setAuthor({ name: `${guild.name} • Aktivite Raporu`, iconURL: guild.iconURL() ?? undefined })
      .setTitle(periodName(days))
      .addFields(
        { name: `${e('mesaj', '💬')} Mesaj`, value: `**${s.messages}**${change(s.messages, s.previousMessages)}`, inline: true },
        { name: `${e('mikrofon', '🎙️')} Ses`, value: `**${formatVoice(s.voiceSeconds)}**`, inline: true },
        { name: `${e('arkadaslar', '👥')} Aktif üye`, value: `**${s.activeUsers}** / ${humans} (%${humans ? Math.round((s.activeUsers / humans) * 100) : 0})`, inline: true },
        { name: `${e('giris', '📥')} Katılan`, value: `**${s.joins}**`, inline: true },
        { name: `${e('cikis', '📤')} Ayrılan`, value: `**${s.leaves}**`, inline: true },
        { name: `${e('istatistik', '📊')} Net`, value: `**${s.joins - s.leaves >= 0 ? '+' : ''}${s.joins - s.leaves}**`, inline: true },
        { name: `${e('kupa', '🏆')} En çok yazanlar`, value: users, inline: true },
        { name: `${e('kulaklik', '🎧')} En çok seste kalanlar`, value: voiceUsers, inline: true },
        { name: `${e('raptiye', '📍')} En aktif kanallar`, value: channels, inline: true },
        {
          name: `${e('kumsaati', '🕐')} Yoğun saatler (zirve ${String(peakHour).padStart(2, '0')}:00)`,
          value: `\`\`\`${slots.map((x) => `${x.label} ${bar(x.value, slotMax)} ${x.value}`).join('\n')}\`\`\``,
        },
        {
          name: `${e('yukari', '📈')} Günlük mesaj (son ${s.daily.length} gün)`,
          value: `\`${sparkline(s.daily.map((d) => d.value))}\`  en yüksek: ${Math.max(...s.daily.map((d) => d.value))}`,
        },
      )
      .setFooter({ text: s.dataSince ? `Veri başlangıcı: ${s.dataSince} • Türkiye saati` : 'Henüz veri yok • /gecmis-tara ile geçmiş mesajlar sayılabilir' });

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
