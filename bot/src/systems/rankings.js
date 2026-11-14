// Tüm sıralamalar tek embed'de: seviye, coin, mesaj, ses, davet.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { e } from '../utils/emojis.js';
import { kariaEmbed } from '../utils/embeds.js';
import { leaderboard, formatVoice, periodName } from './stats.js';
import { levelBoard } from './levels.js';
import { richBoard, currency } from './economy.js';
import { inviteLeaderboard } from './invites.js';

const LISTED = 15;
const medal = (i) => [e('kupa', '🥇'), e('madalya', '🥈'), e('rozet', '🥉')][i] ?? `\`${String(i + 1).padStart(2)}.\``;
const number = (n) => n.toLocaleString('tr-TR');

const TYPES = {
  seviye: {
    label: 'Seviye', icon: () => e('yildiz', '⭐'),
    rows: (guild) => levelBoard(guild.id, LISTED).map((r) => ({ userId: r.userId, text: `Seviye ${r.level} • ${number(r.xp)} XP` })),
  },
  para: {
    label: 'Coin', icon: () => currency(),
    rows: (guild) => richBoard(guild.id, LISTED).map((r) => ({ userId: r.userId, text: `${number(r.value)} ${currency()}` })),
  },
  mesaj: {
    label: 'Mesaj', icon: () => e('mesaj', '💬'), period: true,
    rows: (guild, days) => leaderboard(guild.id, 'mesaj', days, LISTED).map((r) => ({ userId: r.userId, text: `${number(r.value)} mesaj` })),
  },
  ses: {
    label: 'Ses', icon: () => e('mikrofon', '🎙️'), period: true,
    rows: (guild, days) => leaderboard(guild.id, 'ses', days, LISTED).map((r) => ({ userId: r.userId, text: formatVoice(r.value) })),
  },
  davet: {
    label: 'Davet', icon: () => e('zarf', '✉️'),
    rows: (guild) => inviteLeaderboard(guild.id).slice(0, LISTED).map((r) => ({ userId: r.inviterId, text: `${number(r.uses)} davet` })),
  },
};

export function rankingView(guild, ownerId, type, days) {
  const info = TYPES[type] ?? TYPES.seviye;
  const lines = info.rows(guild, days).map((r, i) => `${medal(i)} <@${r.userId}> • **${r.text}**${r.userId === ownerId ? ' ← sen' : ''}`);
  const embed = kariaEmbed(null, 'Sıralama', { icon: guild.iconURL() ?? undefined })
    .setTitle(`${info.icon()} ${info.label} Sıralaması`)
    .setThumbnail(guild.iconURL({ size: 256 }))
    .setDescription(`${info.period ? `${e('takvim', '📅')} **${periodName(days)}**\n\n` : ''}${lines.join('\n') || 'Henüz veri yok.'}`);
  const row = new ActionRowBuilder().addComponents(
    Object.entries(TYPES).map(([key, t]) =>
      new ButtonBuilder()
        .setCustomId(`siralama:${ownerId}:${key}:${days}`)
        .setLabel(t.label)
        .setEmoji(t.icon())
        .setStyle(t === info ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}
