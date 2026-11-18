// Lavalink'in kendisi çalamadığı şarkılar için yerel ses köprüsü (YouTube Lavalink'i engellediğinde, SoundCloud).
// Ses bugünkü gibi yt-dlp + ffmpeg ile alınır, Ogg/Opus olarak sadece 127.0.0.1'de sunulur ve Lavalink onu HTTP ile
// çalar; filtreler de çalışır. Lavalink adresi önce yoklar (şarkı bilgisi), sonra çalarken yeniden ister: ses bir kez
// üretilir, sonraki istekte baştan verilir.
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const MAX_BUFFER = 48 * 1024 * 1024; // canlı yayın gibi bitmeyen akışlarda bellek sınırı
const UNUSED_TTL = 2 * 60_000; // Lavalink'in hiç istemediği köprü bu süre sonra kapanır
const relays = new Map(); // anahtar -> Relay
let listening = null;

function listen() {
  listening ??= new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const relay = relays.get(req.url.match(/^\/relay\/([a-f0-9]{32})$/)?.[1]);
      if (!relay || req.method !== 'GET') return res.writeHead(404).end();
      relay.serve(res);
    });
    server.once('error', (error) => {
      listening = null;
      reject(error);
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    server.unref();
  });
  return listening;
}

class Relay {
  constructor(open, port) {
    this.key = randomBytes(16).toString('hex');
    this.url = `http://127.0.0.1:${port}/relay/${this.key}`;
    this.open = open; // () => { stream, kill, error } (music.js openStream)
    this.source = null;
    this.chunks = [];
    this.size = 0;
    this.capped = false;
    this.ended = false;
    this.clients = new Set();
    this.encoded = null; // Lavalink'in bu adres için verdiği şarkı kaydı
    this.timer = setTimeout(() => this.release(), UNUSED_TTL);
    relays.set(this.key, this);
  }

  start() {
    if (this.source) return;
    this.source = this.open();
    this.source.stream.on('data', (chunk) => {
      if (!this.capped) {
        this.chunks.push(chunk);
        this.size += chunk.length;
        if (this.size > MAX_BUFFER) {
          this.capped = true;
          this.chunks = [];
        }
      }
      for (const res of this.clients) res.write(chunk);
    });
    this.source.stream.on('end', () => {
      this.ended = true;
      for (const res of this.clients) res.end();
    });
  }

  get hasAudio() {
    return this.size > 0;
  }

  /** İlk ses gelene ya da akış bitene kadar bekler (Lavalink adresi yoklarken boş beklemesin) */
  firstAudio(timeout = 90_000) {
    this.start();
    if (this.hasAudio || this.ended) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, timeout);
      this.source.stream.once('data', done);
      this.source.stream.once('end', done);
    });
  }

  serve(res) {
    clearTimeout(this.timer);
    this.start();
    res.writeHead(200, { 'Content-Type': 'audio/ogg', 'Cache-Control': 'no-store' });
    for (const chunk of this.chunks) res.write(chunk);
    if (this.ended) return res.end();
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  /** Ses hiç gelmediyse yt-dlp'nin hata satırı */
  error() {
    return this.source?.error() ?? null;
  }

  release() {
    clearTimeout(this.timer);
    relays.delete(this.key);
    this.source?.kill();
    for (const res of this.clients) res.destroy();
    this.clients.clear();
    this.chunks = [];
  }
}

/** open: sesi üreten işlev; çağrılması ilk istekte (ya da firstAudio ile) olur */
export async function createRelay(open) {
  return new Relay(open, await listen());
}
