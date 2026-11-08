import { e } from '../utils/emojis.js';
import { Events, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { sendLog } from '../utils/logger.js';

// /temizle veya toplu silme: silinen mesajların dökümü .txt olarak eklenir
export default {
  name: Events.MessageBulkDelete,
  async execute(messages, channel) {
    if (!channel.guild) return;
    const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const known = sorted.filter((m) => !m.partial);
    const lines = known.map((m) => {
      const time = new Date(m.createdTimestamp).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
      const files = m.attachments.size ? ` [ek: ${m.attachments.map((a) => a.url).join(' ')}]` : '';
      return `[${time}] ${m.author?.tag ?? '?'} (${m.author?.id ?? '?'}): ${m.content}${files}`;
    });
    const authors = new Map();
    for (const m of known) if (m.author) authors.set(m.author.id, (authors.get(m.author.id) ?? 0) + 1);
    const top = [...authors].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => `<@${id}> ${n}`).join(', ');

    const embed = new EmbedBuilder()
      .setColor(0xc0392b)
      .setTitle(`${e('cop', '🧹')} Toplu mesaj silindi`)
      .setDescription(
        `**Kanal:** ${channel}\n**Silinen:** ${messages.size} mesaj` +
          (known.length < messages.size ? ` (${messages.size - known.length} tanesinin içeriği bilinmiyor)` : '') +
          (top ? `\n**Yazanlar:** ${top}` : '') +
          '\nYetkili komutu kullandıysa mod-log kanalında görünür.',
      )
      .setTimestamp();
    const files = lines.length
      ? [new AttachmentBuilder(Buffer.from(`#${channel.name} — ${messages.size} mesaj silindi\n\n${lines.join('\n')}`, 'utf8'), { name: `silinenler-${channel.name}.txt` })]
      : [];
    await sendLog(channel.guild, 'log_message', { embeds: [embed], files });
  },
};
