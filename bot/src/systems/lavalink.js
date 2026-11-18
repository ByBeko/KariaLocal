// Lavalink bağlantısı: ses kanalı müziği botla aynı makinedeki Lavalink sunucusunda çözülür ve çalınır (bot/lavalink/).
// Tanımlı değilse ya da ulaşılamazsa music.js eski yt-dlp + ffmpeg yolunu kullanır; bot çökmez.
import { EventEmitter } from 'node:events';
import { Shoukaku, Connectors } from 'shoukaku';

let shoukaku = null;
let up = false;
let warned = false; // "ulaşılamıyor" uyarısı bağlanana kadar bir kez yazılır

/** 'up': Lavalink'e bağlanıldı, 'down': bağlantı koptu */
export const lavalinkEvents = new EventEmitter();

/** client.login'den önce çağrılmalı: Discord ses olaylarını dinler, bot hazır olunca Lavalink'e bağlanır */
export function initLavalink(client) {
  const host = process.env.LAVALINK_HOST?.trim();
  const auth = process.env.LAVALINK_PASSWORD?.trim();
  if (!host || !auth) {
    console.log('[Lavalink] LAVALINK_HOST / LAVALINK_PASSWORD yok: müzik yt-dlp ile çalacak, filtreler kapalı.');
    return;
  }
  const address = `${host}:${Number(process.env.LAVALINK_PORT) || 2333}`;
  shoukaku = new Shoukaku(new Connectors.DiscordJS(client), [{ name: 'karia', url: address, auth }], {
    resume: false, // bot yeniden başlarsa eski oturumun şarkıları Lavalink'te çalmaya devam etmesin
    resumeByLibrary: true, // Lavalink yeniden başlarsa çalan şarkılar kaldığı yerden sürer
    reconnectTries: Infinity, // Lavalink kapalıysa 10 sn'de bir yeniden denenir
    reconnectInterval: 10,
    restTimeout: 20,
    voiceConnectionTimeout: 20,
    userAgent: 'KariaBot',
  });
  shoukaku.on('ready', (_name, _resumed, byLibrary) => {
    up = true;
    warned = false;
    console.log(`[Lavalink] Bağlandı (${address})${byLibrary ? ', çalan şarkılar sürdürüldü' : ''}.`);
    lavalinkEvents.emit('up');
  });
  shoukaku.on('close', (_name, code, reason) => {
    if (up) console.warn(`[Lavalink] Bağlantı koptu (${code}${reason ? ` ${reason}` : ''}), yeniden deneniyor.`);
    up = false;
    lavalinkEvents.emit('down');
  });
  shoukaku.on('error', (_name, error) => {
    if (up) return console.error('[Lavalink]', error?.message ?? error);
    if (warned) return;
    warned = true;
    console.warn(`[Lavalink] Ulaşılamıyor (${address}): ${error?.message ?? error}. Bağlanana kadar müzik yt-dlp ile çalar.`);
  });
}

/** Bağlı Lavalink düğümü; yoksa null */
const idealNode = () => shoukaku?.getIdealNode() ?? null;
export const lavalinkUp = () => Boolean(idealNode());

/** Lavalink'te link çözer ya da arar (ytsearch:, ytmsearch:, scsearch:) */
export function loadTracks(identifier) {
  const node = idealNode();
  if (!node) return Promise.reject(new Error('Lavalink bağlı değil.'));
  return node.rest.resolve(identifier);
}

/** Ses kanalına Lavalink oyuncusuyla katılır */
export async function joinVoice(guild, channelId) {
  if (shoukaku.connections.has(guild.id) || shoukaku.players.has(guild.id)) await shoukaku.leaveVoiceChannel(guild.id); // eski sıradan kalan
  return shoukaku.joinVoiceChannel({ guildId: guild.id, channelId, shardId: guild.shardId, deaf: true });
}

/** Botun Lavalink tarafındaki ses kanalı (taşınınca güncellenir) */
export const voiceChannelOf = (guildId) => shoukaku?.connections.get(guildId)?.channelId ?? null;

/** Kanaldan çıkar ve Lavalink'teki oyuncuyu kapatır */
export function leaveVoice(guildId) {
  shoukaku?.leaveVoiceChannel(guildId).catch(() => {});
}

/** Oyuncuyu bırakır ama kanaldan çıkmaz: yedek yola geçerken bot aynı kanalda kalır */
export function forgetPlayer(guildId) {
  if (!shoukaku) return;
  shoukaku.connections.get(guildId)?.removeAllListeners();
  shoukaku.connections.delete(guildId);
  const player = shoukaku.players.get(guildId);
  shoukaku.players.delete(guildId);
  if (!player) return;
  player.destroy().catch(() => {}); // Lavalink açıksa oradaki oyuncu da kapanır
  player.clean();
}
