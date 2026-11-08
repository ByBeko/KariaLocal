// Davet takibi: kim hangi davetle girdi. Davet kullanım sayıları önbellekte tutulur,
// biri katılınca sayısı artan davet bulunur.
const cache = new Map(); // guildId -> Map(code -> { uses, inviterId, maxUses })
const vanityUses = new Map(); // guildId -> uses

const snapshot = (invites) =>
  new Map(invites.map((i) => [i.code, { uses: i.uses ?? 0, inviterId: i.inviterId ?? i.inviter?.id ?? null, maxUses: i.maxUses ?? 0 }]));

export async function cacheInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (invites) cache.set(guild.id, snapshot(invites));
  if (guild.vanityURLCode) {
    const vanity = await guild.fetchVanityData().catch(() => null);
    if (vanity) vanityUses.set(guild.id, vanity.uses);
  }
}

export function trackInviteCreate(invite) {
  if (!invite.guild) return;
  const map = cache.get(invite.guild.id) ?? new Map();
  map.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviterId ?? invite.inviter?.id ?? null, maxUses: invite.maxUses ?? 0 });
  cache.set(invite.guild.id, map);
}

export function getCachedInvite(guildId, code) {
  return cache.get(guildId)?.get(code) ?? null;
}

/**
 * Yeni üyenin kullandığı daveti bulur.
 * Dönen: { code, inviterId, uses } | { vanity: true, code } | null (bulunamadı)
 */
export async function findUsedInvite(guild) {
  const before = cache.get(guild.id) ?? new Map();
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;
  const after = snapshot(invites);
  cache.set(guild.id, after);

  for (const [code, now] of after) {
    if (now.uses > (before.get(code)?.uses ?? 0)) return { code, inviterId: now.inviterId, uses: now.uses };
  }
  // Tek kullanımlık davetler kullanılınca silinir: önbellekte olup artık olmayan
  for (const [code, old] of before) {
    if (!after.has(code) && old.maxUses && old.uses + 1 >= old.maxUses) return { code, inviterId: old.inviterId, uses: old.uses + 1 };
  }
  if (guild.vanityURLCode) {
    const vanity = await guild.fetchVanityData().catch(() => null);
    if (vanity && vanity.uses > (vanityUses.get(guild.id) ?? 0)) {
      vanityUses.set(guild.id, vanity.uses);
      return { vanity: true, code: vanity.code, uses: vanity.uses };
    }
  }
  return null;
}

/** Davet edenler, kullanım sayısına göre çoktan aza */
export function inviteLeaderboard(guildId) {
  const totals = new Map();
  for (const invite of cache.get(guildId)?.values() ?? []) {
    if (invite.inviterId && invite.uses > 0) totals.set(invite.inviterId, (totals.get(invite.inviterId) ?? 0) + invite.uses);
  }
  return [...totals].map(([inviterId, uses]) => ({ inviterId, uses })).sort((a, b) => b.uses - a.uses);
}

/** Bir kişinin davetlerinin toplam kullanımı */
export function inviterTotal(guildId, inviterId) {
  let total = 0;
  for (const i of cache.get(guildId)?.values() ?? []) if (i.inviterId === inviterId) total += i.uses;
  return total;
}
