// Bot kurulmadan önceki mesajları bir kez tarayıp istatistiklere ekler.
// Sadece canlı kaydın başladığı andan (stats_started_at) ÖNCEKİ mesajlar sayılır → çift sayım olmaz.

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { db } from '../core/database.js';
import { getSetting, setSetting } from '../core/settings.js';
import { UserError } from '../utils/errors.js';
import { addMessages, recordMemberEvent } from './stats.js';

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

async function scanChannel(channel, { from, until }, counts) {
  let before;
  let scanned = 0;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    for (const m of batch.values()) {
      if (m.createdTimestamp < from) return scanned;
      if (m.createdTimestamp >= until || m.author.bot || m.system) continue;
      const channelId = channel.isThread() ? channel.parentId : channel.id;
      const key = `${m.author.id}|${channelId}|${m.createdTimestamp}`;
      counts.push(key);
      scanned++;
    }
    before = batch.last().id;
  }
  return scanned;
}

export async function backfill(guild, days, onProgress = async () => {}) {
  if (getSetting(guild.id, 'stats_backfilled')) throw new UserError('Geçmiş tarama bu sunucuda zaten yapıldı (çift sayımı önlemek için tek seferlik).');
  const until = Number(getSetting(guild.id, 'stats_started_at')) || Date.now();
  const from = Date.now() - days * 86_400_000;
  const me = guild.members.me;

  const canRead = (c) => c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]);
  const channels = [...guild.channels.cache.filter((c) => TEXT_TYPES.includes(c.type) && canRead(c)).values()];
  const threads = await guild.channels.fetchActiveThreads().then((r) => [...r.threads.values()]).catch(() => []);
  const targets = [...channels, ...threads.filter((t) => canRead(t))];

  const entries = [];
  let done = 0;
  for (const channel of targets) {
    await scanChannel(channel, { from, until }, entries);
    done++;
    if (done % 3 === 0 || done === targets.length) await onProgress(done, targets.length, entries.length);
  }

  // Tek işlemde yaz
  db.exec('BEGIN');
  try {
    for (const key of entries) {
      const [userId, channelId, ts] = key.split('|');
      addMessages(guild.id, userId, channelId, Number(ts));
    }
    // Şu anki üyelerin katılım tarihleri → büyüme verisi
    let joins = 0;
    for (const m of guild.members.cache.values()) {
      if (!m.user.bot && m.joinedTimestamp && m.joinedTimestamp >= from && m.joinedTimestamp < until) {
        recordMemberEvent(guild.id, m.id, 'join', m.joinedTimestamp);
        joins++;
      }
    }
    setSetting(guild.id, 'stats_backfilled', days);
    db.exec('COMMIT');
    return { channels: targets.length, messages: entries.length, joins };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
