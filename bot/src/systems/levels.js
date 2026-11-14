// Seviye (rank) sistemi: mesaj ve ses aktivitesiyle XP kazanılır, seviye atlayınca ödül rolleri verilir.
import { EmbedBuilder } from 'discord.js';
import { e } from '../utils/emojis.js';
import { db } from '../core/database.js';
import { getSetting, setSetting } from '../core/settings.js';
import { sendLog } from '../utils/logger.js';
import { brandEmbed } from '../utils/embeds.js';
import { grantLevelCoins } from './coinRewards.js';

export const MSG_XP = [10, 20]; // mesaj başına rastgele XP aralığı
export const MSG_COOLDOWN = 60_000; // aynı kişi dakikada bir XP alır (spam'le kasılmasın)
export const VOICE_XP_PER_MIN = 3; // seste dakika başına (en az 2 kişi varken)
export const VOICE_DAILY_CAP = 600; // seste günde en çok bu kadar XP: seste bekleyerek kasılmasın

// Seviye yükseldikçe sonraki seviye pahalılaşır. Düzenli aktif bir üye günde ortalama 600 XP kazanır:
// Köylü (5) ~1 ay, Zanaatkâr (10) ~2 ay, Tüccar (25) ~6 ay, Soylu (50) ~15 ay, Lord (75) ~2,3 yıl, İmparator (100) ~3,6 yıl.
const BASE_XP = 3000;
const XP_STEP = 100;

export const RANKS = [
  { level: 5, name: 'Köylü', key: 'rutbe_koylu', icon: '🌾' },
  { level: 10, name: 'Zanaatkâr', key: 'rutbe_zanaatkar', icon: '🔨' },
  { level: 25, name: 'Tüccar', key: 'rutbe_tuccar', icon: '⚖️' },
  { level: 50, name: 'Soylu', key: 'rutbe_soylu', icon: '🛡️' },
  { level: 75, name: 'Lord', key: 'rutbe_lord', icon: '🏰' },
  { level: 100, name: 'İmparator', key: 'rutbe_imparator', icon: '👑' },
];
export const rankEmoji = (level) => {
  const rank = RANKS.find((r) => r.level === level);
  return rank ? e(rank.key, rank.icon) : e('hediye', '🎁');
};

/** L. seviyeden L+1'e geçmek için gereken XP */
export const xpToNext = (level) => BASE_XP + XP_STEP * level;

/** Bir seviyeye ulaşmak için gereken toplam XP */
export const totalXpFor = (level) => BASE_XP * level + (XP_STEP / 2) * level * (level - 1);

/** Toplam XP'den seviye ve seviye içi ilerleme */
export function levelFromXp(xp) {
  const b = BASE_XP - XP_STEP / 2;
  let level = Math.max(0, Math.floor((-b + Math.sqrt(b * b + 2 * XP_STEP * xp)) / XP_STEP));
  while (totalXpFor(level + 1) <= xp) level++;
  while (level > 0 && totalXpFor(level) > xp) level--;
  return { level, current: xp - totalXpFor(level), needed: xpToNext(level) };
}

const q = {
  get: db.prepare('SELECT * FROM levels WHERE guild_id=? AND user_id=?'),
  upsert: db.prepare(`INSERT INTO levels (guild_id, user_id, xp, level, last_msg_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET xp=excluded.xp, level=excluded.level, last_msg_at=excluded.last_msg_at`),
  board: db.prepare('SELECT user_id, xp, level FROM levels WHERE guild_id=? AND xp>0 ORDER BY xp DESC LIMIT ?'),
  rank: db.prepare('SELECT COUNT(*) n FROM levels WHERE guild_id=? AND xp>?'),
  count: db.prepare('SELECT COUNT(*) n FROM levels WHERE guild_id=?'),
  reset: db.prepare('DELETE FROM levels WHERE guild_id=? AND user_id=?'),
  rewards: db.prepare('SELECT level, role_id FROM level_rewards WHERE guild_id=? ORDER BY level'),
  addReward: db.prepare(`INSERT INTO level_rewards (guild_id, level, role_id) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, role_id) DO UPDATE SET level=excluded.level`),
  delReward: db.prepare('DELETE FROM level_rewards WHERE guild_id=? AND role_id=?'),
  usersAtLeast: db.prepare('SELECT user_id FROM levels WHERE guild_id=? AND level>=?'),
};

export function getProfile(guildId, userId) {
  const row = q.get.get(guildId, userId);
  const xp = Number(row?.xp ?? 0);
  const rank = xp > 0 ? Number(q.rank.get(guildId, xp).n) + 1 : null;
  return { xp, ...levelFromXp(xp), rank, lastMsgAt: Number(row?.last_msg_at ?? 0) };
}

export const levelBoard = (guildId, limit = 15) =>
  q.board.all(guildId, limit).map((r) => ({ userId: r.user_id, xp: Number(r.xp), level: Number(r.level) }));

export const getRewards = (guildId) => q.rewards.all(guildId).map((r) => ({ level: Number(r.level), roleId: r.role_id }));
export const addReward = (guildId, level, roleId) => q.addReward.run(guildId, level, roleId);
export const removeReward = (guildId, roleId) => Number(q.delReward.run(guildId, roleId).changes);
export const usersAtLeast = (guildId, level) => q.usersAtLeast.all(guildId, level).map((r) => r.user_id);

/**
 * XP ekler/çıkarır. Seviye değiştiyse ödül rolleri ve duyurular yapılır.
 * source: 'mesaj' | 'ses' | 'yetkili'
 */
export async function addXp(guild, userId, amount, { source, channel = null, byId = null, touchCooldown = false } = {}) {
  const row = q.get.get(guild.id, userId);
  const oldXp = Number(row?.xp ?? 0);
  const oldLevel = Number(row?.level ?? 0);
  const xp = Math.max(0, oldXp + amount);
  const { level } = levelFromXp(xp);
  q.upsert.run(guild.id, userId, xp, level, touchCooldown ? Date.now() : Number(row?.last_msg_at ?? 0));

  if (source === 'yetkili') {
    await sendLog(guild, 'log_level', {
      embeds: [
        new EmbedBuilder()
          .setColor(amount >= 0 ? 0x2ecc71 : 0xe74c3c)
          .setTitle(`${e('araclar', '🛠️')} XP elle değiştirildi`)
          .setDescription(
            `**Üye:** <@${userId}>\n**Değişim:** ${amount >= 0 ? '+' : ''}${amount} XP (${oldXp} → ${xp})\n` +
              `**Seviye:** ${oldLevel} → ${level}\n**Yapan:** <@${byId}>`,
          )
          .setTimestamp(),
      ],
    });
  }
  if (level !== oldLevel) await onLevelChange(guild, userId, oldLevel, level, { source, channel, xp });
  return { oldLevel, level, xp };
}

// Üyede aynı anda yalnızca ulaştığı en yüksek seviye ödül rolü durur: yenisi verilince eskileri alınır.
async function syncRewardRoles(member, level) {
  const rewards = getRewards(member.guild.id);
  const current = rewards.filter((r) => r.level <= level).at(-1); // getRewards seviyeye göre sıralı
  const given = [];
  const removed = [];
  for (const reward of rewards) {
    const role = member.guild.roles.cache.get(reward.roleId);
    if (!role?.editable) continue;
    const has = member.roles.cache.has(reward.roleId);
    if (reward === current) {
      if (has) continue;
      const ok = await member.roles.add(role, `Seviye ödülü (seviye ${reward.level})`).then(() => true).catch(() => false);
      if (ok) given.push(role);
    } else if (has) {
      const ok = await member.roles.remove(role, `Daha yüksek seviye rolü alındı (seviye ${level})`).then(() => true).catch(() => false);
      if (ok) removed.push(role);
    }
  }
  return { given, removed };
}

async function onLevelChange(guild, userId, oldLevel, level, { source, channel, xp }) {
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
  if (!member) return;
  const up = level > oldLevel;
  const { given, removed } = await syncRewardRoles(member, level);
  // Yetkilinin elle verdiği XP coin kazandırmaz
  const coins = up && source !== 'yetkili' ? grantLevelCoins(guild.id, userId, oldLevel, level) : 0;

  await sendLog(guild, 'log_level', {
    embeds: [
      new EmbedBuilder()
        .setColor(up ? 0xf1c40f : 0x95a5a6)
        .setAuthor({ name: `${member.user.tag} ${up ? 'seviye atladı' : 'seviye düştü'}`, iconURL: member.user.displayAvatarURL() })
        .setDescription(
          `**Üye:** ${member}\n**Seviye:** ${oldLevel} → **${level}**\n**Toplam XP:** ${xp}\n**Kaynak:** ${source}` +
            (channel ? ` • ${channel}` : '') +
            (given.length ? `\n**Ödül rolü verildi:** ${given.join(' ')}` : '') +
            (removed.length ? `\n**Eski ödül rolü alındı:** ${removed.join(' ')}` : '') +
            (coins ? `\n**Coin ödülü:** +${coins.toLocaleString('tr-TR')}` : ''),
        )
        .setTimestamp(),
    ],
  });

  if (!up || source === 'yetkili' || !getSetting(guild.id, 'level_announce')) return;
  const target = guild.channels.cache.get(getSetting(guild.id, 'level_channel')) ?? (source === 'mesaj' ? channel : null);
  if (!target?.isTextBased()) return;
  const embed = brandEmbed()
    .setColor(0xf1c40f)
    .setDescription(`${e('konfeti', '🎉')} ${member} **${level}. seviyeye** ulaştı! ${e('yildiz', '⭐')}` + (given.length ? `\n${rankEmoji(RANKS.filter((r) => r.level <= level).at(-1)?.level)} Yeni rütbe: ${given.join(' ')}` : ''))
    .setThumbnail(member.user.displayAvatarURL({ size: 128 }));
  if (coins) embed.setDescription(`${embed.data.description}\n${e('coin', '🪙')} **+${coins.toLocaleString('tr-TR')}** coin kazandı!`);
  await target.send({ content: `${member}`, embeds: [embed], allowedMentions: { users: [member.id] } }).catch(() => {});
}

// ───────────────────────── Kazanım ─────────────────────────

/** Mesaj XP'si (dakikada bir) */
export async function handleMessageXp(message) {
  const { guild, author } = message;
  if (!getSetting(guild.id, 'level_enabled')) return;
  if ((message.content ?? '').replace(/\s/g, '').length < 2 && !message.attachments.size) return;
  const row = q.get.get(guild.id, author.id);
  if (row && Date.now() - Number(row.last_msg_at) < MSG_COOLDOWN) return;
  const amount = MSG_XP[0] + Math.floor(Math.random() * (MSG_XP[1] - MSG_XP[0] + 1));
  await addXp(guild, author.id, amount, { source: 'mesaj', channel: message.channel, touchCooldown: true });
}

let client = null;
export const setLevelClient = (c) => (client = c);
const voiceRemainder = new Map(); // "guild:user" -> artan saniye
const voiceToday = new Map(); // "guild:user" -> { day, xp } bugün sesten kazanılan

/** stats.js ses süresini kaydederken çağırır (saniye cinsinden) */
export function handleVoiceXp(guildId, userId, channelId, seconds) {
  const guild = client?.guilds.cache.get(guildId);
  if (!guild || !getSetting(guildId, 'level_enabled')) return;
  const channel = guild.channels.cache.get(channelId);
  // Tek başına seste beklemek XP kazandırmaz
  if (!channel || channel.members.filter((m) => !m.user.bot).size < 2) return;
  const key = `${guildId}:${userId}`;
  const total = (voiceRemainder.get(key) ?? 0) + seconds;
  const minutes = Math.floor(total / 60);
  voiceRemainder.set(key, total - minutes * 60);
  if (minutes <= 0) return;
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10); // Türkiye günü
  const used = voiceToday.get(key);
  const spent = used?.day === today ? used.xp : 0;
  const amount = Math.min(minutes * VOICE_XP_PER_MIN, VOICE_DAILY_CAP - spent);
  if (amount <= 0) return;
  voiceToday.set(key, { day: today, xp: spent + amount });
  addXp(guild, userId, amount, { source: 'ses', channel }).catch((e) => console.error('[Ses XP]', e.message));
}

// ───────────────────────── İlk kurulum ─────────────────────────

/** Sistem ilk açıldığında mevcut mesaj/ses istatistiklerinden başlangıç XP'si verir (duyuru yapmadan). */
export function seedFromStats(guildId) {
  if (getSetting(guildId, 'levels_seeded')) return 0;
  const rows = db
    .prepare(
      `SELECT user_id, SUM(m) m, SUM(v) v FROM (
         SELECT user_id, SUM(count) m, 0 v FROM msg_stats WHERE guild_id=? GROUP BY user_id
         UNION ALL SELECT user_id, 0 m, SUM(seconds) v FROM voice_stats WHERE guild_id=? GROUP BY user_id
       ) GROUP BY user_id`,
    )
    .all(guildId, guildId);
  let seeded = 0;
  for (const r of rows) {
    // Mesaj sayıları bekleme süresiz sayıldığı için mesaj başı 8 XP (canlıda ortalama 15)
    const xp = Math.round(Number(r.m) * 8 + (Number(r.v) / 60) * VOICE_XP_PER_MIN);
    if (xp <= 0 || q.get.get(guildId, r.user_id)) continue;
    q.upsert.run(guildId, r.user_id, xp, levelFromXp(xp).level, 0);
    seeded++;
  }
  setSetting(guildId, 'levels_seeded', Date.now());
  return seeded;
}

export function resetUser(guildId, userId) {
  q.reset.run(guildId, userId);
}

export function progressBar(current, needed, width = 14) {
  const filled = Math.round((current / needed) * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}
