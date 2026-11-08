// Aktivite istatistikleri: mesaj sayıları, ses süreleri, giriş/çıkışlar.
// Mesaj İÇERİĞİ kaydedilmez; sadece kim, hangi kanalda, hangi gün/saatte kaç mesaj attı.

import { db } from '../core/database.js';
import { getSetting, setSetting } from '../core/settings.js';
import { handleVoiceXp } from './levels.js';

const TR_OFFSET = 3 * 3_600_000; // Türkiye UTC+3 (yaz saati yok)
export const dayKey = (ms = Date.now()) => new Date(ms + TR_OFFSET).toISOString().slice(0, 10);
export const hourOf = (ms = Date.now()) => new Date(ms + TR_OFFSET).getUTCHours();
const DAY = 86_400_000;

/** gün sayısı → başlangıç günü (0 = tüm zamanlar) */
export const sinceDay = (days) => (days > 0 ? dayKey(Date.now() - (days - 1) * DAY) : '0000-00-00');

// ───────────────────────── Kayıt ─────────────────────────

const msgUpsert = db.prepare(`
  INSERT INTO msg_stats (guild_id, user_id, channel_id, day, count) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id, channel_id, day) DO UPDATE SET count = count + excluded.count`);
const hourUpsert = db.prepare(`
  INSERT INTO hour_stats (guild_id, day, hour, count) VALUES (?, ?, ?, ?)
  ON CONFLICT(guild_id, day, hour) DO UPDATE SET count = count + excluded.count`);
const voiceUpsert = db.prepare(`
  INSERT INTO voice_stats (guild_id, user_id, channel_id, day, seconds) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id, channel_id, day) DO UPDATE SET seconds = seconds + excluded.seconds`);
const eventInsert = db.prepare('INSERT INTO member_events (guild_id, user_id, type, at) VALUES (?, ?, ?, ?)');

export function addMessages(guildId, userId, channelId, ms, count = 1) {
  msgUpsert.run(guildId, userId, channelId, dayKey(ms), count);
  hourUpsert.run(guildId, dayKey(ms), hourOf(ms), count);
}

export function recordMessage(message) {
  // Başlık (thread) mesajları ana kanala yazılır
  const channelId = message.channel.isThread() ? message.channel.parentId : message.channelId;
  addMessages(message.guild.id, message.author.id, channelId, message.createdTimestamp);
}

export const recordMemberEvent = (guildId, userId, type, at = Date.now()) => eventInsert.run(guildId, userId, type, at);

/** Canlı kaydın başladığı an (geçmiş taraması bundan eski mesajları sayar) */
export function markTrackingStart(guildId) {
  if (!getSetting(guildId, 'stats_started_at')) setSetting(guildId, 'stats_started_at', Date.now());
}

// ── Ses: sağırlaştırılmış (deafen) ve AFK kanalındakiler sayılmaz ──

const sessions = new Map(); // "guild:user" -> { channelId, start }

const isCounted = (state) =>
  Boolean(state.channelId) &&
  !state.member?.user.bot &&
  !state.selfDeaf &&
  !state.serverDeaf &&
  state.channelId !== state.guild.afkChannelId;

function flush(key, now = Date.now()) {
  const s = sessions.get(key);
  if (!s) return;
  const seconds = Math.floor((now - s.start) / 1000);
  if (seconds > 0) {
    const [guildId, userId] = key.split(':');
    voiceUpsert.run(guildId, userId, s.channelId, dayKey(now), seconds);
    handleVoiceXp(guildId, userId, s.channelId, seconds);
  }
  s.start = now;
}

export function handleVoiceStats(oldState, newState) {
  const key = `${newState.guild.id}:${newState.id}`;
  if (sessions.has(key)) {
    flush(key);
    sessions.delete(key);
  }
  if (isCounted(newState)) sessions.set(key, { channelId: newState.channelId, start: Date.now() });
}

/** Bot açıldığında seste olanları saymaya başla */
export function initVoiceSessions(guild) {
  for (const state of guild.voiceStates.cache.values()) {
    if (isCounted(state)) sessions.set(`${guild.id}:${state.id}`, { channelId: state.channelId, start: Date.now() });
  }
}

export function flushAllVoice() {
  const now = Date.now();
  for (const key of sessions.keys()) flush(key, now);
}

setInterval(flushAllVoice, 5 * 60_000).unref();
process.on('exit', flushAllVoice);

// ───────────────────────── Sorgular ─────────────────────────

const q = {
  userMsgs: db.prepare('SELECT COALESCE(SUM(count),0) n, COUNT(DISTINCT day) days FROM msg_stats WHERE guild_id=? AND user_id=? AND day>=?'),
  userVoice: db.prepare('SELECT COALESCE(SUM(seconds),0) s FROM voice_stats WHERE guild_id=? AND user_id=? AND day>=?'),
  userTopChannels: db.prepare('SELECT channel_id, SUM(count) n FROM msg_stats WHERE guild_id=? AND user_id=? AND day>=? GROUP BY channel_id ORDER BY n DESC LIMIT 5'),
  userTopVoice: db.prepare('SELECT channel_id, SUM(seconds) s FROM voice_stats WHERE guild_id=? AND user_id=? AND day>=? GROUP BY channel_id ORDER BY s DESC LIMIT 3'),
  userDaily: db.prepare('SELECT day, SUM(count) n FROM msg_stats WHERE guild_id=? AND user_id=? AND day>=? GROUP BY day'),
  msgBoard: db.prepare('SELECT user_id, SUM(count) v FROM msg_stats WHERE guild_id=? AND day>=? GROUP BY user_id ORDER BY v DESC'),
  voiceBoard: db.prepare('SELECT user_id, SUM(seconds) v FROM voice_stats WHERE guild_id=? AND day>=? GROUP BY user_id ORDER BY v DESC'),
  totalMsgs: db.prepare('SELECT COALESCE(SUM(count),0) n FROM msg_stats WHERE guild_id=? AND day>=? AND day<=?'),
  totalVoice: db.prepare('SELECT COALESCE(SUM(seconds),0) s FROM voice_stats WHERE guild_id=? AND day>=?'),
  activeUsers: db.prepare(`SELECT COUNT(*) n FROM (
    SELECT user_id FROM msg_stats WHERE guild_id=? AND day>=? UNION SELECT user_id FROM voice_stats WHERE guild_id=? AND day>=?)`),
  topChannels: db.prepare('SELECT channel_id, SUM(count) n FROM msg_stats WHERE guild_id=? AND day>=? GROUP BY channel_id ORDER BY n DESC LIMIT 8'),
  topVoiceChannels: db.prepare('SELECT channel_id, SUM(seconds) s FROM voice_stats WHERE guild_id=? AND day>=? GROUP BY channel_id ORDER BY s DESC LIMIT 5'),
  hours: db.prepare('SELECT hour, SUM(count) n FROM hour_stats WHERE guild_id=? AND day>=? GROUP BY hour'),
  daily: db.prepare('SELECT day, SUM(count) n FROM msg_stats WHERE guild_id=? AND day>=? GROUP BY day'),
  events: db.prepare('SELECT type, COUNT(*) n FROM member_events WHERE guild_id=? AND at>=? GROUP BY type'),
  firstDay: db.prepare('SELECT MIN(day) d FROM msg_stats WHERE guild_id=?'),
};

/** Son `days` günün günlük değerleri (eksik günler 0) */
function fillDays(rows, days, valueKey = 'n') {
  const map = new Map(rows.map((r) => [r.day, Number(r[valueKey])]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dayKey(Date.now() - i * DAY);
    out.push({ day: d, value: map.get(d) ?? 0 });
  }
  return out;
}

export function userStats(guildId, userId, days) {
  const since = sinceDay(days);
  const msgs = q.userMsgs.get(guildId, userId, since);
  const voice = Number(q.userVoice.get(guildId, userId, since).s);
  const msgBoard = q.msgBoard.all(guildId, since);
  const voiceBoard = q.voiceBoard.all(guildId, since);
  const rank = (board) => {
    const i = board.findIndex((r) => r.user_id === userId);
    return i === -1 ? null : { rank: i + 1, of: board.length };
  };
  return {
    messages: Number(msgs.n),
    activeDays: Number(msgs.days),
    voiceSeconds: voice,
    messageRank: rank(msgBoard),
    voiceRank: rank(voiceBoard),
    topChannels: q.userTopChannels.all(guildId, userId, since).map((r) => ({ channelId: r.channel_id, messages: Number(r.n) })),
    topVoiceChannels: q.userTopVoice.all(guildId, userId, since).map((r) => ({ channelId: r.channel_id, seconds: Number(r.s) })),
    daily: fillDays(q.userDaily.all(guildId, userId, sinceDay(14)), 14),
  };
}

export function leaderboard(guildId, type, days, limit = 10) {
  const rows = (type === 'ses' ? q.voiceBoard : q.msgBoard).all(guildId, sinceDay(days));
  return rows.slice(0, limit).map((r) => ({ userId: r.user_id, value: Number(r.v) }));
}

export function serverStats(guildId, days) {
  const since = sinceDay(days);
  const period = days > 0 ? days : 30; // "tüm zamanlar" için grafikte son 30 gün
  const messages = Number(q.totalMsgs.get(guildId, since, '9999-99-99').n);

  // Önceki dönemle karşılaştırma
  let previous = null;
  if (days > 0) {
    const prevSince = dayKey(Date.now() - (2 * days - 1) * DAY);
    const prevUntil = dayKey(Date.now() - days * DAY);
    previous = Number(q.totalMsgs.get(guildId, prevSince, prevUntil).n);
  }

  const hours = Array(24).fill(0);
  for (const r of q.hours.all(guildId, since)) hours[r.hour] = Number(r.n);

  const sinceMs = days > 0 ? Date.now() - days * DAY : 0;
  const events = Object.fromEntries(q.events.all(guildId, sinceMs).map((r) => [r.type, Number(r.n)]));

  return {
    days,
    messages,
    previousMessages: previous,
    voiceSeconds: Number(q.totalVoice.get(guildId, since).s),
    activeUsers: Number(q.activeUsers.get(guildId, since, guildId, since).n),
    topUsers: leaderboard(guildId, 'mesaj', days, 5),
    topVoiceUsers: leaderboard(guildId, 'ses', days, 5),
    topChannels: q.topChannels.all(guildId, since).map((r) => ({ channelId: r.channel_id, messages: Number(r.n) })),
    topVoiceChannels: q.topVoiceChannels.all(guildId, since).map((r) => ({ channelId: r.channel_id, seconds: Number(r.s) })),
    hours,
    daily: fillDays(q.daily.all(guildId, sinceDay(period)), Math.min(period, 30)),
    joins: events.join ?? 0,
    leaves: events.leave ?? 0,
    dataSince: q.firstDay.get(guildId).d,
  };
}

// ───────────────────────── Metin grafikleri ─────────────────────────

const SPARK = '▁▂▃▄▅▆▇█';
export function sparkline(values) {
  const max = Math.max(...values, 1);
  return values.map((v) => (v === 0 ? '▁' : SPARK[Math.min(7, Math.ceil((v / max) * 7))])).join('');
}

export function bar(value, max, width = 12) {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function formatVoice(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h} sa ${m} dk` : `${m} dk`;
}

export const PERIOD_CHOICES = [
  { name: 'Bugün', value: 1 },
  { name: 'Son 7 gün', value: 7 },
  { name: 'Son 30 gün', value: 30 },
  { name: 'Tüm zamanlar', value: 0 },
];
export const periodName = (days) => PERIOD_CHOICES.find((c) => c.value === days)?.name ?? `Son ${days} gün`;
