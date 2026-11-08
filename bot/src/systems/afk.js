// AFK: üye yazınca AFK biter, AFK birini etiketleyene sebebi söylenir.
import { db } from '../core/database.js';
import { e } from '../utils/emojis.js';
import { relativeTime } from '../utils/time.js';

const q = {
  set: db.prepare('INSERT INTO afk (guild_id, user_id, reason, since) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET reason=excluded.reason, since=excluded.since'),
  get: db.prepare('SELECT * FROM afk WHERE guild_id=? AND user_id=?'),
  del: db.prepare('DELETE FROM afk WHERE guild_id=? AND user_id=?'),
};

const MAX_LISTED = 3;
const MENTION_COOLDOWN = 60_000;
const NOTICE_LIFETIME = 8_000;
const lastNotice = new Map();
const quiet = { parse: [], repliedUser: false };

export const setAfk = (guildId, userId, reason) => q.set.run(guildId, userId, reason, Date.now());

export async function handleAfk(message) {
  const guildId = message.guild.id;
  if (q.get.get(guildId, message.author.id)) {
    q.del.run(guildId, message.author.id);
    const notice = await message.reply({ content: `${e('mesaj', '👋')} Tekrar hoş geldin, AFK durumun kaldırıldı.`, allowedMentions: quiet }).catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), NOTICE_LIFETIME);
  }

  const now = Date.now();
  const lines = [];
  for (const user of message.mentions.users.values()) {
    if (lines.length === MAX_LISTED) break;
    if (user.bot || user.id === message.author.id) continue;
    const afk = q.get.get(guildId, user.id);
    const key = `${message.channelId}:${user.id}`;
    if (!afk || now - (lastNotice.get(key) ?? 0) < MENTION_COOLDOWN) continue;
    lastNotice.set(key, now);
    lines.push(`${e('uyku', '💤')} <@${user.id}> ${relativeTime(afk.since)} AFK oldu: ${afk.reason}`);
  }
  if (lastNotice.size > 5000) lastNotice.clear();
  if (lines.length) await message.reply({ content: lines.join('\n'), allowedMentions: quiet }).catch(() => {});
}
