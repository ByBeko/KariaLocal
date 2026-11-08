// Çekilişler: katılım butonu, süre dolunca otomatik bitirme, yeniden çekme
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { e } from '../utils/emojis.js';
import { randomInt } from 'node:crypto';
import { db } from '../core/database.js';
import { brandEmbed } from '../utils/embeds.js';
import { sendLog } from '../utils/logger.js';
import { notifyRole } from '../utils/notifyRole.js';

const q = {
  insert: db.prepare(
    'INSERT INTO giveaways (message_id, guild_id, channel_id, host_id, prize, winners, ends_at, role_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ),
  get: db.prepare('SELECT * FROM giveaways WHERE message_id=?'),
  entrants: db.prepare('UPDATE giveaways SET entrants=? WHERE message_id=?'),
  end: db.prepare('UPDATE giveaways SET ended=1, winner_ids=? WHERE message_id=?'),
  active: db.prepare('SELECT * FROM giveaways WHERE guild_id=? AND ended=0 ORDER BY ends_at'),
  latestEnded: db.prepare('SELECT * FROM giveaways WHERE guild_id=? AND ended=1 ORDER BY ends_at DESC LIMIT 1'),
  latestActive: db.prepare('SELECT * FROM giveaways WHERE guild_id=? AND ended=0 ORDER BY ends_at LIMIT 1'),
};

export const getGiveaway = (messageId) => q.get.get(messageId);
export const activeGiveaways = (guildId) => q.active.all(guildId);
export const latestGiveaway = (guildId, ended) => (ended ? q.latestEnded : q.latestActive).get(guildId);

function view(g, { ended = false, winnerIds = [] } = {}) {
  const entrants = JSON.parse(g.entrants);
  const lines = [
    ended ? `**Kazanan${winnerIds.length > 1 ? 'lar' : ''}:** ${winnerIds.map((id) => `<@${id}>`).join(', ') || `yeterli katılım olmadı ${e('begenmeme', '😢')}`}` : 'Katılmak için aşağıdaki butona bas!',
    '',
    `${e('kumsaati', '⏳')} ${ended ? 'Bitti' : 'Bitiş'}: <t:${Math.floor(g.ends_at / 1000)}:R>`,
    `${e('kupa', '🏆')} Kazanan sayısı: **${g.winners}**`,
    `${e('arkadaslar', '👥')} Katılımcı: **${entrants.length}**`,
    `${e('kullanici', '🎙️')} Düzenleyen: <@${g.host_id}>`,
  ];
  if (g.role_id) lines.push(`${e('kilit', '🔒')} Şart: <@&${g.role_id}> rolüne sahip olmak`);
  const embed = brandEmbed()
    .setColor(ended ? 0x95a5a6 : 0xf1c40f)
    .setTitle(`${e('konfeti', '🎉')} ${g.prize}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: ended ? 'Çekiliş sona erdi' : 'Bitiş zamanı' })
    .setTimestamp(g.ends_at);
  const button = new ButtonBuilder()
    .setCustomId('cekilis:katil')
    .setEmoji(e('konfeti', '🎉'))
    .setLabel(ended ? 'Bitti' : `Katıl (${entrants.length})`)
    .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(ended);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

export async function createGiveaway({ channel, hostId, prize, winners, duration, roleId }) {
  const endsAt = Date.now() + duration;
  const draft = { prize, winners, ends_at: endsAt, host_id: hostId, role_id: roleId, entrants: '[]' };
  const ping = notifyRole(channel.guild, 'Çekiliş Bildirimi');
  const message = await channel.send({ content: `${e('konfeti', '🎉')} **ÇEKİLİŞ** ${e('hediye', '🎁')} ${ping.mention}`.trim(), ...view(draft), allowedMentions: ping.allowedMentions });
  q.insert.run(message.id, channel.guild.id, channel.id, hostId, prize, winners, endsAt, roleId);
  return message;
}

/** Katılımı açar/kapatır. Dönen: { joined, count, view } */
export function toggleEntry(messageId, userId) {
  const g = q.get.get(messageId);
  if (!g || g.ended) return null;
  const entrants = new Set(JSON.parse(g.entrants));
  const joined = !entrants.has(userId);
  if (joined) entrants.add(userId);
  else entrants.delete(userId);
  q.entrants.run(JSON.stringify([...entrants]), messageId);
  return { joined, count: entrants.size, view: view({ ...g, entrants: JSON.stringify([...entrants]) }) };
}

function pick(guild, g, count, exclude = []) {
  const pool = JSON.parse(g.entrants).filter((id) => {
    if (exclude.includes(id)) return false;
    const member = guild.members.cache.get(id);
    return member && (!g.role_id || member.roles.cache.has(g.role_id));
  });
  const winners = [];
  while (winners.length < count && pool.length) winners.push(pool.splice(randomInt(pool.length), 1)[0]);
  return winners;
}

async function fetchMessage(client, g) {
  const channel = await client.channels.fetch(g.channel_id).catch(() => null);
  return channel?.messages.fetch(g.message_id).catch(() => null);
}

export async function endGiveaway(client, messageId) {
  const g = q.get.get(messageId);
  if (!g || g.ended) return null;
  const guild = client.guilds.cache.get(g.guild_id);
  if (!guild) return null;
  const winners = pick(guild, g, g.winners);
  q.end.run(JSON.stringify(winners), messageId);

  const message = await fetchMessage(client, g);
  if (message) {
    await message.edit({ content: `${e('kupa', '🏆')} **ÇEKİLİŞ BİTTİ**`, ...view(g, { ended: true, winnerIds: winners }) }).catch(() => {});
    await message
      .reply({
        content: winners.length
          ? `${e('konfeti', '🎊')} Tebrikler ${winners.map((id) => `<@${id}>`).join(', ')}! **${g.prize}** kazandın${winners.length > 1 ? 'ız' : ''}! Ödül için <@${g.host_id}> ile iletişime geç.`
          : `${e('begenmeme', '😢')} **${g.prize}** çekilişine yeterli katılım olmadığı için kazanan çıkmadı.`,
        allowedMentions: { users: winners },
      })
      .catch(() => {});
  }
  await sendLog(guild, 'log_staff', {
    content: `${e('konfeti', '🎉')} Çekiliş bitti: **${g.prize}** • ${JSON.parse(g.entrants).length} katılımcı • Kazanan: ${winners.map((id) => `<@${id}>`).join(', ') || 'yok'}`,
  });
  return winners;
}

export async function rerollGiveaway(client, messageId, count = 1) {
  const g = q.get.get(messageId);
  if (!g?.ended) return null;
  const guild = client.guilds.cache.get(g.guild_id);
  const previous = JSON.parse(g.winner_ids ?? '[]');
  const winners = pick(guild, g, count, previous);
  if (!winners.length) return [];
  q.end.run(JSON.stringify([...previous, ...winners]), messageId);
  const message = await fetchMessage(client, g);
  await message
    ?.reply({ content: `${e('yenile', '🔁')} Yeniden çekildi! Yeni kazanan: ${winners.map((id) => `<@${id}>`).join(', ')} • **${g.prize}**`, allowedMentions: { users: winners } })
    .catch(() => {});
  return winners;
}

/** Bitmemiş çekilişi erken bitirmek için bitiş zamanını şimdiye çeker */
export async function endNow(client, messageId) {
  db.prepare('UPDATE giveaways SET ends_at=? WHERE message_id=?').run(Date.now(), messageId);
  return endGiveaway(client, messageId);
}
