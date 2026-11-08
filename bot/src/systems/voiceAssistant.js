// Sesli asistan: yalnızca /dinle komutunu açan kişiyi dinler. Konuşma bu bilgisayarda yazıya çevrilir,
// Karia yapay zekası cevaplar, cevap yine burada sese dönüşür. Ses dosyaları işlendikten hemen sonra silinir.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import opus from '@discordjs/opus';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource, entersState,
  AudioPlayerStatus, VoiceConnectionStatus, EndBehaviorType, NoSubscriberBehavior,
} from '@discordjs/voice';
import { askAI } from './ai.js';
import { getQueue } from './music.js';
import { UserError } from '../utils/errors.js';

const TOOLS = path.join(import.meta.dirname, '..', '..', 'tools', 'voice');
const WHISPER_DIR = path.join(TOOLS, 'whisper', 'Release');
const WHISPER = path.join(WHISPER_DIR, 'whisper-cli.exe');
const WHISPER_MODEL = path.join(TOOLS, 'modeller', 'ggml-small-q5_1.bin');
const PIPER_DIR = path.join(TOOLS, 'piper', 'piper');
const PIPER = path.join(PIPER_DIR, 'piper.exe');
const PIPER_VOICE = path.join(TOOLS, 'modeller', 'tr_TR-dfki-medium.onnx');

const SILENCE_MS = 900;
const MAX_SPEECH_MS = 20_000;
const MIN_SPEECH_MS = 600;
const MIN_LOUDNESS = 250; // sessizlik ve hışırtı yazıya çevrilmesin
const PROCESS_TIMEOUT = 60_000;
const MAX_SPOKEN = 450;
const WATCH_MS = 5_000;
const PCM_BYTES_PER_MS = 192; // 48 kHz, 2 kanal, 16 bit

// Whisper'ın sessizlikte uydurduğu tipik altyazı cümleleri
const HALLUCINATION = /altyaz[ıi]|izlediğiniz için teşekkür|abone ol|m\.k\.|^\W*(müzik|music)\W*$/;

/** 48 kHz stereo PCM'i Whisper'ın istediği 16 kHz mono WAV'a çevirir. Ortalama ses düzeyini de döner. */
export function pcmToWav(pcm) {
  const frames = Math.floor(pcm.length / 12); // 3 stereo örnek = 1 çıkış örneği
  const data = Buffer.alloc(frames * 2);
  let loudness = 0;
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < 6; c++) sum += pcm.readInt16LE(i * 12 + c * 2);
    const sample = Math.round(sum / 6);
    data.writeInt16LE(sample, i * 2);
    loudness += Math.abs(sample);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return { wav: Buffer.concat([header, data]), loudness: frames ? loudness / frames : 0 };
}

/** Yazıya çevrilen metni temizler; anlamsızsa boş döner. */
export function cleanTranscript(text) {
  const clean = text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length < 2 || HALLUCINATION.test(clean.toLocaleLowerCase('tr')) ? '' : clean;
}

const asciify = (t) => t.toLocaleLowerCase('tr').replaceAll('ı', 'i');

/** "Karia ..." ile başlayan konuşmanın isteğini döner, seslenilmediyse null. */
export function afterWakeWord(text) {
  const match = asciify(text).match(/\bkar[iy]a\b[\s,.!?]*/);
  if (!match) return null;
  return text.slice(match.index + match[0].length).trim();
}

/** Cevabı sesli okunacak hale getirir. */
export function spokenText(text) {
  const clean = text
    .replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_`~#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= MAX_SPOKEN) return clean;
  const cut = clean.slice(0, MAX_SPOKEN);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > 80 ? cut.slice(0, end + 1) : cut;
}

function run(file, args, { cwd, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const out = [];
    const timer = setTimeout(() => child.kill(), PROCESS_TIMEOUT);
    child.stdout.on('data', (d) => out.push(d));
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`${path.basename(file)} ${code} koduyla kapandı`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

const sessions = new Map();

function teardown(session, { keepConnection = false } = {}) {
  if (session.ended) return;
  session.ended = true;
  clearInterval(session.watch);
  session.connection.receiver.speaking.removeListener('start', session.onSpeak);
  session.player.stop(true);
  sessions.delete(session.guild.id);
  if (!keepConnection) session.connection.destroy();
}

async function speak(session, text, dir) {
  const file = path.join(dir, 'cevap.wav');
  await run(PIPER, ['--model', PIPER_VOICE, '--output_file', file], { cwd: PIPER_DIR, input: text });
  if (session.ended) return;
  session.connection.subscribe(session.player);
  session.player.play(createAudioResource(file));
  await entersState(session.player, AudioPlayerStatus.Playing, 10_000);
  await entersState(session.player, AudioPlayerStatus.Idle, 120_000);
}

async function handleSpeech(session, pcm) {
  const { wav, loudness } = pcmToWav(pcm);
  if (loudness < MIN_LOUDNESS) return;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'karia-ses-'));
  try {
    const input = path.join(dir, 'konusma.wav');
    writeFileSync(input, wav);
    const output = await run(WHISPER, ['-m', WHISPER_MODEL, '-f', input, '-l', 'tr', '-nt', '-np', '-t', '4'], { cwd: WHISPER_DIR });
    rmSync(input, { force: true });
    let text = cleanTranscript(output);
    if (text && session.wakeOnly) text = afterWakeWord(text);
    if (!text || session.ended) return;

    const member = await session.guild.members.fetch(session.ownerId);
    const answer = await askAI(session.guild, member, `${text}\n(Sesli sohbet: en fazla iki kısa cümleyle, liste ve emoji kullanmadan cevap ver.)`, {
      historyKey: `ses:${session.ownerId}`,
    });
    const spoken = spokenText(answer);
    if (spoken) await speak(session, spoken, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function capture(session) {
  session.busy = true;
  const decoder = new opus.OpusEncoder(48_000, 2);
  const chunks = [];
  let size = 0;
  const stream = session.connection.receiver.subscribe(session.ownerId, { end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS } });
  const release = () => { session.busy = false; };

  stream.on('data', (packet) => {
    try {
      const pcm = decoder.decode(packet);
      chunks.push(pcm);
      size += pcm.length;
      if (size >= MAX_SPEECH_MS * PCM_BYTES_PER_MS) stream.destroy();
    } catch {
      // Bozuk ses paketi atlanır
    }
  });
  stream.once('error', (error) => { console.error('[Sesli asistan]', error.message); });
  stream.once('close', () => {
    if (session.ended || size < MIN_SPEECH_MS * PCM_BYTES_PER_MS) return release();
    handleSpeech(session, Buffer.concat(chunks))
      .catch((error) => console.error('[Sesli asistan]', error.message))
      .finally(release);
  });
}

export const isListening = (guildId) => sessions.has(guildId);

export async function startListening(member, { wakeOnly = false } = {}) {
  const { guild } = member;
  const channel = member.voice.channel;
  if (!channel) throw new UserError('Önce bir ses kanalına gir.');
  if (sessions.has(guild.id)) throw new UserError('Zaten dinliyorum. Kapatmak için `/dinle durum:Kapat`.');
  if (getQueue(guild.id)?.current) throw new UserError('Müzik çalarken sesli asistan açılamaz. Önce müziği durdur.');
  if (![WHISPER, WHISPER_MODEL, PIPER, PIPER_VOICE].every(existsSync)) throw new UserError('Sesli asistan dosyaları eksik.');

  const connection = joinVoiceChannel({ channelId: channel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false, selfMute: false });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    connection.destroy();
    throw new UserError('Ses kanalına bağlanamadım.');
  }

  const session = {
    guild, connection, ownerId: member.id, channelId: channel.id, wakeOnly, busy: false, ended: false,
    player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } }),
  };
  session.player.on('error', (error) => console.error('[Sesli asistan oynatıcı]', error.message));
  session.onSpeak = (userId) => {
    if (userId === session.ownerId && !session.busy && !session.ended) capture(session);
  };
  connection.receiver.speaking.on('start', session.onSpeak);
  connection.once(VoiceConnectionStatus.Destroyed, () => teardown(session, { keepConnection: true }));
  session.watch = setInterval(() => {
    const current = guild.members.cache.get(session.ownerId)?.voice.channelId;
    if (getQueue(guild.id)?.current) teardown(session, { keepConnection: true }); // bağlantı artık müziğin
    else if (current !== session.channelId) teardown(session);
  }, WATCH_MS);
  sessions.set(guild.id, session);
  return channel;
}

export function stopListening(guild) {
  const session = sessions.get(guild.id);
  if (!session) throw new UserError('Şu an dinlemiyorum.');
  teardown(session);
}
