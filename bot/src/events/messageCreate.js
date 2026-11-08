import { Events, ChannelType } from 'discord.js';
import { getSetting } from '../core/settings.js';
import { isStaff } from '../utils/permissions.js';
import { checkMessage } from '../systems/protection.js';
import { handlePrefix } from '../core/prefix.js';
import { recordMessage } from '../systems/stats.js';
import { handleMention } from '../systems/ai.js';
import { handleMessageXp } from '../systems/levels.js';
import { handleAutoResponse } from '../systems/autoresponse.js';
import { handleQuickAnswer } from '../systems/quickAnswers.js';
import { handleGuide } from '../systems/guide.js';
import { handleAfk } from '../systems/afk.js';

const hasMedia = (message) =>
  message.attachments.size > 0 || message.embeds.some((e) => e.image || e.video || e.thumbnail);

export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.inGuild() || message.author.bot || message.system) return;

    if (await checkMessage(message)) return;
    await handleAfk(message).catch((e) => console.error('[AFK]', e.message));
    recordMessage(message);
    if (await handlePrefix(message)) return;
    if (await handleMention(message)) return;
    await handleMessageXp(message).catch((e) => console.error('[Mesaj XP]', e.message));
    if (await handleQuickAnswer(message).catch((e) => console.error('[Hızlı cevap]', e.message))) return;
    if (await handleAutoResponse(message)) return;
    await handleGuide(message).catch((e) => console.error('[Rehber]', e.message));

    // Galeri: sadece medya, her gönderiye yorum başlığı
    const mediaId = getSetting(message.guild.id, 'media_channel');
    if (mediaId && message.channelId === mediaId && message.channel.type === ChannelType.GuildText) {
      if (!hasMedia(message)) {
        if (isStaff(message.member)) return;
        await message.delete().catch(() => {});
        const notice = await message.channel
          .send(`${message.author}, bu kanala sadece fotoğraf/video atabilirsin. Yorumları gönderilerin başlığına yaz.`)
          .catch(() => null);
        if (notice) setTimeout(() => notice.delete().catch(() => {}), 6_000);
        return;
      }
      await message
        .startThread({ name: `${message.member.displayName} • Yorumlar`.slice(0, 100), autoArchiveDuration: 1440 })
        .catch(() => {});
    }
  },
};
