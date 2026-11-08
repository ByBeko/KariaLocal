/** Adı verilen bildirim rolünün etiketini ve izin ayarını döner. Rol yoksa kimse etiketlenmez. */
export function notifyRole(guild, name) {
  const role = guild.roles?.cache.find((r) => r.name === name);
  return role ? { mention: `<@&${role.id}>`, allowedMentions: { parse: [], roles: [role.id] } } : { mention: '', allowedMentions: { parse: [] } };
}
