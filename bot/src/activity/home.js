// Etkinliğin üye ana sayfası: herkes kendi verisini görür. Sıralamalar yalnızca herkese açık bilgileri içerir.
import { MessageType } from 'discord.js';
import { getSetting } from '../core/settings.js';
import { UserError } from '../utils/errors.js';
import { sendLog } from '../utils/logger.js';
import { getBalance, richBoard, claimDaily, nextDaily, ensureEnabled } from '../systems/economy.js';
import { getProfile, levelBoard } from '../systems/levels.js';
import { userStats, leaderboard, formatVoice } from '../systems/stats.js';
import { inviteLeaderboard } from '../systems/invites.js';
import { findGuideChannel } from '../systems/guide.js';
import { cleanText, runPanelCommand } from './admin.js';
import { submitReport } from '../commands/topluluk/rapor.js';

const ANNOUNCE_TTL = 60_000;
const announceCache = new Map();

async function announcements(guild) {
  const cached = announceCache.get(guild.id);
  if (cached && Date.now() - cached.at < ANNOUNCE_TTL) return cached.items;
  const channel = findGuideChannel(guild, 'duyurular');
  if (!channel?.isTextBased()) return [];
  const [pins, batch] = await Promise.all([channel.messages.fetchPins().catch(() => null), channel.messages.fetch({ limit: 12 }).catch(() => null)]);
  const pinned = (pins?.items ?? []).map((p) => p.message);
  const pinnedIds = new Set(pinned.map((m) => m.id));
  const recent = [...(batch?.values() ?? [])].filter((m) => !pinnedIds.has(m.id));
  const items = [...pinned, ...recent]
    .filter((m) => !m.system)
    .map((m) => ({
      id: m.id,
      pinned: pinnedIds.has(m.id),
      author: m.member?.displayName ?? m.author.username,
      at: m.createdTimestamp,
      text: cleanText(guild, m.content || [m.embeds[0]?.title && `### ${m.embeds[0].title}`, m.embeds[0]?.description].filter(Boolean).join('\n'), { markdown: true, keepEmoji: true }).slice(0, 2500),
    }))
    .filter((m) => m.text)
    .slice(0, 12);
  announceCache.set(guild.id, { at: Date.now(), items });
  return items;
}

/** Sabitleme Discord'un kendi sabitlemesidir: panelden ya da Discord'dan yapılan iki tarafta da görünür. */
export async function setAnnouncementPin(guild, member, id, pinned) {
  const channel = findGuideChannel(guild, 'duyurular');
  const message = channel?.isTextBased() ? await channel.messages.fetch(String(id)).catch(() => null) : null;
  if (!message) throw new UserError('Duyuru bulunamadı.');
  await (pinned ? message.pin() : message.unpin()).catch(() => { throw new UserError('Duyuru sabitlenemedi.'); });
  if (pinned) {
    // Discord'un "mesaj sabitlendi" satırı duyuru kanalını kirletmesin
    const latest = await channel.messages.fetch({ limit: 5, cache: false }).catch(() => null);
    await latest?.find((m) => m.type === MessageType.ChannelPinnedMessage && m.reference?.messageId === message.id)?.delete().catch(() => {});
  }
  announceCache.delete(guild.id);
  await sendLog(guild, 'log_staff', { content: `Yönetim Paneli • <@${member.id}> bir duyurunun sabitini ${pinned ? 'ekledi' : 'kaldırdı'}: ${message.url}` });
  return { announcements: await announcements(guild) };
}

export async function homeView(guild, member) {
  const id = member.id;
  const level = getProfile(guild.id, id);
  const week = userStats(guild.id, id, 7);
  const humans = guild.members.cache.filter((m) => !m.user.bot).size;
  return {
    balance: getBalance(guild.id, id),
    level: { level: level.level, current: level.current, needed: level.needed, rank: level.rank },
    week: { messages: week.messages, voice: formatVoice(week.voiceSeconds), messageRank: week.messageRank?.rank ?? null },
    dailyAt: nextDaily(guild.id, id),
    server: { name: guild.name, members: humans, boosts: guild.premiumSubscriptionCount ?? 0, inVoice: guild.members.cache.filter((m) => m.voice.channelId && !m.user.bot).size },
    announcements: await announcements(guild),
    members: guild.members.cache
      .filter((m) => !m.user.bot && m.id !== id)
      .map((m) => ({ id: m.id, name: m.displayName }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .slice(0, 400),
  };
}

const memberName = (guild, id) => guild.members.cache.get(id)?.displayName ?? 'ayrılmış üye';

export function leaderboardView(guild, memberId, type) {
  const LIMIT = 200; // seviyesi olan herkes listede görünür
  const rows = {
    seviye: () => levelBoard(guild.id, LIMIT).map((r) => ({ id: r.userId, value: `Seviye ${r.level}` })),
    para: () => richBoard(guild.id, LIMIT).map((r) => ({ id: r.userId, value: r.value.toLocaleString('tr-TR') })),
    mesaj: () => leaderboard(guild.id, 'mesaj', 30, LIMIT).map((r) => ({ id: r.userId, value: r.value.toLocaleString('tr-TR') })),
    ses: () => leaderboard(guild.id, 'ses', 30, LIMIT).map((r) => ({ id: r.userId, value: formatVoice(r.value) })),
    davet: () => inviteLeaderboard(guild.id).slice(0, LIMIT).map((r) => ({ id: r.inviterId, value: r.uses.toLocaleString('tr-TR') })),
  }[type];
  if (!rows) throw new UserError('Böyle bir sıralama yok.');
  return { type, rows: rows().map((r) => ({ id: r.id, name: memberName(guild, r.id), value: r.value, me: r.id === memberId })) };
}

export function claimDailyReward(guild, memberId) {
  ensureEnabled(guild.id);
  return claimDaily(guild.id, memberId);
}

/** /oneri komutunu aynen çalıştırır: bekleme süresi ve kurallar ortaktır */
export async function sendSuggestion(client, guild, member, text) {
  const channelId = getSetting(guild.id, 'suggestion_channel');
  if (!channelId) throw new UserError('Öneri kanalı henüz ayarlanmamış.');
  return runPanelCommand(client, guild, member, { name: 'oneri', channelId, values: { oneri: String(text ?? '').trim() } });
}

/** Etkinlikten üye bildirme: /rapor ile aynı kurallar (bekleme süresi, rapor kanalı, kayıt) */
export async function sendReport(guild, member, targetId, reason) {
  const target = guild.members.cache.get(String(targetId ?? ''))?.user;
  if (!target) throw new UserError('Bildirmek istediğin üyeyi seç.');
  const text = String(reason ?? '').trim();
  if (text.length < 5 || text.length > 500) throw new UserError('Sebep 5 ile 500 karakter arasında olmalı.');
  await submitReport({ guild, user: member.user, target, reason: text });
  return { ok: true };
}
