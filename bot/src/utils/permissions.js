import { PermissionFlagsBits } from 'discord.js';
import { getSetting } from '../core/settings.js';

export const Level = { USER: 0, STAFF: 1, MOD: 2, ADMIN: 3, OWNER: 4 };
export const LevelName = ['Üye', 'Personel', 'Moderatör', 'Yönetici', 'Kurucu'];

/**
 * Yetki seviyesi: /ayarla ile seçilen rollerden ya da Discord izinlerinden hesaplanır.
 *   Yönetici  → admin_role veya Administrator izni
 *   Moderatör → mod_role veya Üyeleri Yasakla izni
 *   Personel  → staff_role veya Üyelere Zaman Aşımı Uygula izni
 */
export function getLevel(member) {
  if (!member?.guild) return Level.USER;
  if (member.id === member.guild.ownerId) return Level.OWNER;
  const hasRole = (key) => {
    const id = getSetting(member.guild.id, key);
    return Boolean(id && member.roles.cache.has(id));
  };
  const perms = member.permissions;
  if (perms.has(PermissionFlagsBits.Administrator) || hasRole('admin_role')) return Level.ADMIN;
  if (perms.has(PermissionFlagsBits.BanMembers) || hasRole('mod_role')) return Level.MOD;
  if (perms.has(PermissionFlagsBits.ModerateMembers) || hasRole('staff_role')) return Level.STAFF;
  return Level.USER;
}

/** Üye bu komutu kullanabilir mi? Kullanamıyorsa sebebi döner. */
export function checkAccess(member, command) {
  const required = command.level ?? Level.USER;
  if (getLevel(member) < required) return `Bu komut için en az **${LevelName[required]}** yetkisi gerekiyor.`;
  if (command.userPerms && !member.permissions.has(command.userPerms)) {
    return 'Bu komutu kullanmak için gerekli Discord iznine sahip değilsin.';
  }
  return null;
}

export const isStaff =(member) => getLevel(member) >= Level.STAFF;

/** Yetkili rollerinin ID listesi (talep kanalları vb. için) */
export function staffRoleIds(guildId) {
  return ['staff_role', 'mod_role', 'admin_role'].map((k) => getSetting(guildId, k)).filter(Boolean);
}
