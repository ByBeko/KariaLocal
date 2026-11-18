// Müzik: ses kanalında Lavalink çalar (filtreler dahil, bkz. lavalink.js). Lavalink yoksa ya da ulaşılamazsa
// YouTube (ve SoundCloud) sesi yt-dlp ile indirilir, ffmpeg ile çözülüp doğrudan Discord'a aktarılır.
// Etkinlikte tarayıcıda çalınan şarkılar (downloadAudio) her zaman yt-dlp ile indirilir.
// Her sunucunun tek bir sırası (queue) vardır.
import { spawn, execFile } from 'node:child_process';
import { e } from '../utils/emojis.js';
import { createRequire } from 'node:module';
import { rename } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType,
} from '@discordjs/voice';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, StringSelectMenuBuilder } from 'discord.js';
import ffmpegPath from 'ffmpeg-static';
import { kariaEmbed } from '../utils/embeds.js';
import { UserError } from '../utils/errors.js';
import { isStaff } from '../utils/permissions.js';
import { isExternalLink, readMusicLink } from './playlistImport.js';
import { lavalinkUp, lavalinkEvents, loadTracks, joinVoice, leaveVoice, forgetPlayer, voiceChannelOf } from './lavalink.js';
import { createRelay } from './audioRelay.js';

const require = createRequire(import.meta.url);
// Sunucuda paketin Python sürümü çalışmayabilir: YOUTUBE_DL_PATH ile tek dosyalık yt-dlp gösterilir
const YTDLP = process.env.YOUTUBE_DL_PATH || require('youtube-dl-exec').constants.YOUTUBE_DL_PATH;

const MAX_QUEUE = 200;
const MAX_PLAYLIST = 100;
const MAX_HISTORY = 20;
const IDLE_LEAVE = 3 * 60_000; // sıra bitince bu kadar bekleyip çık
const ALONE_LEAVE = 60_000; // kanalda kimse kalmayınca
const PREFETCH_DELAY = 4; // çalan şarkı başladıktan bu kadar saniye sonra sıradaki hazırlanır: geçince beklemeden başlar
const YT_BLOCK_MS = 20 * 60_000; // YouTube "bot musun" derse bu süre doğrudan SoundCloud denenir
const LAVALINK_GRACE = 20_000; // Lavalink koparsa bu kadar beklenir (pm2 yeniden başlatır); dönmezse yt-dlp ile sürer
let ytBlockedUntil = 0;
export const DEFAULT_VOLUME = 70;

const ALLOWED_HOSTS = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|soundcloud\.com|on\.soundcloud\.com)$/i;
// --js-runtimes: YouTube'un şifre çözme adımı için botun kendi Node.js'i kullanılır (yoksa çok yavaş/başarısız)
const BASE_ARGS = ['--no-warnings', '--encoding', 'utf-8', '--js-runtimes', `node:${process.execPath}`, '--ffmpeg-location', ffmpegPath];
const ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

// ───────────────────────── Yardımcılar ─────────────────────────

export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return 'CANLI';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const trackLink = (t) => {
  const name = t.title.replaceAll('[', '(').replaceAll(']', ')').slice(0, 80);
  return /^https?:\/\//.test(t.url ?? '') ? `[${name}](${t.url})` : `**${name}**`; // aktarılan şarkı çalınırken aranır, linki yok
};

/** yt-dlp'ye verilebilecek kaynak: izinli sitelerin linki ya da aktarılan şarkının YouTube araması */
export function isPlayableSource(src) {
  if (typeof src !== 'string' || src.length > 500) return false;
  if (/^ytsearch1:[^\n\r]{1,220}$/.test(src)) return true;
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && ALLOWED_HOSTS.test(url.hostname);
  } catch {
    return false;
  }
}

function runYtdlpOnce(args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP, [...BASE_ARGS, ...args], { timeout, maxBuffer: 10 * 1024 * 1024, windowsHide: true, env: ENV }, (error, stdout, stderr) => {
      if (error && !stdout) return reject(String(stderr).split('\n').find((l) => l.startsWith('ERROR')) ?? error.message);
      resolve(String(stdout));
    });
  });
}

async function runYtdlp(args, timeout = 30_000) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runYtdlpOnce(args, timeout);
    } catch (msg) {
      // Ağ/SSL hataları geçici: tekrar dene. "Video yok" gibi hatalar kalıcı.
      if (attempt < MAX_ATTEMPTS && /SSL|timed out|Connection|Unable to download API page/i.test(msg)) continue;
      throw new UserError(`Bulunamadı ya da çalınamıyor: ${String(msg).replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').slice(0, 200)}`);
    }
  }
}

/** Sorgu (link ya da arama) → şarkı listesi */
export async function resolveQuery(query, requesterId) {
  const text = query.trim();
  let target;
  let lavalinkTarget;
  let args =['--flat-playlist', '--print', '%(id)s\t%(title)s\t%(duration)s\t%(uploader,channel)s\t%(webpage_url,url)s\t%(live_status)s\t%(playlist_title)s'];

  if (/^https?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      throw new UserError('Geçersiz link.');
    }
    if (isExternalLink(url)) {
      const { name, tracks } = await readMusicLink(url, requesterId);
      return { tracks, playlist: tracks.length > 1, name };
    }
    if (!ALLOWED_HOSTS.test(url.hostname)) throw new UserError('YouTube, YouTube Music, SoundCloud, Spotify, Deezer ve Apple Music linkleri çalınabilir. Ya da şarkının adını yaz.');
    const isPlaylist = url.searchParams.has('list') && (!url.searchParams.has('v') || url.pathname === '/playlist');
    if (!isPlaylist) {
      args.push('--no-playlist');
      for (const key of ['list', 'index', 'start_radio', 'pp']) url.searchParams.delete(key); // Lavalink de tek şarkı alsın
    } else args.push('--playlist-end', String(MAX_PLAYLIST));
    target = text;
    lavalinkTarget = url.toString();
  } else {
    target = `ytsearch1:${text}`;
  }

  const viaLavalink = await resolveOnLavalink(lavalinkTarget ?? target, requesterId);
  if (viaLavalink) return { ...viaLavalink, playlist: viaLavalink.tracks.length > 1 || /[?&]list=/.test(text) };

  const out = await runYtdlp([...args, target]);
  const lines = out.split('\n').filter(Boolean);
  const listTitle = lines[0]?.split('\t')[6];
  const tracks = lines
    .map((line) => {
      const [id, title, duration, uploader, url, live] = line.split('\t');
      const isYoutube = /^[\w-]{11}$/.test(id);
      return {
        id,
        title: title && title !== 'NA' ? title : 'Bilinmeyen şarkı',
        duration: Number(duration) || 0,
        uploader: uploader && uploader !== 'NA' ? uploader : '',
        url: isYoutube ? `https://www.youtube.com/watch?v=${id}` : url,
        thumbnail: isYoutube ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null,
        live: live === 'is_live',
        requesterId,
      };
    })
    .filter((t) => t.url && t.url !== 'NA' && !['[Private video]', '[Deleted video]'].includes(t.title));
  if (!tracks.length) throw new UserError('Hiçbir şey bulunamadı. Başka bir şekilde ara.');
  const name = listTitle && listTitle !== 'NA' ? listTitle.slice(0, 40) : '';
  return { tracks, playlist: tracks.length > 1 || /[?&]list=/.test(text), name };
}

/** Lavalink'in şarkı kaydı → sıradaki şarkı biçimi (yt-dlp ile aynı alanlar; encoded tekrar aramadan çalmak için) */
function fromLavalink(t, requesterId) {
  const i = t.info;
  const isYoutube = i.sourceName === 'youtube' && /^[\w-]{11}$/.test(i.identifier);
  return {
    id: i.identifier,
    title: i.title || 'Bilinmeyen şarkı',
    duration: i.isStream ? 0 : Math.round(i.length / 1000),
    uploader: i.author || '',
    url: isYoutube ? `https://www.youtube.com/watch?v=${i.identifier}` : i.uri,
    thumbnail: isYoutube ? `https://i.ytimg.com/vi/${i.identifier}/hqdefault.jpg` : (i.artworkUrl ?? null),
    live: Boolean(i.isStream),
    requesterId,
    encoded: t.encoded,
  };
}

/** Lavalink açıksa sorgu orada çözülür (yt-dlp'den hızlı). Olmazsa null döner, yt-dlp dener. */
async function resolveOnLavalink(identifier, requesterId) {
  if (!lavalinkUp() || SOUNDCLOUD.test(identifier)) return null; // SoundCloud linkleri yt-dlp ile çözülür
  const search = identifier.match(/^ytsearch1:(.+)$/s)?.[1];
  const res = await loadTracks(search ? `ytsearch:${search}` : identifier).catch(() => null);
  let found = [];
  let name = '';
  if (res?.loadType === 'track') found = [res.data];
  else if (res?.loadType === 'search') found = res.data.slice(0, 1);
  else if (res?.loadType === 'playlist') {
    found = res.data.tracks.slice(0, MAX_PLAYLIST);
    name = res.data.info?.name ?? '';
  } else if (res?.loadType === 'empty' && search) throw new UserError('Hiçbir şey bulunamadı. Başka bir şekilde ara.');
  const tracks = found.map((t) => fromLavalink(t, requesterId)).filter((t) => t.url && !['[Private video]', '[Deleted video]'].includes(t.title));
  return tracks.length ? { tracks, name: name.slice(0, 40) } : null;
}

const MAX_ATTEMPTS = 3;

/** YouTube şarkıyı sunucuya vermezse aynı şarkıyı SoundCloud'da arar: önizlemeleri eler, süresi en yakın olanı seçer */
async function soundcloudAlternatives(track) {
  const base = track.url?.startsWith('ytsearch') ? track.url.replace(/^ytsearch\d*:/, '').replace(/ audio$/, '') : track.title;
  const name = base.replace(/[([][^)\]]*(official|resmi|video|audio|lyric|klip)[^)\]]*[)\]]/gi, '').trim();
  const out = await runYtdlpOnce(['--flat-playlist', '--print', '%(url)s\t%(duration)s', `scsearch5:${name}`], 25_000).catch(() => '');
  const options = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [url, duration] = line.split('\t');
      return { url, duration: Number(duration) || 0 };
    })
    .filter((o) => o.url?.startsWith('http') && o.duration >= 60 && (!track.duration || Math.abs(o.duration - track.duration) <= 60));
  options.sort((a, b) => Math.abs(a.duration - track.duration) - Math.abs(b.duration - track.duration));
  return options.slice(0, 3).map((o) => o.url);
}

// Lavalink 4.2'nin SoundCloud kaynağı SoundCloud'un yeni (HLS) biçimlerini okuyamıyor: SoundCloud şarkıları
// yt-dlp ile çözülür ve yerel köprüden çalınır (openRelay).
const SOUNDCLOUD = /soundcloud\.com/i;

/** Şarkının Lavalink kaydı. Aktarılan şarkılar (ytsearch1:) önce YouTube Music'te, bulunmazsa YouTube'da aranır. */
async function encodeTrack(track) {
  if (track.encoded) return track.encoded;
  const search = track.url?.match(/^ytsearch\d*:(.+)$/s)?.[1];
  const ids = search ? [`ytmsearch:${search.replace(/ audio$/, '')}`, `ytsearch:${search}`] : [track.url];
  let lastError = '';
  for (const id of ids) {
    const res = await loadTracks(id);
    if (res.loadType === 'error') lastError = res.data?.message ?? '';
    const found =
      res.loadType === 'track' ? res.data
      : res.loadType === 'search' ? res.data[0]
      : res.loadType === 'playlist' ? (res.data.tracks[res.data.info?.selectedTrack] ?? res.data.tracks[0])
      : null;
    if (!found) continue;
    const info = fromLavalink(found, track.requesterId);
    track.encoded = found.encoded;
    if (!track.duration) track.duration = info.duration;
    track.thumbnail ??= info.thumbnail;
    return found.encoded;
  }
  throw new Error(lastError || 'Şarkı bulunamadı.');
}

// YouTube Lavalink'i "bot musun" diye engellerse bu süre YouTube şarkıları doğrudan köprüyle (yt-dlp) çalınır
let lavalinkYtBlockedUntil = 0;
const youtubeBlockedOnLavalink = () => Date.now() < lavalinkYtBlockedUntil;

/** Lavalink'in kendisi çalmayacağı şarkı: SoundCloud ya da YouTube engelliyken YouTube */
const needsRelay = (track) => SOUNDCLOUD.test(track.url ?? '') || (youtubeBlockedOnLavalink() && YOUTUBE_SOURCE.test(track.url ?? ''));

/**
 * Şarkıyı bugünkü yolla (yt-dlp + ffmpeg; YouTube engelinde SoundCloud) alır, yerel köprüden Lavalink'e verir.
 * relay.encoded yoksa çalınamadı (relay.error() nedenini söyler). İşi bitince relay.release() çağrılmalı.
 */
async function openRelay(track) {
  const relay = await createRelay(() => openStream(track, 'ogg'));
  await relay.firstAudio();
  const res = relay.hasAudio ? await loadTracks(relay.url).catch(() => null) : null;
  if (res?.loadType === 'track') relay.encoded = res.data.encoded;
  return relay;
}

/** Kullanıcıya gösterilecek kısa hata: YouTube'un uzun istemci dökümü yerine */
const friendlyError = (message) =>
  /All clients failed|Sign in to confirm|requires login/i.test(message ?? '') ? "YouTube bu şarkıyı vermedi" : String(message ?? '').replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').slice(0, 150);

const FFMPEG_OUTPUT = {
  pcm: ['-f', 's16le', '-ar', '48000', '-ac', '2'], // ham PCM: @discordjs/voice (Lavalink yokken)
  ogg: ['-vn', '-c:a', 'libopus', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-f', 'ogg'], // Lavalink köprüsü
};

/**
 * yt-dlp → ffmpeg → ham PCM (48 kHz stereo) ya da Ogg/Opus akışı.
 * YouTube bağlantısı ara sıra SSL hatasıyla düşüyor; hiç ses gelmeden biterse kendiliğinden yeniden dener.
 */
export function openStream(track, format = 'pcm') {
  const out = new PassThrough({ highWaterMark: 1 << 16 });
  let procs = null;
  let killed = false;
  let produced = false;
  let attempts = 0;
  let errorText = '';
  let url = track.url;
  let alternatives = null; // YouTube reddederse sırayla denenecek SoundCloud adresleri

  const start = () => {
    attempts++;
    const ytdlp = spawn(
      YTDLP,
      [...BASE_ARGS, ...(track.live ? [] : ['--extractor-args', 'youtube:skip=hls']), '-f', 'bestaudio[acodec=opus]/bestaudio/best', '-o', '-', '--quiet', url],
      { windowsHide: true, env: ENV },
    );
    const ffmpeg = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', ...FFMPEG_OUTPUT[format], 'pipe:1'], {
      windowsHide: true,
    });
    procs = { ytdlp, ffmpeg };
    let stderr = '';
    ytdlp.stderr.on('data', (d) => (stderr += d));
    ffmpeg.stderr.resume();
    for (const s of [ytdlp.stdout, ffmpeg.stdin, ffmpeg.stdout]) s.on('error', () => {}); // atlayınca boru kapanır, normal

    // İndirme beklemeden belleğe alınır (sıkıştırılmış ses, şarkı başı birkaç MB). Doğrudan boru bağlansaydı
    // çalma hızında okunduğu için YouTube bağlantısı dakikalarca bekler ve uzun şarkılarda kopabilirdi.
    const pending = [];
    let waiting = false;
    let downloaded = false;
    const pump = () => {
      while (!waiting && pending.length) if (!ffmpeg.stdin.write(pending.shift())) waiting = true;
      if (downloaded && !pending.length && !ffmpeg.stdin.writableEnded) ffmpeg.stdin.end();
    };
    ytdlp.stdout.on('data', (chunk) => {
      pending.push(chunk);
      pump();
    });
    ytdlp.stdout.on('end', () => {
      downloaded = true;
      pump();
    });
    ffmpeg.stdin.on('drain', () => {
      waiting = false;
      pump();
    });
    ffmpeg.stdout.once('data', () => (produced = true));
    ffmpeg.stdout.pipe(out, { end: false });

    const ytClosed = new Promise((r) => ytdlp.once('close', r));
    ffmpeg.once('close', async () => {
      await ytClosed;
      if (killed) return;
      if (!produced && /Sign in to confirm/i.test(stderr)) ytBlockedUntil = Date.now() + YT_BLOCK_MS;
      if (!produced && (alternatives || /Sign in to confirm/i.test(stderr))) {
        alternatives ??= await soundcloudAlternatives(track);
        if (killed) return;
        const next = alternatives.shift();
        if (next) {
          console.log(`[Müzik] YouTube vermedi, SoundCloud'dan deneniyor: ${track.title}`);
          url = next;
          attempts = 0;
          return start();
        }
        attempts = MAX_ATTEMPTS; // aynı engele tekrar denemenin faydası yok
      }
      if (!produced && attempts < MAX_ATTEMPTS) return setTimeout(start, 800 * attempts);
      errorText = produced ? '' : stderr;
      out.end();
    });
  };
  // YouTube az önce bu sunucuyu engellediyse boşuna denenmez, aynı şarkı hemen SoundCloud'da aranır
  (async () => {
    if (Date.now() < ytBlockedUntil && /youtu\.?be|^ytsearch/i.test(url)) {
      alternatives = await soundcloudAlternatives(track);
      if (killed) return;
      const next = alternatives.shift();
      if (next) url = next;
      else alternatives = null;
    }
    start();
  })();

  return {
    stream: out,
    kill: () => {
      killed = true;
      procs?.ytdlp.kill();
      procs?.ffmpeg.kill();
      out.end();
    },
    error: () => errorText.split('\n').find((l) => l.startsWith('ERROR')) ?? null,
  };
}

/**
 * Etkinlikte tarayıcıda çalmak için şarkıyı m4a (AAC) dosyası olarak indirir: her cihaz (iOS dahil) bunu çalabilir.
 * YouTube sunucuyu engellerse aynı şarkı SoundCloud'da aranır. Dönüş: { id, duration, title, uploader }
 */
export async function downloadAudio(track, file) {
  const temp = file.replace(/\.m4a$/, '.dl');
  const args = ['--no-playlist', '--playlist-items', '1', '-f', 'bestaudio[ext=m4a]/bestaudio/best', '-x', '--audio-format', 'm4a', '-o', `${temp}.%(ext)s`,
    '--print', 'after_move:%(id)s\t%(duration)s\t%(title)s\t%(uploader,channel)s'];
  const isYoutube = /youtu\.?be|^ytsearch/i.test(track.url);
  let sources = Date.now() < ytBlockedUntil && isYoutube ? await soundcloudAlternatives(track) : [track.url];
  let triedAlternatives = sources[0] !== track.url;
  let lastError = '';
  for (let i = 0; i < sources.length; i++) {
    try {
      const out = await runYtdlpOnce([...args, '--', sources[i]], 180_000);
      const [id, duration, title, uploader] = out.split('\n').find((l) => l.includes('\t'))?.split('\t') ?? [];
      await rename(`${temp}.m4a`, file);
      return { id: id ?? '', duration: Number(duration) || 0, title: title && title !== 'NA' ? title : '', uploader: uploader && uploader !== 'NA' ? uploader : '' };
    } catch (error) {
      lastError = String(error?.message ?? error);
      if (/Sign in to confirm/i.test(lastError)) ytBlockedUntil = Date.now() + YT_BLOCK_MS;
      if (i === sources.length - 1 && isYoutube && !triedAlternatives) {
        triedAlternatives = true;
        sources = [...sources, ...(await soundcloudAlternatives(track))];
      }
    }
  }
  throw new UserError(`Çalınamadı: ${lastError.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').slice(0, 150) || 'şarkı bulunamadı.'}`);
}

// ───────────────────────── Filtreler (sadece Lavalink) ─────────────────────────

export const FILTERS = {
  off: { label: 'Kapalı', description: 'Filtre yok', emoji: '🎵', filters: {} },
  '8d': { label: '8D', description: 'Ses başının etrafında döner (kulaklıkla)', emoji: '🎧', filters: { rotation: { rotationHz: 0.2 } } },
  bass: {
    label: 'Bass boost',
    description: 'Baslar güçlenir',
    emoji: '🔊',
    filters: { equalizer: [0.3, 0.25, 0.2, 0.1, 0.05].map((gain, band) => ({ band, gain })) },
  },
  nightcore: { label: 'Nightcore', description: 'Hızlı ve ince', emoji: '⏩', filters: { timescale: { speed: 1.2, pitch: 1.25, rate: 1 } } },
  slowed: {
    label: 'Slowed',
    description: 'Yavaş ve kalın (vaporwave)',
    emoji: '🌙',
    filters: { timescale: { speed: 0.8, pitch: 0.85, rate: 1 }, equalizer: [0.12, 0.1, 0.05].map((gain, band) => ({ band, gain })) },
  },
};
const NO_FILTERS = 'Filtreler şu an kullanılamıyor: müzik sunucusu (Lavalink) kapalı, müzik yedek yolla çalıyor.';
/** Filtrenin şarkıyı ne kadar hızlandırdığı (konumu tahmin etmek için) */
const filterSpeed = (name) => {
  const t = FILTERS[name]?.filters.timescale;
  return (t?.speed ?? 1) * (t?.rate ?? 1);
};

// ───────────────────────── Çalma motorları ─────────────────────────
// İkisi de sıraya aynı şekilde haber verir: queue.onTrackStart() ses başlayınca, queue.onTrackEnd(hata) şarkı bitince.

const cleanError = (text) => String(text ?? '').replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').slice(0, 150);
const YOUTUBE_SOURCE = /youtu\.?be|^ytsearch/i;

/** Lavalink yokken: yt-dlp + ffmpeg akışı @discordjs/voice ile bu süreçte çalınır */
class VoiceEngine {
  filters = false;

  constructor(queue, voiceChannel) {
    this.queue = queue;
    this.prepared = null; // önceden hazırlanan sıradaki şarkı
    this.active = null; // çalan şarkının süreçleri
    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.connection.subscribe(this.player);

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Kanal değiştirildiyse tekrar bağlanır, gerçekten atıldıysa kapanır
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        queue.destroy();
      }
    });
    this.connection.on(VoiceConnectionStatus.Destroyed, () => queue.destroy());

    this.player.on(AudioPlayerStatus.Idle, (old) => {
      if (old.status !== AudioPlayerStatus.Idle) this.finish();
    });
    this.player.on(AudioPlayerStatus.Playing, (old) => {
      if (old.status === AudioPlayerStatus.Buffering) queue.onTrackStart();
    });
    this.player.on('error', (error) => console.error('[Müzik oynatıcı]', error.message));
  }

  get channelId() {
    return this.connection.joinConfig.channelId;
  }

  get position() {
    return Math.floor((this.player.state.resource?.playbackDuration ?? 0) / 1000);
  }

  get paused() {
    return this.player.state.status === AudioPlayerStatus.Paused;
  }

  connect() {
    return entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
  }

  play(track) {
    let source;
    if (this.prepared?.track === track) source = this.prepared.source;
    else {
      this.prepared?.source.kill();
      source = openStream(track);
    }
    this.prepared = null;
    this.active = { track, source, startedAt: Date.now() };
    const resource = createAudioResource(source.stream, { inputType: StreamType.Raw, inlineVolume: true, metadata: track });
    resource.volume.setVolume(this.queue.volume / 100);
    this.player.play(resource);
  }

  finish() {
    const ended = this.active;
    this.active = null;
    ended?.source.kill();
    // Kısa sürede hata ile bittiyse (gizli/yaş sınırlı video vb.) sıra haber verir, döngüye almaz
    const error = ended?.source.error();
    this.queue.onTrackEnd(error && Date.now() - ended.startedAt < 15_000 ? cleanError(error) : null);
  }

  stop() {
    this.player.stop(true);
  }

  setPaused(paused) {
    if (paused) this.player.pause();
    else this.player.unpause();
  }

  setVolume(volume) {
    this.player.state.resource?.volume?.setVolume(volume / 100);
  }

  setFilter() {
    throw new UserError(NO_FILTERS);
  }

  prefetch(next) {
    if (!this.prepared) this.prepared = { track: next, source: openStream(next) };
  }

  /** Sıra değişince (karıştır, sil) önceden hazırlanan şarkı geçersiz olabilir */
  invalidatePrefetch(next) {
    if (this.prepared && this.prepared.track !== next) {
      this.prepared.source.kill();
      this.prepared = null;
    }
  }

  destroy() {
    this.active?.source.kill();
    this.prepared?.source.kill();
    this.player.stop(true);
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
  }
}

/** Lavalink ile: ses Lavalink sunucusunda çözülür ve Discord'a oradan gider; filtreler de orada uygulanır */
class LavalinkEngine {
  filters = true;

  constructor(queue, voiceChannel) {
    this.queue = queue;
    this.guildId = voiceChannel.guild.id;
    this.joinedChannelId = voiceChannel.id;
    this.player = null;
    this.token = 0; // her şarkıda artar: iptal edilen işlerin sonuçları yok sayılır
    this.loaded = false; // Lavalink'te çalan ya da yüklenen bir şarkı var
    this.done = true; // bu şarkının bittiği sıraya bildirildi
    this.stopping = false; // şarkıyı biz durdurduk (geç, önceki)
    this.fresh = false; // yeni şarkı başlıyor (Lavalink yeniden bağlanınca aynı şarkı kaldığı yerden başlar)
    this.isPaused = false;
    this.speed = 1;
    this.base = 0; // Lavalink konumu 5 sn'de bir bildirir; arası bu son değerden tahmin edilir
    this.at = Date.now();
  }

  get channelId() {
    return voiceChannelOf(this.guildId) ?? this.joinedChannelId;
  }

  get paused() {
    return this.isPaused;
  }

  get ms() {
    return this.base + (this.isPaused ? 0 : (Date.now() - this.at) * this.speed);
  }

  get position() {
    return this.loaded ? Math.floor(this.ms / 1000) : 0;
  }

  mark(ms) {
    this.base = ms;
    this.at = Date.now();
  }

  async connect() {
    this.player = await joinVoice(this.queue.guild, this.joinedChannelId);
    this.player.on('start', () => {
      this.mark(this.fresh ? 0 : this.player.position);
      this.fresh = false;
      this.queue.onTrackStart();
    });
    this.player.on('update', (json) => {
      if (this.loaded) this.mark(json.state?.position ?? this.ms);
    });
    this.player.on('end', (json) => this.onEnd(json));
    this.player.on('exception', (json) => {
      const message = json.exception?.message || 'Bilinmeyen hata';
      if (/Sign in to confirm|not a bot/i.test(message)) lavalinkYtBlockedUntil = Date.now() + YT_BLOCK_MS;
      this.error = friendlyError(message);
      console.warn(`[Lavalink] ${this.queue.current?.title ?? 'Şarkı'}: ${message.split('\n')[0].slice(0, 200)}`);
    });
    this.player.on('stuck', () => {
      console.warn(`[Lavalink] Ses gelmiyor, geçiliyor: ${this.queue.current?.title ?? 'şarkı'}`);
      this.player.stopTrack().catch(() => {});
    });
    this.player.on('closed', (json) => console.warn(`[Lavalink] Discord ses bağlantısı kapandı (${json.code}${json.reason ? ` ${json.reason}` : ''})`));
    await this.player.setGlobalVolume(this.queue.volume);
  }

  play(track) {
    const token = ++this.token;
    this.done = false;
    this.loaded = false;
    this.stopping = false;
    this.error = null;
    this.triedRelay = false;
    this.startedAt = Date.now();
    this.mark(0);
    this.load(track, token);
  }

  async load(track, token) {
    let encoded = null;
    // SoundCloud ve (YouTube Lavalink'i engellediyse) YouTube şarkıları doğrudan köprüyle çalınır
    if (!needsRelay(track)) {
      try {
        encoded = await encodeTrack(track);
      } catch (error) {
        if (token !== this.token) return;
        if (!lavalinkUp()) return this.queue.fallback();
        this.error = friendlyError(error?.message);
      }
      if (token !== this.token) return;
    }
    if (encoded) this.start(encoded, token);
    else this.useRelay(track, token);
  }

  async start(encoded, token) {
    this.loaded = true;
    this.fresh = true;
    this.isPaused = false;
    try {
      await this.player.playTrack({ track: { encoded }, position: 0, paused: false });
    } catch (error) {
      if (token !== this.token) return;
      this.loaded = false;
      if (!lavalinkUp()) return this.queue.fallback();
      this.error = friendlyError(error?.message);
      this.retry(token);
    }
  }

  /** Lavalink şarkıyı çalamadı: bir kez köprü denenir, o da olmadıysa sıraya hata bildirilir */
  retry(token) {
    if (!this.triedRelay && this.queue.current) return this.useRelay(this.queue.current, token);
    this.finish(this.error || 'şarkı bulunamadı.');
  }

  /** Ses bugünkü yolla (yt-dlp + ffmpeg, YouTube engelinde SoundCloud) alınır ve yerel köprüden Lavalink'e verilir */
  async useRelay(track, token) {
    this.triedRelay = true;
    let relay = null;
    if (this.prepared?.track === track) relay = this.prepared.relay;
    else this.prepared?.relay.release();
    this.prepared = null;
    relay ??= await openRelay(track).catch((error) => console.warn('[Müzik] Köprü açılamadı:', error?.message ?? error));
    if (token !== this.token) return relay?.release();
    if (!relay?.encoded) {
      const reason = relay?.error();
      relay?.release();
      if (!lavalinkUp()) return this.queue.fallback();
      return this.finish(reason ? friendlyError(reason) : this.error || 'şarkı bulunamadı.');
    }
    if (this.error) console.log(`[Müzik] Lavalink çalamadı, yt-dlp ile çalınıyor: ${track.title}`);
    this.relay = relay;
    this.start(relay.encoded, token);
  }

  onEnd(json) {
    if (this.done || json.reason === 'replaced' || json.reason === 'cleanup') return;
    this.loaded = false;
    if (json.reason === 'loadFailed' && !this.stopping) return this.retry(this.token);
    // Kısa sürede hata ile bittiyse sıra haber verir, döngüye almaz
    this.finish(!this.stopping && this.error && Date.now() - this.startedAt < 15_000 ? this.error : null);
  }

  finish(error) {
    if (this.done) return;
    this.done = true;
    this.loaded = false;
    this.relay?.release();
    this.relay = null;
    this.queue.onTrackEnd(error);
  }

  stop() {
    this.stopping = true;
    if (this.loaded) return void this.player.stopTrack().catch(() => this.finish(null));
    this.token++; // şarkı daha aranıyorsa bırakılır
    this.finish(null);
  }

  setPaused(paused) {
    this.mark(this.ms);
    this.isPaused = paused;
    this.player.setPaused(paused).catch((error) => console.warn('[Lavalink] Duraklatılamadı:', error.message));
  }

  setVolume(volume) {
    this.player
      .setGlobalVolume(volume)
      .then(() => (this.player.paused = this.isPaused)) // kütüphane her istekte "devam ediyor" sayıyor
      .catch((error) => console.warn('[Lavalink] Ses düzeyi ayarlanamadı:', error.message));
  }

  async setFilter(name) {
    const { filters } = FILTERS[name];
    await this.player.setFilters(filters); // Lavalink v4'te verilen filtreler öncekilerin yerine geçer ({} hepsini kapatır)
    this.player.filters = { ...filters }; // yeniden bağlanınca sadece bunlar gönderilsin
    this.player.paused = this.isPaused;
    this.mark(this.ms);
    this.speed = filterSpeed(name);
  }

  /** Sıradaki şarkı önceden hazırlanır (Lavalink'te aranır ya da köprüsü açılır): geçince beklemeden başlar */
  prefetch(next) {
    if (this.prefetching === next) return;
    this.prefetching = next;
    if (!needsRelay(next)) return void encodeTrack(next).catch(() => {});
    openRelay(next)
      .then((relay) => {
        if (this.prefetching !== next || this.gone) return relay.release();
        this.prepared?.relay.release();
        this.prepared = { track: next, relay };
      })
      .catch(() => {});
  }

  /** Sıra değişince (karıştır, sil) önceden açılan köprü geçersiz olabilir */
  invalidatePrefetch(next) {
    if (this.prefetching !== next) this.prefetching = null;
    if (this.prepared && this.prepared.track !== next) {
      this.prepared.relay.release();
      this.prepared = null;
    }
  }

  cleanup() {
    this.gone = true;
    this.token++;
    this.relay?.release();
    this.prepared?.relay.release();
    this.relay = this.prepared = null;
  }

  destroy() {
    this.cleanup();
    leaveVoice(this.guildId);
  }

  /** Yedek yola geçerken: Lavalink oyuncusu bırakılır ama bot kanalda kalır */
  abandon() {
    this.cleanup();
    this.done = true;
    forgetPlayer(this.guildId);
  }
}
// ───────────────────────── Sunucu sırası ─────────────────────────

const queues = new Map(); // guildId -> GuildQueue
export const getQueue = (guildId) => queues.get(guildId) ?? null;

class GuildQueue {
  constructor(guild, voiceChannel, textChannel) {
    this.guild = guild;
    this.textChannel = textChannel;
    this.tracks = [];
    this.current = null;
    this.loop = 'off'; // off | track | queue
    this.volume = DEFAULT_VOLUME;
    this.filter = 'off'; // FILTERS anahtarı
    this.skipVotes = new Set();
    this.panel = null; // "şimdi çalıyor" mesajı
    this.plays = 0; // her çalınan şarkıda artar
    this.panelFor = 0; // panelin gönderildiği çalma
    this.forceNext = false;
    this.history = []; // biten şarkılar (önceki şarkıya dönmek için)
    this.goingBack = false;
    this.engine = lavalinkUp() ? new LavalinkEngine(this, voiceChannel) : new VoiceEngine(this, voiceChannel);
    this.prefetchTimer = setInterval(() => this.maybePrefetch(), 2_000);
    queues.set(guild.id, this);
  }

  get channelId() {
    return this.engine.channelId;
  }

  get position() {
    return this.engine.position;
  }

  get paused() {
    return this.engine.paused;
  }

  /** Filtreler sadece Lavalink ile çalarken kullanılabilir */
  get filtersAvailable() {
    return this.engine.filters;
  }

  async waitReady() {
    try {
      await this.engine.connect();
      return;
    } catch (error) {
      if (this.engine instanceof LavalinkEngine && !this.destroyed) {
        console.warn('[Lavalink] Kanala bağlanamadı, yt-dlp ile deneniyor:', error?.message ?? error);
        this.engine.abandon();
        const channel = this.guild.channels.cache.get(this.engine.joinedChannelId);
        if (channel) {
          this.engine = new VoiceEngine(this, channel);
          try {
            await this.engine.connect();
            return;
          } catch {}
        }
      }
      this.destroy();
      throw new UserError('Ses kanalına bağlanamadım. Kanal izinlerimi kontrol et.');
    }
  }

  add(tracks) {
    const room = MAX_QUEUE - this.tracks.length;
    const added = tracks.slice(0, Math.max(0, room));
    this.tracks.push(...added);
    if (!this.current) this.playNext();
    return added.length;
  }

  playNext() {
    if (this.destroyed) return;
    clearTimeout(this.idleTimer);
    const track = this.tracks.shift();
    if (!track) {
      this.current = null;
      this.disablePanel();
      this.idleTimer = setTimeout(() => {
        this.say(`${e('mesaj', '👋')} Sıra boş kaldığı için kanaldan ayrıldım.`);
        this.destroy();
      }, IDLE_LEAVE);
      return;
    }
    this.play(track);
  }

  play(track) {
    this.current = track;
    this.skipVotes.clear();
    this.plays++;
    this.engine.play(track);
  }

  onTrackStart() {
    if (this.destroyed) return;
    if (this.panelFor === this.plays && this.panel) return this.refreshPanel(); // Lavalink yeniden bağlanınca aynı şarkı sürer
    this.panelFor = this.plays;
    this.sendPanel();
  }

  onTrackEnd(error = null) {
    if (this.destroyed) return;
    const finished = this.current;
    if (this.goingBack) { // sıra previous() içinde kuruldu
      this.goingBack = false;
      this.forceNext = false;
      this.playNext();
      return;
    }

    // Hata ile bittiyse (gizli/yaş sınırlı video vb.) haber ver, döngüye alma
    if (error) {
      this.say(`${e('unlem', '⚠️')} **${finished?.title ?? 'Şarkı'}** çalınamadı: ${error}`);
    } else if (finished) {
      if (this.loop === 'track' && !this.forceNext) this.tracks.unshift(finished);
      else {
        this.history.push(finished);
        if (this.history.length > MAX_HISTORY) this.history.shift();
        if (this.loop === 'queue') this.tracks.push(finished);
      }
    }
    this.forceNext = false;
    this.playNext();
  }

  /** Lavalink'e ulaşılamıyor: aynı kanalda yt-dlp ile sürer (çalan şarkı baştan başlar, filtre kapanır) */
  async fallback() {
    if (this.destroyed || this.switching || !(this.engine instanceof LavalinkEngine)) return;
    this.switching = true;
    clearTimeout(this.lostTimer);
    const channel = this.guild.channels.cache.get(this.channelId);
    this.engine.abandon();
    const hadFilter = this.filter !== 'off';
    this.filter = 'off';
    try {
      if (!channel) throw new Error('kanal yok');
      this.engine = new VoiceEngine(this, channel);
      await this.engine.connect();
    } catch {
      this.switching = false;
      this.say(`${e('unlem', '⚠️')} Müzik sunucusuna ulaşılamıyor ve ses kanalına yeniden bağlanamadım.`);
      return this.destroy();
    }
    this.switching = false;
    if (this.destroyed) return;
    console.warn(`[Lavalink] Ulaşılamıyor: ${this.guild.name} müziği yt-dlp ile sürüyor.`);
    this.say(`${e('unlem', '⚠️')} Müzik sunucusuna ulaşılamadı, yedek yolla devam ediyorum${hadFilter ? ' (filtre kapandı)' : ''}.`);
    if (this.current) {
      this.tracks.unshift(this.current);
      this.playNext();
    }
  }

  maybePrefetch() {
    if (!this.current || this.current.live || !this.current.duration) return;
    const next = this.loop === 'track' ? null : this.tracks[0];
    if (next && !next.live && this.position >= PREFETCH_DELAY) this.engine.prefetch(next);
  }

  /** Sıra değişince (karıştır, sil) önceden hazırlanan şarkı geçersiz olabilir */
  invalidatePrefetch() {
    this.engine.invalidatePrefetch(this.tracks[0]);
  }

  skip() {
    this.forceNext = true;
    this.engine.stop();
  }

  previous() {
    const track = this.history.pop();
    if (!track) throw new UserError('Önceki şarkı yok.');
    const repeated = this.tracks.lastIndexOf(track); // sıra döngüsünde şarkı sona da eklenmişti
    if (repeated >= 0) this.tracks.splice(repeated, 1);
    this.tracks.unshift(track, this.current);
    this.invalidatePrefetch();
    this.goingBack = true;
    this.engine.stop();
  }

  togglePause() {
    this.engine.setPaused(!this.paused);
    return this.paused;
  }

  setVolume(volume) {
    this.volume = volume;
    this.engine.setVolume(volume);
  }

  async setFilter(name) {
    if (!Object.hasOwn(FILTERS, name)) throw new UserError('Böyle bir filtre yok.');
    if (!this.filtersAvailable) throw new UserError(NO_FILTERS);
    try {
      await this.engine.setFilter(name);
    } catch (error) {
      console.warn('[Lavalink] Filtre uygulanamadı:', error?.message ?? error);
      throw new UserError('Filtre uygulanamadı, müzik sunucusu yanıt vermedi. Biraz sonra tekrar dene.');
    }
    this.filter = name;
  }

  shuffle() {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
    this.invalidatePrefetch();
  }

  cycleLoop(mode) {
    this.loop = mode ?? { off: 'track', track: 'queue', queue: 'off' }[this.loop];
    this.invalidatePrefetch();
    return this.loop;
  }

  // ── Mesajlar ──

  say(content) {
    return this.textChannel?.send({ content, allowedMentions: { parse: [] } }).catch(() => null);
  }

  nowPlayingEmbed() {
    const t = this.current;
    if (!t) return kariaEmbed(null, 'Müzik').setDescription('Şu an bir şey çalmıyor.');
    const pos = this.position;
    const bar = t.duration ? progress(pos, t.duration) : `${e('nokta_kirmizi', '🔴')} CANLI`;
    const embed = kariaEmbed(null, this.paused ? 'Duraklatıldı' : 'Şimdi Çalıyor')
      .setTitle(t.title.slice(0, 250))
      .setURL(/^https?:\/\//.test(t.url ?? '') ? t.url : null)
      .setDescription(`${t.uploader ? `${e('mikrofon', '🎤')} **${t.uploader}** · ` : ''}<@${t.requesterId}> istedi\n\n${bar} \`${formatTime(pos)} / ${formatTime(t.duration)}\``)
      .addFields(
        { name: `${e('pano', '📃')} Sıra`, value: `**${this.tracks.length}** şarkı`, inline: true },
        { name: `${e('kulaklik', '🔊')} Ses`, value: `**%${this.volume}**`, inline: true },
        { name: `${e('yenile', '🔁')} Döngü`, value: `**${LOOP_NAMES[this.loop]}**`, inline: true },
      );
    if (this.filter !== 'off') embed.addFields({ name: `${FILTERS[this.filter].emoji} Filtre`, value: `**${FILTERS[this.filter].label}**`, inline: true });
    if (t.thumbnail) embed.setThumbnail(t.thumbnail);
    return embed;
  }

  controls(disabled = false) {
    const b = (id, emoji, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`muzik:${id}`).setEmoji(emoji).setStyle(style).setDisabled(disabled);
    const rows = [
      new ActionRowBuilder().addComponents(
        b('duraklat', this.paused ? e('oynat', '▶️') : e('duraklat', '⏸️'), ButtonStyle.Primary),
        b('gec', e('atla', '⏭️')),
        b('dur', e('durdur', '⏹️'), ButtonStyle.Danger),
        b('dongu', this.loop === 'off' ? e('ok', '➡️') : e('yenile', this.loop === 'track' ? '🔂' : '🔁'), this.loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success),
        b('karistir', e('karistir', '🔀')),
      ),
    ];
    if (this.filtersAvailable) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('muzik:filtre')
            .setPlaceholder('Ses filtresi')
            .setDisabled(disabled)
            .addOptions(Object.entries(FILTERS).map(([value, f]) => ({ label: f.label, value, description: f.description, emoji: f.emoji, default: value === this.filter }))),
        ),
      );
    }
    return rows;
  }

  async sendPanel() {
    await this.disablePanel();
    this.panel = await this.textChannel
      ?.send({ embeds: [this.nowPlayingEmbed()], components: this.controls(), allowedMentions: { parse: [] } })
      .catch(() => null);
  }

  async refreshPanel() {
    await this.panel?.edit({ embeds: [this.nowPlayingEmbed()], components: this.controls() }).catch(() => {});
  }

  async disablePanel() {
    const panel = this.panel;
    this.panel = null;
    await panel?.edit({ components: this.controls(true) }).catch(() => {});
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.prefetchTimer);
    clearTimeout(this.idleTimer);
    clearTimeout(this.aloneTimer);
    clearTimeout(this.lostTimer);
    this.tracks = [];
    this.current = null;
    this.engine.destroy();
    this.disablePanel();
    queues.delete(this.guild.id);
  }
}

// Lavalink koparsa kısa bir süre beklenir (yeniden başlarsa şarkı kaldığı yerden sürer); dönmezse yt-dlp'ye geçilir
lavalinkEvents.on('down', () => {
  for (const queue of queues.values()) {
    if (!(queue.engine instanceof LavalinkEngine) || queue.lostTimer) continue;
    queue.lostTimer = setTimeout(() => {
      queue.lostTimer = null;
      queue.fallback();
    }, LAVALINK_GRACE);
  }
});
lavalinkEvents.on('up', () => {
  for (const queue of queues.values()) {
    clearTimeout(queue.lostTimer);
    queue.lostTimer = null;
  }
});

export const LOOP_NAMES = { off: 'kapalı', track: 'şarkı', queue: 'sıra' };

function progress(pos, total, width = 16) {
  const at = Math.min(width - 1, Math.floor((pos / total) * width));
  return `${'▬'.repeat(at)}${e('halka', '🔘')}${'▬'.repeat(width - at - 1)}`;
}

// ───────────────────────── Komutlar için ─────────────────────────

/** Üyenin ses kanalını ve (varsa) sırayı kontrol eder */
export function requireVoice(member, { needQueue = true } = {}) {
  const queue = getQueue(member.guild.id);
  const channel = member.voice.channel;
  if (needQueue && !queue?.current) throw new UserError('Şu an bir şey çalmıyor. `/cal` ile başlat.');
  if (!channel) throw new UserError('Önce bir ses kanalına gir.');
  if (queue && queue.channelId !== channel.id && !isStaff(member)) {
    throw new UserError(`Ben şu an <#${queue.channelId}> kanalındayım, orada olmalısın.`);
  }
  return { queue, channel };
}

const humans = (guild, channelId) => guild.channels.cache.get(channelId)?.members.filter((m) => !m.user.bot).size ?? 0;

/** Şarkı ekler, gerekirse kanala katılır */
export async function playQuery(member, textChannel, query) {
  checkVoice(member);
  const { tracks, playlist } = await resolveQuery(query, member.id);
  return playTracks(member, textChannel, tracks, playlist);
}

function checkVoice(member) {
  const { channel } = requireVoice(member, { needQueue: false });
  const perms = channel.permissionsFor(member.guild.members.me);
  if (!perms.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) throw new UserError(`${channel} kanalına bağlanma ya da konuşma iznim yok.`);
}

/** Bilgileri hazır şarkıları (örn. çalma listesinden) aramadan sıraya ekler */
export async function playTracks(member, textChannel, tracks, playlist = true) {
  checkVoice(member);
  const { queue: existing, channel } = requireVoice(member, { needQueue: false });
  let queue = existing;
  if (!queue) {
    queue = new GuildQueue(member.guild, channel, textChannel);
    queue.ready = queue.waitReady();
  }
  await queue.ready; // aynı anda başka biri de eklerse bağlantı bitene kadar bekler
  if (queue.tracks.length >= MAX_QUEUE) throw new UserError(`Sıra dolu (en fazla ${MAX_QUEUE} şarkı).`);
  const wasPlaying = Boolean(queue.current);
  const added = queue.add(tracks);
  return { queue, tracks, added, playlist, wasPlaying };
}

/** Atlama: yetkili, şarkıyı isteyen ya da 2 kişiden az dinleyici varsa direkt; yoksa oylama */
export function voteSkip(member) {
  const { queue } = requireVoice(member);
  const listeners = humans(member.guild, queue.channelId);
  if (isStaff(member) || queue.current.requesterId === member.id || listeners <= 2) {
    queue.skip();
    return { skipped: true };
  }
  queue.skipVotes.add(member.id);
  const needed = Math.ceil(listeners / 2);
  if (queue.skipVotes.size >= needed) {
    queue.skip();
    return { skipped: true, votes: queue.skipVotes.size, needed };
  }
  return { skipped: false, votes: queue.skipVotes.size, needed };
}

/** Önceki şarkıya dönüş: yetkili, şarkıyı isteyen ya da 2 kişiden az dinleyici varsa */
export function goBack(member) {
  const { queue } = requireVoice(member);
  if (!isStaff(member) && queue.current.requesterId !== member.id && humans(member.guild, queue.channelId) > 2) {
    throw new UserError('Başkaları da dinlerken önceki şarkıya sadece yetkililer ya da şarkıyı açan kişi dönebilir.');
  }
  queue.previous();
}

export function stopMusic(member) {
  const { queue } = requireVoice(member, { needQueue: false });
  if (!queue) throw new UserError('Zaten bir ses kanalında değilim.');
  const listeners = humans(member.guild, queue.channelId);
  const ownsAll = [queue.current, ...queue.tracks].filter(Boolean).every((t) => t.requesterId === member.id);
  if (!isStaff(member) && listeners > 2 && !ownsAll) {
    throw new UserError('Başkaları da dinlerken müziği sadece yetkililer durdurabilir. Şarkıyı geçmek için `/gec` ile oylama yap.');
  }
  queue.say(`${e('durdur', '⏹️')} ${member} müziği durdurdu.`);
  queue.destroy();
}

/** Ses durumu değişince: kanalda kimse kalmadıysa bir süre sonra ayrıl */
export function handleMusicVoice(oldState, newState) {
  const queue = getQueue(newState.guild.id);
  if (!queue) return;
  // Bot kanaldan atıldıysa
  if (newState.id === newState.guild.members.me?.id && !newState.channelId) return queue.destroy();
  const count = humans(newState.guild, queue.channelId);
  if (count === 0 && !queue.aloneTimer) {
    queue.aloneTimer = setTimeout(() => {
      queue.say(`${e('mesaj', '👋')} Ses kanalında kimse kalmadığı için ayrıldım.`);
      queue.destroy();
    }, ALONE_LEAVE);
  } else if (count > 0 && queue.aloneTimer) {
    clearTimeout(queue.aloneTimer);
    queue.aloneTimer = null;
  }
}

export function destroyAll() {
  for (const q of queues.values()) q.destroy();
}
process.on('exit', destroyAll);
