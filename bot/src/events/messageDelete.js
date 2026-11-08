import { e } from '../utils/emojis.js';
import { Events, EmbedBuilder } from 'discord.js';
import { sendLog } from '../utils/logger.js';
import { findMessageDeleter } from '../systems/auditlog.js';

export default {
  name: Events.MessageDelete,
  async execute(message) {
    if (!message.guild || message.author?.bot) return;

    const deleter = await findMessageDeleter(message);
    if (deleter === message.client.user.id) return; // koruma sistemi sildi, reklam-log'a yazıldı

    const attachments = message.attachments?.map((a) => `[${a.name}](${a.proxyURL ?? a.url})`).join('\n');
    const lines = [
      `**Kanal:** ${message.channel}`,
      message.author ? `**Yazan:** ${message.author} (\`${message.author.id}\`)` : '**Yazan:** bilinmiyor (bot açılmadan önceki mesaj)',
      deleter ? `**Silen:** <@${deleter}> ${e('kalkan', '🛡️')}` : message.author ? '**Silen:** kendisi' : null,
      message.createdTimestamp ? `**Gönderilme:** <t:${Math.floor(message.createdTimestamp / 1000)}:R>` : null,
      message.reference?.messageId ? `**Yanıtladığı:** [mesaj](https://discord.com/channels/${message.guildId}/${message.reference.channelId}/${message.reference.messageId})` : null,
    ].filter(Boolean);

    const embed = new EmbedBuilder()
      .setColor(deleter ? 0xc0392b : 0xe74c3c)
      .setTitle(deleter ? `${e('cop', '🗑️')} Mesaj bir yetkili tarafından silindi` : `${e('cop', '🗑️')} Mesaj silindi`)
      .setDescription(lines.join('\n'))
      .addFields({ name: 'İçerik', value: (message.content || (message.partial ? '*bilinmiyor (önbellekte yoktu)*' : '*metin yok*')).slice(0, 1024) })
      .setTimestamp();
    if (message.author) embed.setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() });
    if (attachments) embed.addFields({ name: 'Ekler', value: attachments.slice(0, 1024) });
    if (message.stickers?.size) embed.addFields({ name: 'Çıkartma', value: message.stickers.map((s) => s.name).join(', ') });

    await sendLog(message.guild, 'log_message', { embeds: [embed] });
  },
};
