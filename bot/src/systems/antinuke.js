// Toplu saldırı koruması: ele geçirilmiş bir yetkili ya da bot kısa sürede çok sayıda yıkıcı işlem yaparsa durdurur.
// Rolleri alınan kişi ya da atılan bot geri eklenebilir; silinen kanal ve roller geri gelmez.
import { AuditLogEvent, EmbedBuilder } from 'discord.js';
import { getSetting } from '../core/settings.js';
import { e } from '../utils/emojis.js';
import { sendLog } from '../utils/logger.js';

const WINDOW = 60_000;
const COOLDOWN = 5 * 60_000;
const REASON = 'Karia toplu saldırı koruması';

const RULES = {
  [AuditLogEvent.ChannelDelete]: { limit: 3, label: 'kanal silme' },
  [AuditLogEvent.RoleDelete]: { limit: 3, label: 'rol silme' },
  [AuditLogEvent.MemberBanAdd]: { limit: 5, label: 'yasaklama' },
  [AuditLogEvent.MemberKick]: { limit: 5, label: 'sunucudan atma' },
};

const hits = new Map(); // "sunucu:yapan:işlem" -> [{ at, targetId }]
const handled = new Map(); // "sunucu:yapan" -> son müdahale zamanı

/** Yapanı durdurur; ne yapıldığını anlatan metni döner. */
async function stopExecutor(guild, executorId) {
  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return { result: 'Yapan sunucuda bulunamadı.', roles: [] };

  if (member.user.bot) {
    if (!member.kickable) return { result: 'Bot atılamadı: Karia rolü bu botun altında.', roles: [] };
    await member.kick(REASON);
    return { result: 'Bot sunucudan atıldı.', roles: [] };
  }
  if (!member.manageable) return { result: 'Roller alınamadı: Karia rolü bu kişinin altında.', roles: [] };
  const roles = member.roles.cache.filter((r) => r.id !== guild.id && !r.managed);
  await member.roles.set(member.roles.cache.filter((r) => r.managed), REASON);
  return { result: 'Kişinin tüm rolleri alındı.', roles: [...roles.keys()] };
}

async function respond(guild, executorId, rule, action, events) {
  const stopped = await stopExecutor(guild, executorId).catch((error) => ({ result: `Durdurulamadı: ${error.message}`, roles: [] }));

  let unbanned = 0;
  if (Number(action) === AuditLogEvent.MemberBanAdd) {
    for (const { targetId } of events) await guild.members.unban(targetId, REASON).then(() => unbanned++).catch(() => {});
  }

  const lines = [
    `**Yapan:** <@${executorId}> • \`${executorId}\``,
    `**Tespit:** ${Math.round(WINDOW / 1000)} saniyede ${events.length} ${rule.label}`,
    `**Sonuç:** ${stopped.result}`,
  ];
  if (unbanned) lines.push(`**Yasağı kaldırılan:** ${unbanned} kişi`);
  if (stopped.roles.length) lines.push(`**Alınan roller:** ${stopped.roles.map((id) => `<@&${id}>`).join(' ')}`);

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`${e('unlem', '🚨')} Toplu Saldırı Girişimi`)
    .setDescription(lines.join('\n'))
    .setTimestamp();
  await sendLog(guild, 'log_staff', { content: `<@${guild.ownerId}>`, embeds: [embed], allowedMentions: { users: [guild.ownerId] } });

  const owner = await guild.fetchOwner().catch(() => null);
  await owner?.send({ embeds: [embed] }).catch(() => {});
  return stopped;
}

/** Her denetim kaydı için çağrılır. Eşik aşıldıysa müdahale eder ve sonucu döner, yoksa null. */
export async function handleNukeEntry(entry, guild) {
  const rule = RULES[entry.action];
  if (!rule || !entry.executorId || !getSetting(guild.id, 'anti_nuke')) return null;
  if (entry.executorId === guild.client.user.id || entry.executorId === guild.ownerId) return null;

  const now = Date.now();
  const key = `${guild.id}:${entry.executorId}:${entry.action}`;
  const events = (hits.get(key) ?? []).filter((event) => now - event.at < WINDOW);
  events.push({ at: now, targetId: entry.targetId });
  hits.set(key, events);
  if (events.length < rule.limit) return null;

  hits.delete(key);
  const handledKey = `${guild.id}:${entry.executorId}`;
  if (now - (handled.get(handledKey) ?? 0) < COOLDOWN) return null;
  handled.set(handledKey, now);
  return respond(guild, entry.executorId, rule, entry.action, events);
}
