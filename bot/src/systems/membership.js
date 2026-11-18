// Üyelik kademeleri (VIP < VIP+ < KVIP < Prime): süreli rol, üyede aynı anda tek kademe olur.
// Süre dolunca timers.js rolü otomatik alır. Üyelikler karia.live üzerinden parayla satılır; coin vermez, coinle alınmaz.
// Prime rolü sabittir; diğerleri sunucuda adıyla bulunur, yoksa bot oluşturur ve ID'yi ayarlara kaydeder.
import { db } from '../core/database.js';
import { getSetting, setSetting } from '../core/settings.js';
import { sendLog } from '../utils/logger.js';
import { UserError } from '../utils/errors.js';
import { e } from '../utils/emojis.js';

export const PRIME_ROLE = '1569468546713526443';
export const TIER_DAYS = [7, 30, 90];
const DAY = 86_400_000;

/** Düşükten yükseğe. key Minecraft eklentisindeki grup adıyla aynıdır. id: Karia sunucusundaki sabit rol. */
export const TIERS = [
  { key: 'vip', name: 'VIP', id: '1571854952303951994', color: 0x57f287 },
  { key: 'vipplus', name: 'VIP+', id: '1571854951267827764', color: 0x3498db },
  { key: 'kvip', name: 'KVIP', id: '1571854953419378779', color: 0xf1c40f },
  { key: 'prime', name: 'Prime', id: PRIME_ROLE },
];
export const tierRank = (key) => TIERS.findIndex((t) => t.key === key);
const tierOf = (key) => TIERS.find((t) => t.key === key);

const q = {
  get: db.prepare('SELECT until FROM temp_roles WHERE guild_id=? AND user_id=? AND role_id=?'),
  set: db.prepare(`INSERT INTO temp_roles (guild_id, user_id, role_id, until, mod_id) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET until = excluded.until, mod_id = excluded.mod_id`),
  del: db.prepare('DELETE FROM temp_roles WHERE guild_id=? AND user_id=? AND role_id=?'),
};

const resolved = new Map(); // sunucu -> { kademe: rol ID }
const pending = new Map();

async function resolveRoles(guild) {
  const roles = {};
  for (const tier of TIERS) {
    if (tier.id) { roles[tier.key] = tier.id; continue; }
    const saved = getSetting(guild.id, `tier_role_${tier.key}`);
    let role = saved ? guild.roles.cache.get(saved) : null;
    // Türkçe küçültme "VIP"i "vıp" yapar; rol adları Latin harfli olduğu için düz küçültme
    role ??= guild.roles.cache.find((r) => r.name.trim().toLowerCase() === tier.name.toLowerCase());
    if (!role) {
      role = await guild.roles.create({ name: tier.name, colors: { primaryColor: tier.color }, permissions: [], reason: 'Karia üyelik kademesi' });
      // Prime'ın hemen altına: sırayla eklenince Prime > KVIP > VIP+ > VIP olur
      const prime = guild.roles.cache.get(PRIME_ROLE);
      if (prime) await role.setPosition(prime.position).catch(() => {});
    }
    setSetting(guild.id, `tier_role_${tier.key}`, role.id);
    roles[tier.key] = role.id;
  }
  return roles;
}

/** Kademe rollerini bulur ya da oluşturur. Bot açılırken bir kez çağrılır, sonra önbellekten gelir. */
export async function ensureTierRoles(guild) {
  const known = resolved.get(guild.id);
  if (known && Object.values(known).every((id) => guild.roles.cache.has(id))) return known;
  if (!pending.has(guild.id)) {
    pending.set(guild.id, resolveRoles(guild)
      .then((roles) => { resolved.set(guild.id, roles); return roles; })
      .finally(() => pending.delete(guild.id)));
  }
  return pending.get(guild.id);
}

/** Üyenin en yüksek kademesi ve bitişi (until null: süresiz). Roller henüz çözülmediyse null. */
export function memberTier(guild, member) {
  const roles = resolved.get(guild.id);
  if (!roles || !member) return null;
  const tier = [...TIERS].reverse().find((t) => member.roles.cache.has(roles[t.key]));
  if (!tier) return null;
  return { key: tier.key, name: tier.name, until: Number(q.get.get(guild.id, member.id, roles[tier.key])?.until ?? 0) || null };
}

/** Kademeyi verir; aynı kademede süre üstüne eklenir, diğer kademeler alınır. Bitiş zamanını döner. */
export async function grantTier(guild, member, key, days, modId) {
  const tier = tierOf(key);
  if (!tier) throw new UserError('Geçersiz kademe.');
  const roles = await ensureTierRoles(guild);
  const roleId = roles[key];
  for (const other of TIERS) {
    if (other.key === key) continue;
    q.del.run(guild.id, member.id, roles[other.key]);
    if (member.roles.cache.has(roles[other.key])) await member.roles.remove(roles[other.key], `${tier.name} üyeliğine geçti`);
  }
  const current = Number(q.get.get(guild.id, member.id, roleId)?.until ?? 0);
  const until = Math.max(current, Date.now()) + days * DAY;
  q.set.run(guild.id, member.id, roleId, until, modId);
  if (!member.roles.cache.has(roleId)) await member.roles.add(roleId, `${tier.name} üyelik`);
  return until;
}

export async function membershipView(guild) {
  const roles = await ensureTierRoles(guild);
  const humans = [...guild.members.cache.values()].filter((m) => !m.user.bot).sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr'));
  const rank = tierRank;
  const color = (t) => `#${(guild.roles.cache.get(roles[t.key])?.colors?.primaryColor || t.color || 0x9b59b6).toString(16).padStart(6, '0')}`;
  return {
    days: TIER_DAYS,
    tiers: TIERS.map((t) => ({ key: t.key, name: t.name, color: color(t) })),
    members: humans.map((m) => ({ id: m.id, name: m.displayName })),
    list: humans.map((m) => ({ id: m.id, name: m.displayName, tier: memberTier(guild, m) }))
      .filter((m) => m.tier)
      .map((m) => ({ id: m.id, name: m.name, tier: m.tier.key, until: m.tier.until }))
      .sort((a, b) => rank(b.tier) - rank(a.tier) || (a.until ?? Infinity) - (b.until ?? Infinity)),
  };
}

const fetchMember = async (guild, userId) => {
  const member = /^\d{17,20}$/.test(String(userId ?? '')) ? await guild.members.fetch(String(userId)).catch(() => null) : null;
  if (!member || member.user.bot) throw new UserError('Üye bulunamadı.');
  return member;
};

/** Yönetim paneli: kademe verir ya da süresini uzatır, üyeye haber verir. */
export async function addTierFromPanel(guild, admin, userId, key, rawDays) {
  const days = Number(rawDays);
  if (!TIER_DAYS.includes(days)) throw new UserError('Geçersiz süre.');
  const tier = tierOf(String(key ?? ''));
  if (!tier) throw new UserError('Geçersiz kademe.');
  const member = await fetchMember(guild, userId);
  const until = await grantTier(guild, member, tier.key, days, admin.id);
  const stamp = `<t:${Math.floor(until / 1000)}:F>`;
  await sendLog(guild, 'log_staff', { content: `Yönetim Paneli • <@${admin.id}> <@${member.id}> üyesine **${days} gün ${tier.name}** verdi. Bitiş: ${stamp}` });
  await member.send(`${e('tac', '👑')} **Karia ${tier.name}** üyeliğin aktif! Bitiş tarihi: ${stamp}`).catch(() => {});
  return membershipView(guild);
}

export async function removeTierFromPanel(guild, admin, userId) {
  const member = await fetchMember(guild, userId);
  const roles = await ensureTierRoles(guild);
  const had = TIERS.filter((t) => member.roles.cache.has(roles[t.key]));
  for (const tier of TIERS) {
    q.del.run(guild.id, member.id, roles[tier.key]);
    if (member.roles.cache.has(roles[tier.key])) await member.roles.remove(roles[tier.key], `Yönetim Paneli: ${admin.displayName}`);
  }
  if (had.length) await sendLog(guild, 'log_staff', { content: `Yönetim Paneli • <@${admin.id}> <@${member.id}> üyesinin ${had.map((t) => t.name).join(', ')} üyeliğini kaldırdı.` });
  return membershipView(guild);
}
