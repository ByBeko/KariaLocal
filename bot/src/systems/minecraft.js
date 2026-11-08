import { e } from '../utils/emojis.js';
import { status } from 'minecraft-server-util';
import config from '../config.js';
import { getSetting, setSetting } from '../core/settings.js';
import { brandEmbed, COLORS } from '../utils/embeds.js';

const { host, port, displayIp, version } = config.minecraft;
export const mcEnabled = Boolean(host);
export const mcIp = displayIp || host;

let cache = { at: 0, data: null };

/** Sunucu durumunu döner (30 sn önbellekli). Kapalıysa { online: false }. */
export async function getServerStatus() {
  if (!mcEnabled) return null;
  if (Date.now() - cache.at < 30_000) return cache.data;
  let data;
  try {
    const res = await status(host, port, { timeout: 5_000, enableSRV: true });
    data = {
      online: true,
      players: res.players.online,
      max: res.players.max,
      sample: res.players.sample?.map((p) => p.name) ?? [],
      version: res.version.name,
      motd: res.motd.clean,
      ping: res.roundTripLatency,
    };
  } catch {
    data = { online: false };
  }
  cache = { at: Date.now(), data };
  return data;
}

export function statusEmbed(data) {
  const embed = brandEmbed().setTitle(`${e('kazma', '⛏️')} Karia Minecraft Sunucusu`).setTimestamp();
  embed.addFields({ name: 'IP Adresi', value: `\`\`\`${mcIp}\`\`\`` });
  if (!data?.online) {
    return embed.setColor(COLORS.error).addFields({ name: 'Durum', value: `${e('nokta_kirmizi', '🔴')} Çevrimdışı` });
  }
  embed.addFields(
    { name: 'Durum', value: `${e('nokta_yesil', '🟢')} Çevrimiçi`, inline: true },
    { name: 'Oyuncular', value: `${data.players} / ${data.max}`, inline: true },
    { name: 'Sürüm', value: version || data.version, inline: true },
  );
  if (data.sample.length) embed.addFields({ name: 'Oyunda', value: data.sample.slice(0, 20).join(', ') });
  return embed;
}

async function updateStatusMessage(guild, data) {
  const channelId = getSetting(guild.id, 'mc_status_channel');
  const channel = channelId && guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;

  const payload = { embeds: [statusEmbed(data).setFooter({ text: 'Her dakika güncellenir' })] };
  const messageId = getSetting(guild.id, 'mc_status_message');
  const existing = messageId && (await channel.messages.fetch(messageId).catch(() => null));
  if (existing) {
    await existing.edit(payload).catch(() => {});
  } else {
    const sent = await channel.send(payload).catch(() => null);
    if (sent) setSetting(guild.id, 'mc_status_message', sent.id);
  }
}

export function startMinecraftLoop(client) {
  const tick = async () => {
    if (!mcEnabled) return;
    const data = await getServerStatus();
    for (const guild of client.guilds.cache.values()) await updateStatusMessage(guild, data);
  };
  tick();
  if (mcEnabled) setInterval(tick, 60_000);
}
