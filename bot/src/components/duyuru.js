import { getLevel, Level } from '../utils/permissions.js';
import { replyError, replySuccess } from '../utils/embeds.js';
import { e } from '../utils/emojis.js';
import { quote } from '../utils/style.js';

const MAX_MESSAGE = 2000;

function announcement(title, text, note) {
  const blocks = text.trim().split(/\n\s*\n/).map((block) => {
    const [first, ...rest] = block.trim().split('\n');
    if (!first.startsWith('#')) return quote(block.trim());
    const heading = first.replace(/^#+\s*/, '');
    return `### ${e('unlem', '❗')}   ${heading}${rest.length ? `\n${quote(rest.join('\n'))}` : ''}`;
  });
  const parts = [`# ${e('megafon', '📢')}  Karia — ${title}`, ...blocks];
  if (note) parts.push(`> ${e('ampul', '💡')}  *${note}*`);
  return parts.join('\n\n\n');
}

export default {
  prefix: 'duyuru',
  async execute(interaction, [, channelId, roleId]) {
    const { guild, fields } = interaction;
    if (getLevel(interaction.member) < Level.ADMIN) return replyError(interaction, 'Bu işlem için Yönetici yetkisi gerekiyor.');
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return replyError(interaction, 'Duyuru kanalı bulunamadı.');

    const everyone = roleId === guild.id;
    const mention = roleId === '0' ? '' : everyone ? '@everyone' : `<@&${roleId}>`;
    let content = announcement(fields.getTextInputValue('baslik'), fields.getTextInputValue('metin'), fields.getTextInputValue('not'));
    if (mention) content += `\n\n${mention}`;
    if (content.length > MAX_MESSAGE) return replyError(interaction, 'Duyuru Discord mesaj sınırını aşıyor, biraz kısalt.');

    const allowedMentions = everyone ? { parse: ['everyone'] } : { parse: [], roles: mention ? [roleId] : [] };
    const message = await channel.send({ content, allowedMentions });
    await replySuccess(interaction, `Duyuru gönderildi: ${message.url}`);
  },
};
