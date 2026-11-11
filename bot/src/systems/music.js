// Müzik: YouTube (ve SoundCloud) sesi yt-dlp ile indirilir, ffmpeg ile çözülüp Discord ses kanalına aktarılır.
// Her sunucunun tek bir sırası (queue) vardır.
import { spawn, execFile } from 'node:child_process';
import { e } from '../utils/emojis.js';
import { createRequire } from 'node:module';
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
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import ffmpegPath from 'ffmpeg-static';
import { kariaEmbed } from '../utils/embeds.js';
import { UserError } from '../utils/errors.js';
import { isStaff } from '../utils/permissions.js';

const require = createRequire(import.meta.url);
// Sunucuda paketin Python sürümü çalışmayabilir: YOUTUBE_DL_PATH ile tek dosyalık yt-dlp gösterilir
const YTDLP = process.env.YOUTUBE_DL_PATH || require('youtube-dl-exec').constants.YOUTUBE_DL_PATH;

const MAX_QUEUE = 200;
const MAX_PLAYLIST = 100;
const MAX_HISTORY = 20;
const IDLE_LEAVE = 3 * 60_000; // sıra bitince bu kadar bekleyip çık
const ALONE_LEAVE = 60_000; // kanalda kimse kalmayınca
const PREFETCH_AT = 25; // şarkının bitmesine bu kadar saniye kala sıradakini hazırla
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

const trackLink = (t) => `[${t.title.replaceAll('[', '(').replaceAll(']', ')').slice(0, 80)}](${t.url})`;

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
  let args = ['--flat-playlist', '--print', '%(id)s\t%(title)s\t%(duration)s\t%(uploader,channel)s\t%(webpage_url,url)s\t%(live_status)s'];

  if (/^https?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      throw new UserError('Geçersiz link.');
    }
    if (/spotify\.com$/i.test(url.hostname)) throw new UserError('Spotify linkleri çalınamıyor. Şarkının adını yaz, YouTube\'da bulayım.');
    if (!ALLOWED_HOSTS.test(url.hostname)) throw new UserError('Sadece YouTube ve SoundCloud linkleri çalınabilir. Ya da şarkının adını yaz.');
    const isPlaylist = url.searchParams.has('list') && (!url.searchParams.has('v') || url.pathname === '/playlist');
    if (!isPlaylist) args.push('--no-playlist');
    else args.push('--playlist-end', String(MAX_PLAYLIST));
    target = text;
  } else {
    target = `ytsearch1:${text}`;
  }

  const out = await runYtdlp([...args, target]);
  const tracks = out
    .split('\n')
    .filter(Boolean)
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
  return { tracks, playlist: tracks.length > 1 || /[?&]list=/.test(text) };
}

const MAX_ATTEMPTS = 3;

/** YouTube şarkıyı sunucuya vermezse aynı şarkıyı SoundCloud'da arar: önizlemeleri eler, süresi en yakın olanı seçer */
async function soundcloudAlternatives(track) {
  const name = track.title.replace(/[([][^)\]]*(official|resmi|video|audio|lyric|klip)[^)\]]*[)\]]/gi, '').trim();
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

/**
 * yt-dlp → ffmpeg → ham PCM (48 kHz stereo) akışı.
 * YouTube bağlantısı ara sıra SSL hatasıyla düşüyor; hiç ses gelmeden biterse kendiliğinden yeniden dener.
 */
export function openStream(track) {
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
    const ffmpeg = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], {
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
  start();

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
    this.skipVotes = new Set();
    this.panel = null; // "şimdi çalıyor" mesajı
    this.prepared = null; // önceden hazırlanan sıradaki şarkı
    this.active = null; // çalan şarkının süreçleri
    this.forceNext = false;
    this.history = []; // biten şarkılar (önceki şarkıya dönmek için)
    this.goingBack = false;

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
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
        this.destroy();
      }
    });
    this.connection.on(VoiceConnectionStatus.Destroyed, () => this.destroy());

    this.player.on(AudioPlayerStatus.Idle, (old) => {
      if (old.status !== AudioPlayerStatus.Idle) this.onTrackEnd();
    });
    this.player.on(AudioPlayerStatus.Playing, (old) => {
      if (old.status === AudioPlayerStatus.Buffering) this.sendPanel();
    });
    this.player.on('error', (e) => console.error('[Müzik oynatıcı]', e.message));

    this.prefetchTimer = setInterval(() => this.maybePrefetch(), 5_000);
    queues.set(guild.id, this);
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

  async waitReady() {
    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
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
    let source;
    if (this.prepared?.track === track) source = this.prepared.source;
    else {
      this.prepared?.source.kill();
      source = openStream(track);
    }
    this.prepared = null;
    this.active = { track, source, startedAt: Date.now() };
    const resource = createAudioResource(source.stream, { inputType: StreamType.Raw, inlineVolume: true, metadata: track });
    resource.volume.setVolume(this.volume / 100);
    this.player.play(resource);
  }

  onTrackEnd() {
    if (this.destroyed) return;
    const ended = this.active;
    this.active = null;
    ended?.source.kill();
    const finished = this.current;
    if (this.goingBack) { // sıra previous() içinde kuruldu
      this.goingBack = false;
      this.forceNext = false;
      this.playNext();
      return;
    }

    // Kısa sürede hata ile bittiyse (gizli/yaş sınırlı video vb.) haber ver, döngüye alma
    const err = ended?.source.error();
    if (err && Date.now() - ended.startedAt < 15_000) {
      this.say(`${e('unlem', '⚠️')} **${finished?.title ?? 'Şarkı'}** çalınamadı: ${err.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').slice(0, 150)}`);
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

  maybePrefetch() {
    if (this.prepared || !this.current || this.current.live || !this.current.duration) return;
    const next = this.loop === 'track' ? null : this.tracks[0];
    if (!next || next.live) return;
    if (this.current.duration - this.position <= PREFETCH_AT) this.prepared = { track: next, source: openStream(next) };
  }

  /** Sıra değişince (karıştır, sil) önceden hazırlanan şarkı geçersiz olabilir */
  invalidatePrefetch() {
    if (this.prepared && this.prepared.track !== this.tracks[0]) {
      this.prepared.source.kill();
      this.prepared = null;
    }
  }

  skip() {
    this.forceNext = true;
    this.player.stop(true);
  }

  previous() {
    const track = this.history.pop();
    if (!track) throw new UserError('Önceki şarkı yok.');
    const repeated = this.tracks.lastIndexOf(track); // sıra döngüsünde şarkı sona da eklenmişti
    if (repeated >= 0) this.tracks.splice(repeated, 1);
    this.tracks.unshift(track, this.current);
    this.invalidatePrefetch();
    this.goingBack = true;
    this.player.stop(true);
  }

  togglePause() {
    if (this.paused) this.player.unpause();
    else this.player.pause();
    return this.paused;
  }

  setVolume(volume) {
    this.volume = volume;
    this.player.state.resource?.volume?.setVolume(volume / 100);
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
    if (t.thumbnail) embed.setThumbnail(t.thumbnail);
    return embed;
  }

  controls(disabled = false) {
    const b = (id, emoji, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`muzik:${id}`).setEmoji(emoji).setStyle(style).setDisabled(disabled);
    return [
      new ActionRowBuilder().addComponents(
        b('duraklat', this.paused ? e('oynat', '▶️') : e('duraklat', '⏸️'), ButtonStyle.Primary),
        b('gec', e('atla', '⏭️')),
        b('dur', e('durdur', '⏹️'), ButtonStyle.Danger),
        b('dongu', this.loop === 'off' ? e('ok', '➡️') : e('yenile', this.loop === 'track' ? '🔂' : '🔁'), this.loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success),
        b('karistir', e('karistir', '🔀')),
      ),
    ];
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
    this.tracks = [];
    this.current = null;
    this.active?.source.kill();
    this.prepared?.source.kill();
    this.player.stop(true);
    this.disablePanel();
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
    queues.delete(this.guild.id);
  }
}

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
  const { queue: existing, channel } = requireVoice(member, { needQueue: false });
  const me = member.guild.members.me;
  const perms = channel.permissionsFor(me);
  if (!perms.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) throw new UserError(`${channel} kanalına bağlanma ya da konuşma iznim yok.`);

  const { tracks, playlist } = await resolveQuery(query, member.id);
  let queue = existing;
  if (!queue) {
    queue = new GuildQueue(member.guild, channel, textChannel);
    await queue.waitReady();
  }
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
