// Haftalık oy sıralaması: Top.gg oyları ve Disboard bumpları ayrı ayrı sayılır,
// her Pazar 20.00'de (Türkiye) duyurular kanalına iki liste halinde atılır.
import { db } from '../core/database.js';
import { getSetting, setSetting } from '../core/settings.js';
import { findGuideChannel } from './guide.js';
import { e } from '../utils/emojis.js';

export const DISBOARD_ID = '302050872383242240';
const WEEK = 7 * 86_400_000;
const LIMIT = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

const q = {
  add: db.prepare('INSERT INTO vote_log (guild_id, user_id, source, at) VALUES (?, ?, ?, ?)'),
  top: db.prepare(`SELECT user_id, COUNT(*) AS n FROM vote_log WHERE guild_id=? AND source=? AND at>=? AND at<?
    GROUP BY user_id ORDER BY n DESC, MIN(at) ASC LIMIT ${LIMIT}`),
  prune: db.prepare('DELETE FROM vote_log WHERE at < ?'),
};

export const logVote = (guildId, userId, source, at = Date.now()) => q.add.run(guildId, userId, source, at);

// Disboard cevabı bazen önce boş gelip sonra düzenlenir; aynı mesaj iki kez sayılmasın
const counted = new Set();

/** Disboard'un başarılı /bump cevabını yakalar ve bump'ı yapan üyeye yazar. */
export function handleDisboard(message) {
  if (message.author?.id !== DISBOARD_ID || counted.has(message.id)) return;
  const embed = message.embeds[0];
  if (!embed) return;
  const ok = embed.image?.url?.includes('bump') || /bump done|:thumbsup:|👍/i.test(embed.description ?? '');
  const user = message.interactionMetadata?.user ?? message.interaction?.user;
  if (!ok || !user || user.bot) return;
  if (counted.size > 500) counted.clear();
  counted.add(message.id);
  logVote(message.guild.id, user.id, 'disboard');
}

/** Bir sonraki Pazar 20.00 (UTC+3 = 17.00 UTC) */
export function nextSlot(now) {
  const d = new Date(now);
  d.setUTCHours(17, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 7);
  return d.getTime();
}

const list = (rows, unit) =>
  rows.length
    ? rows.map((r, i) => `> ${MEDALS[i] ?? `**${i + 1}.**`} <@${r.user_id}> — **${r.n}** ${unit}`).join('\n')
    : '> Bu hafta henüz kimse yok, ilk sen ol!';

export function weeklyBoard(guild, from, to) {
  const topgg = q.top.all(guild.id, 'topgg', from, to);
  const disboard = q.top.all(guild.id, 'disboard', from, to);
  const voteChannel = findGuideChannel(guild, 'oy-ver');
  const content = [
    `# ${e('kupa', '🏆')}  Karia — Haftanın Oy Sıralaması`,
    'Bu hafta Karia’yı öne çıkaran herkese teşekkürler! İşte en çok destek olanlar:',
    '',
    `### ${e('yukari', '🔺')}  Top.gg Oyları`,
    list(topgg, 'oy'),
    '',
    `### ${e('megafon', '📣')}  Disboard Bumpları`,
    list(disboard, 'bump'),
    '',
    `-# Sıralama her Pazar 20.00’de yenilenir.${voteChannel ? ` Oy vermek için ${voteChannel} kanalına göz at.` : ''}`,
  ].join('\n');
  // Sadece ilk üçler etiketlenir
  const users = [...new Set([...topgg.slice(0, 3), ...disboard.slice(0, 3)].map((r) => r.user_id))];
  return { content, allowedMentions: { users }, empty: !topgg.length && !disboard.length };
}

let busy = false;
let retryAt = 0;

/** Pazar 20.00 geldiyse haftalık sıralamayı duyurur. timers.js her 15 sn çağırır. */
export async function tickWeeklyVotes(client) {
  const now = Date.now();
  if (busy || now < retryAt) return;
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;
  const due = Number(getSetting(guild.id, 'votes_week_next_at') ?? 0);
  if (!due) return setSetting(guild.id, 'votes_week_next_at', nextSlot(now));
  if (now < due) return;

  busy = true;
  try {
    const board = weeklyBoard(guild, due - WEEK, due);
    const channel = findGuideChannel(guild, 'duyurular');
    if (!board.empty && channel?.isTextBased()) await channel.send({ content: board.content, allowedMentions: board.allowedMentions });
    q.prune.run(now - 8 * WEEK);
    setSetting(guild.id, 'votes_week_next_at', nextSlot(now));
  } catch (error) {
    retryAt = now + 3_600_000;
    console.error('[Haftalık oy sıralaması]', error.message);
  } finally {
    busy = false;
  }
}
