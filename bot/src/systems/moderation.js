import { EmbedBuilder } from 'discord.js';
import { db } from '../core/database.js';
import { getSetting } from '../core/settings.js';
import { getLevel } from '../utils/permissions.js';
import { sendLog } from '../utils/logger.js';
import { formatDuration } from '../utils/time.js';
import { UserError } from '../utils/errors.js';
import { e } from '../utils/emojis.js';

export const CASE_TYPES = {
  warn: { label: 'Uyarı', get emoji() { return e('unlem', '⚠️'); }, color: 0xf1c40f, verb: 'uyarı aldın' },
  mute: { label: 'Susturma', get emoji() { return e('ses_kapali', '🔇'); }, color: 0xe67e22, verb: 'susturuldun' },
  unmute: { label: 'Susturma Kaldırıldı', get emoji() { return e('kulaklik', '🔊'); }, color: 0x2ecc71 },
  kick: { label: 'Atma', get emoji() { return e('ok', '👢'); }, color: 0xe74c3c, verb: 'atıldın' },
  ban: { label: 'Yasaklama', get emoji() { return e('tokmak', '🔨'); }, color: 0x992d22, verb: 'yasaklandın' },
  unban: { label: 'Yasak Kaldırıldı', get emoji() { return e('kilit_acik', '🔓'); }, color: 0x2ecc71 },
  jail: { label: 'Jail', get emoji() { return e('kilit', '⛓️'); }, color: 0x7f8c8d, verb: "jail'e atıldın" },
  unjail: { label: 'Jail Kaldırıldı', get emoji() { return e('kilit_acik', '🔓'); }, color: 0x2ecc71 },
};

export const DEFAULT_REASON = 'Sebep belirtilmedi';

/** Hedefe işlem yapılabilir mi? Yapılamıyorsa sebebi döner. */
export function checkTarget(moderator, target, action) {
  const { guild } = target;
  if (target.id === moderator.id) return 'Kendine işlem uygulayamazsın.';
  if (target.id === guild.client.user.id) return 'Bana işlem uygulayamazsın.';
  if (target.id === guild.ownerId) return 'Sunucu sahibine işlem uygulanamaz.';
  if (moderator.id !== guild.ownerId) {
    if (target.roles.highest.position >= moderator.roles.highest.position)
      return 'Bu kişinin rolü seninkiyle aynı ya da daha yüksek.';
    if (getLevel(target) >= getLevel(moderator)) return 'Seninle aynı ya da daha yüksek yetkideki birine işlem uygulayamazsın.';
  }
  const allowed = { ban: target.bannable, kick: target.kickable, mute: target.moderatable }[action] ?? target.manageable;
  if (!allowed) return 'Buna yetkim yetmiyor. Rol listesinde bot rolünü bu kişinin rollerinin üstüne taşı.';
  return null;
}

const insertCase = db.prepare(
  'INSERT INTO cases (guild_id, user_id, mod_id, type, reason, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
);

export function caseEmbed(c) {
  const type = CASE_TYPES[c.type];
  const embed = new EmbedBuilder()
    .setColor(type.color)
    .setTitle(`${type.emoji} Vaka #${c.id} • ${type.label}`)
    .addFields(
      { name: 'Kullanıcı', value: `<@${c.userId}>\n\`${c.userId}\``, inline: true },
      { name: 'Yetkili', value: `<@${c.modId}>`, inline: true },
    );
  if (c.duration) embed.addFields({ name: 'Süre', value: formatDuration(c.duration), inline: true });
  return embed.addFields({ name: 'Sebep', value: c.reason.slice(0, 1024) }).setTimestamp(c.createdAt);
}

/** Vakayı veritabanına yazar ve ceza log kanalına gönderir. */
export async function recordCase(guild, { userId, modId, type, reason, duration = null }) {
  const createdAt = Date.now();
  const result = insertCase.run(guild.id, userId, modId, type, reason, duration, createdAt);
  const c = { id: Number(result.lastInsertRowid), guildId: guild.id, userId, modId, type, reason, duration, createdAt };
  const key = type === 'ban' || type === 'unban' ? 'log_ban' : 'log_mod';
  await sendLog(guild, key, { embeds: [caseEmbed(c)] });
  return c;
}

/** Cezayı kullanıcıya DM ile bildirir (DM kapalıysa sessizce geçer). */
export async function notifyUser(user, guild, { type, reason, duration }) {
  const t = CASE_TYPES[type];
  if (!t.verb) return;
  const embed = new EmbedBuilder()
    .setColor(t.color)
    .setTitle(`${t.emoji} ${guild.name} sunucusunda ${t.verb}`)
    .addFields({ name: 'Sebep', value: reason.slice(0, 1024) });
  if (duration) embed.addFields({ name: 'Süre', value: formatDuration(duration) });
  await user.send({ embeds: [embed] }).catch(() => {});
}

// ───────────────────────── Uyarılar ─────────────────────────

const activeWarnsStmt = db.prepare(
  "SELECT COUNT(*) AS n FROM cases WHERE guild_id = ? AND user_id = ? AND type = 'warn' AND active = 1",
);
export const countActiveWarns = (guildId, userId) => Number(activeWarnsStmt.get(guildId, userId).n);

const userCasesStmt = db.prepare('SELECT * FROM cases WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?');
export const getUserCases = (guildId, userId, limit = 10) => userCasesStmt.all(guildId, userId, limit);

const caseByIdStmt = db.prepare('SELECT * FROM cases WHERE id = ? AND guild_id = ?');
export const getCase = (guildId, id) => caseByIdStmt.get(id, guildId);

const deactivateStmt = db.prepare('UPDATE cases SET active = 0 WHERE id = ?');
export const deactivateCase = (id) => deactivateStmt.run(id);

// ───────────────────────── Jail ─────────────────────────

const jailGet = db.prepare('SELECT * FROM jails WHERE guild_id = ? AND user_id = ?');
const jailInsert = db.prepare('INSERT INTO jails (guild_id, user_id, roles, until) VALUES (?, ?, ?, ?)');
const jailDelete = db.prepare('DELETE FROM jails WHERE guild_id = ? AND user_id = ?');
const jailDue = db.prepare('SELECT * FROM jails WHERE until IS NOT NULL AND until <= ?');

export const isJailed = (guildId, userId) => Boolean(jailGet.get(guildId, userId));

function getJailRole(guild) {
  const id = getSetting(guild.id, 'jail_role');
  const role = id && guild.roles.cache.get(id);
  if (!role) throw new UserError('Jail rolü ayarlı değil. Önce `/kurulum jail` komutunu çalıştır.');
  if (!role.editable) throw new UserError('Jail rolü benim rolümden yüksekte. Bot rolünü rol listesinde yukarı taşı.');
  return role;
}

/** Üyenin rollerini kaydeder, sadece jail rolünü bırakır. */
export async function jailMember(member, { modId, reason, duration = null }) {
  const { guild } = member;
  const jailRole = getJailRole(guild);
  if (isJailed(guild.id, member.id)) throw new UserError("Bu kişi zaten jail'de.");

  const removable = member.roles.cache.filter((r) => r.id !== guild.id && r.id !== jailRole.id && !r.managed && r.editable);
  const kept = member.roles.cache.filter((r) => r.id !== guild.id && r.id !== jailRole.id && !removable.has(r.id));

  jailInsert.run(guild.id, member.id, JSON.stringify([...removable.keys()]), duration ? Date.now() + duration : null);
  try {
    await member.roles.set([...kept.keys(), jailRole.id], `Jail: ${reason}`);
  } catch (error) {
    jailDelete.run(guild.id, member.id);
    throw error;
  }
  await member.voice?.disconnect('Jail').catch(() => {});
  return recordCase(guild, { userId: member.id, modId, type: 'jail', reason, duration });
}

/** Jail'i kaldırır ve eski rolleri geri verir. Üye sunucuda değilse sadece kaydı siler. */
export async function unjailMember(guild, userId, { modId, reason }) {
  const row = jailGet.get(guild.id, userId);
  if (!row) throw new UserError("Bu kişi jail'de değil.");
  jailDelete.run(guild.id, userId);

  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) {
    const jailRoleId = getSetting(guild.id, 'jail_role');
    const restore = JSON.parse(row.roles).filter((id) => guild.roles.cache.get(id)?.editable);
    const current = member.roles.cache.filter((r) => r.id !== guild.id && r.id !== jailRoleId).map((r) => r.id);
    await member.roles.set([...new Set([...current, ...restore])], `Unjail: ${reason}`);
  }
  return recordCase(guild, { userId, modId, type: 'unjail', reason });
}

/** Süresi dolan jail'leri 30 saniyede bir kontrol eder. */
export function startJailTimer(client) {
  setInterval(async () => {
    for (const row of jailDue.all(Date.now())) {
      const guild = client.guilds.cache.get(row.guild_id);
      if (!guild) continue;
      await unjailMember(guild, row.user_id, { modId: client.user.id, reason: 'Jail süresi doldu' }).catch((e) =>
        console.error('[Jail zamanlayıcı]', e.message),
      );
    }
  }, 30_000);
}
