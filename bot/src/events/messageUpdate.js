import { e } from '../utils/emojis.js';
import { Events, EmbedBuilder } from 'discord.js';
import { sendLog } from '../utils/logger.js';
import { checkMessage } from '../systems/protection.js';

export default {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (!newMessage.guild) return;
    if (newMessage.partial) await newMessage.fetch().catch(() => {});
    if (newMessage.partial || newMessage.author?.bot || newMessage.system) return;
    if (oldMessage.content === newMessage.content) return; // sadece embed yüklenmesi vb.

    // Temiz yazılıp sonradan reklama çevrilen mesajlar da yakalansın
    await checkMessage(newMessage, { edited: true }).catch((error) => console.error('[Düzenleme koruması]', error.message));
    if (oldMessage.partial) return; // eski metin bilinmiyor, loglanacak bir karşılaştırma yok

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`${e('kalem', '✏️')} Mesaj düzenlendi`)
      .setDescription(`**Kanal:** ${newMessage.channel} • [Mesaja git](${newMessage.url})\n**Yazan:** ${newMessage.author} (\`${newMessage.author.id}\`)`)
      .addFields(
        { name: 'Önce', value: (oldMessage.content || '*boş*').slice(0, 1024) },
        { name: 'Sonra', value: (newMessage.content || '*boş*').slice(0, 1024) },
      )
      .setTimestamp();

    await sendLog(newMessage.guild, 'log_message', { embeds: [embed] });
  },
};
