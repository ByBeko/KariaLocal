import { getSetting } from '../core/settings.js';

/** Ayarlı log kanalına mesaj gönderir. Kanal ayarlı değilse sessizce geçer. */
export async function sendLog(guild, key, payload) {
  const channelId = getSetting(guild.id, key);
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased()) return;
  await channel.send({ allowedMentions: { parse: [] }, ...payload }).catch((e) => console.error(`[Log: ${key}]`, e.message));
}
