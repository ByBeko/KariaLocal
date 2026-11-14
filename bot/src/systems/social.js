// Sosyal medya paylaşımı: panele yüklenen tek video aynı başlık ve açıklamayla Instagram, YouTube ve TikTok'a aynı anda gider.
// Hesaplar bir kez bağlanır; anahtarlar şifreli saklanır ve burada kendiliğinden yenilenir, her paylaşımda giriş istenmez.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { db } from '../core/database.js';
import { UserError } from '../utils/errors.js';
import { mailViewHtml, storeMail } from './mailbox.js';

const BASE_URL = (process.env.SOCIAL_BASE_URL || 'https://activity.karia.live').replace(/\/$/, '');
const VIDEO_DIR = path.join(process.env.KARIA_DATA_DIR || path.join(import.meta.dirname, '..', '..', 'data'), 'social-videos');
mkdirSync(VIDEO_DIR, { recursive: true });

export const MAX_VIDEO = 1024 ** 3;
const UPLOAD_CHUNK = 20 * 1024 * 1024; // Cloudflare istek başına 100 MB'tan fazlasını almaz
const YOUTUBE_CHUNK = 8 * 1024 * 1024; // YouTube 256 KB'ın katlarını ister
const TIKTOK_CHUNK = 10 * 1024 * 1024;
const MAX_TITLE = 100; // YouTube sınırı; Instagram ve TikTok'ta başlık açıklamayla birleşir
const MAX_DESCRIPTION = 2000;
const POLL_EVERY = 15_000;
const POLL_LIMIT = 15 * 60_000;
const STATE_TTL = 15 * 60_000;
const UPLOAD_TTL = 6 * 3600_000;
const KEEP_FAILED = 3 * 24 * 3600_000;
const HOUR = 3600_000;
const NEVER = 253402300799000; // 9999-12-31: süresi dolmayan anahtarlar için
// Yeni Meta uygulamaları Instagram'a "Unified Login" (Facebook Login for Business, sistem kullanıcısı) ile bağlanır
const IG_API = 'https://graph.facebook.com/v27.0';
const TT_API = 'https://open.tiktokapis.com/v2';

db.exec(`
  CREATE TABLE IF NOT EXISTS social_accounts (
    platform     TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL,
    name         TEXT NOT NULL,
    secrets      TEXT NOT NULL,
    expires_at   INTEGER NOT NULL,
    broken       INTEGER NOT NULL DEFAULT 0,
    connected_by TEXT NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS social_posts (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    file        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    results     TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
`);
// Platforma özel paylaşım seçimleri (TikTok gizlilik, etkileşim, ticari içerik); yeniden denemede aynısı kullanılır
if (!db.prepare('PRAGMA table_info(social_posts)').all().some((c) => c.name === 'options')) {
  db.exec("ALTER TABLE social_posts ADD COLUMN options TEXT NOT NULL DEFAULT '{}'");
}

// ── Anahtarların saklanması ──
const cipherKey = () => createHash('sha256').update(process.env.SOCIAL_TOKEN_KEY ?? '').digest();

function seal(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cipherKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

function unseal(text) {
  const raw = Buffer.from(text, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', cipherKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
}

const getAccount = (platform) => db.prepare('SELECT * FROM social_accounts WHERE platform = ?').get(platform);

function saveAccount(platform, { accountId, name, secrets, expiresAt, connectedBy }) {
  db.prepare(`INSERT INTO social_accounts (platform, account_id, name, secrets, expires_at, broken, connected_by, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(platform) DO UPDATE SET account_id = excluded.account_id, name = excluded.name, secrets = excluded.secrets, expires_at = excluded.expires_at, broken = 0, connected_by = excluded.connected_by, updated_at = excluded.updated_at`)
    .run(platform, accountId, name, seal(secrets), expiresAt, connectedBy, Date.now());
}

// ── Platform istekleri ──
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function errorText(data, status) {
  const error = data?.error;
  const text = (typeof error === 'object' ? error?.message || error?.code : error) || data?.error_description || data?.message;
  return String(text || `HTTP ${status}`).slice(0, 300);
}

async function request(url, options = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000), ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new ApiError(errorText(data, res.status), res.status);
    error.data = data; // Platformun hata kodu (ör. TikTok error.code) kaybolmasın
    throw error;
  }
  return data;
}

const form = (fields) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
const redirectUri = (platform) => `${BASE_URL}/social/callback/${platform}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Geçici ağ ve sunucu hatalarında aynı parça yeniden gönderilir */
async function withRetry(action, tries = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= tries || (error instanceof ApiError && error.status < 500 && error.status !== 429)) throw error;
      await sleep(attempt * 2000);
    }
  }
}

async function readPart(file, start, length) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// ── Instagram ──
const mediaLinks = new Map();

/** Girişte seçilen Instagram hesabı: önce atanan hesaplar, boşsa token'ın izin verdiği hesap kimliği */
async function instagramAccount(accessToken, headers) {
  const assigned = await request(`${IG_API}/me/assigned_instagram_accounts?fields=id,username`, { headers }).catch(() => ({}));
  if (assigned.data?.length) return assigned.data[0];
  const appToken = `${process.env.INSTAGRAM_APP_ID}|${process.env.INSTAGRAM_APP_SECRET}`;
  const debug = await request(`${IG_API}/debug_token?${new URLSearchParams({ input_token: accessToken, access_token: appToken })}`);
  const scopes = debug.data?.granular_scopes ?? [];
  const granted = ['instagram_content_publish', 'instagram_basic'].map((name) => scopes.find((s) => s.scope === name)?.target_ids?.[0]).find(Boolean);
  if (granted) {
    const info = await request(`${IG_API}/${granted}?fields=id,username`, { headers }).catch(() => ({ id: granted }));
    return { id: String(info.id ?? granted), username: info.username };
  }
  // Meta bazı sistem kullanıcısı anahtarlarında hesabı listelemiyor: ayardaki kimlik bu anahtarla okunabiliyorsa o kullanılır
  const fallback = process.env.INSTAGRAM_ACCOUNT_ID;
  if (fallback) {
    const info = await request(`${IG_API}/${encodeURIComponent(fallback)}?fields=id,username`, { headers }).catch((error) => {
      console.warn(`[Sosyal] instagram yedek hesap okunamadı: ${safeError(error)}`);
      return null;
    });
    if (info?.id) return { id: String(info.id), username: info.username };
  }
  console.warn(`[Sosyal] instagram izinleri: ${scopes.map((s) => `${s.scope}(${s.target_ids?.length ?? 0})`).join(', ') || 'yok'}`);
  return null;
}

const instagram = {
  label: 'Instagram',
  env: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_CONFIG_ID'],
  refreshBefore: 0, // Sistem kullanıcısı anahtarının süresi dolmaz
  // İzinler Meta'daki yapılandırmadan (config_id) gelir; scope gönderilmez
  authUrl: (state) => `https://www.facebook.com/v27.0/dialog/oauth?${new URLSearchParams({ client_id: process.env.INSTAGRAM_APP_ID, config_id: process.env.INSTAGRAM_CONFIG_ID, redirect_uri: redirectUri('instagram'), response_type: 'code', override_default_response_type: 'true', state })}`,
  async connect(code) {
    const token = await request(`${IG_API}/oauth/access_token?${new URLSearchParams({ client_id: process.env.INSTAGRAM_APP_ID, client_secret: process.env.INSTAGRAM_APP_SECRET, redirect_uri: redirectUri('instagram'), code })}`);
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const ig = await instagramAccount(token.access_token, headers);
    if (!ig) throw new UserError('Girişte bir Instagram hesabı seçilmedi. Yeniden bağlanıp @karia.live hesabını seç.');
    return { accountId: String(ig.id), name: ig.username ? `@${ig.username}` : 'Instagram', secrets: { access: token.access_token }, expiresAt: NEVER };
  },
  async refresh(secrets) {
    return { secrets, expiresAt: NEVER };
  },
  async publish(job) {
    const { account, secrets } = await session('instagram');
    const headers = { Authorization: `Bearer ${secrets.access}`, 'Content-Type': 'application/json' };
    // Instagram girişli uygulamalarda video yalnızca herkese açık adresten alınır: adres tahmin edilemez ve paylaşım bitince kapanır
    const link = randomBytes(32).toString('hex');
    mediaLinks.set(link, { file: job.file, mime: job.mime, size: job.size });
    try {
      const container = await request(`${IG_API}/${account.account_id}/media`, { method: 'POST', headers, body: JSON.stringify({ media_type: 'REELS', video_url: `${BASE_URL}/social/media/${link}.mp4`, caption: job.caption, share_to_feed: true }) });
      const deadline = Date.now() + POLL_LIMIT;
      for (;;) {
        const { status_code: status } = await withRetry(() => request(`${IG_API}/${container.id}?fields=status_code`, { headers }));
        if (status === 'FINISHED') break;
        if (status === 'ERROR' || status === 'EXPIRED') throw new Error('Instagram videoyu işleyemedi. Biçimi MP4 (H.264/AAC) ve süresi 3 sn - 15 dk olmalı.');
        if (Date.now() > deadline) throw new Error('Instagram videoyu zamanında işleyemedi.');
        await sleep(POLL_EVERY);
      }
      const media = await request(`${IG_API}/${account.account_id}/media_publish`, { method: 'POST', headers, body: JSON.stringify({ creation_id: container.id }) });
      const info = await request(`${IG_API}/${media.id}?fields=permalink`, { headers }).catch(() => ({}));
      return { url: info.permalink ?? null };
    } finally {
      mediaLinks.delete(link);
    }
  },
};

// ── YouTube ──
const youtube = {
  label: 'YouTube',
  env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  audited: 'YOUTUBE_AUDITED',
  limitNote: 'YouTube API denetimi tamamlanana kadar video gizli kalır.',
  refreshBefore: 2 * 60_000,
  authUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri('youtube'), response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly', access_type: 'offline', prompt: 'consent', state })}`,
  async connect(code) {
    const token = await request('https://oauth2.googleapis.com/token', form({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: 'authorization_code', redirect_uri: redirectUri('youtube'), code }));
    if (!token.refresh_token) throw new Error('Google kalıcı izin vermedi. Bağlantıyı Google hesabından kaldırıp yeniden dene.');
    const { items } = await request('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!items?.length) throw new Error('Bu Google hesabında YouTube kanalı yok.');
    return { accountId: items[0].id, name: items[0].snippet.title, secrets: { access: token.access_token, refresh: token.refresh_token }, expiresAt: Date.now() + token.expires_in * 1000 };
  },
  async refresh(secrets) {
    const token = await request('https://oauth2.googleapis.com/token', form({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: secrets.refresh }));
    return { secrets: { access: token.access_token, refresh: token.refresh_token ?? secrets.refresh }, expiresAt: Date.now() + token.expires_in * 1000 };
  },
  async publish(job) {
    const auth = async () => ({ Authorization: `Bearer ${(await session('youtube')).secrets.access}` });
    const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: { ...(await auth()), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(job.size), 'X-Upload-Content-Type': job.mime },
      body: JSON.stringify({ snippet: { title: job.title, description: job.description, categoryId: '22' }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!start.ok) throw new ApiError(errorText(await start.json().catch(() => ({})), start.status), start.status);
    const location = start.headers.get('location');
    for (let offset = 0; ;) {
      const part = await readPart(job.file, offset, Math.min(YOUTUBE_CHUNK, job.size - offset));
      const sent = await withRetry(async () => {
        const res = await fetch(location, { method: 'PUT', headers: { ...(await auth()), 'Content-Type': job.mime, 'Content-Range': `bytes ${offset}-${offset + part.length - 1}/${job.size}` }, body: part, signal: AbortSignal.timeout(300_000) });
        if (res.status === 308) return { next: Number(res.headers.get('range')?.match(/-(\d+)$/)?.[1] ?? -1) + 1 };
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new ApiError(errorText(data, res.status), res.status);
        return { video: data };
      });
      if (sent.video) {
        const hidden = sent.video.status?.privacyStatus !== 'public' || !process.env.YOUTUBE_AUDITED;
        return { url: `https://youtu.be/${sent.video.id}`, note: hidden ? youtube.limitNote : null };
      }
      offset = sent.next;
    }
  },
};

// ── TikTok ──
// TikTok'un İngilizce ve genel hata metinleri yerine yapılacak işi söyleyen açıklamalar
const TIKTOK_ERRORS = {
  unaudited_client_can_only_post_to_private_accounts: 'TikTok denetimi bitene kadar paylaşım için hesabın gizli olması gerekiyor: TikTok > Profil > Ayarlar > Gizlilik > Gizli hesap.',
  privacy_level_option_mismatch: 'Seçilen gizlilik bu TikTok hesabında kullanılamıyor, yeniden seç.',
  spam_risk_too_many_posts: 'TikTok bu hesap için günlük paylaşım sınırına ulaşıldığını söylüyor, daha sonra yeniden dene.',
  spam_risk_user_banned_from_posting: 'TikTok bu hesabın paylaşım yapmasını şu an engelliyor.',
  reached_active_user_cap: 'TikTok uygulamanın günlük kullanıcı sınırına ulaşıldı, yarın yeniden dene.',
  url_ownership_unverified: 'TikTok video adresinin sahipliğini doğrulayamadı.',
};

async function tiktokCall(endpoint, token, body) {
  const data = await request(`${TT_API}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body ?? {}) }).catch((error) => {
    // HTTP hata durumunda da TikTok gövdesinde kod döner; kod biliniyorsa açıklamaya çevrilir
    const code = error.data?.error?.code;
    if (code && code !== 'ok') throw new ApiError(TIKTOK_ERRORS[code] ?? `${error.message} (${code})`, error.status ?? 400);
    throw error;
  });
  const code = data.error?.code;
  if (code && code !== 'ok') throw new ApiError(TIKTOK_ERRORS[code] ?? `${data.error.message || code} (${code})`, 400);
  return data.data;
}

const tiktok = {
  label: 'TikTok',
  env: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
  audited: 'TIKTOK_AUDITED',
  limitNote: 'TikTok denetimi tamamlanana kadar video yalnızca hesap sahibine görünür ve hesap gizli olmalıdır.',
  refreshBefore: 2 * 60_000,
  authUrl: (state) => `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY, redirect_uri: redirectUri('tiktok'), response_type: 'code', scope: 'user.info.basic,video.publish', state })}`,
  async connect(code) {
    const token = await request(`${TT_API}/oauth/token/`, form({ client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, grant_type: 'authorization_code', redirect_uri: redirectUri('tiktok'), code }));
    if (!token.access_token) throw new Error(errorText(token, 400));
    const info = await request(`${TT_API}/user/info/?fields=open_id,display_name`, { headers: { Authorization: `Bearer ${token.access_token}` } });
    return { accountId: token.open_id, name: info.data?.user?.display_name ?? 'TikTok', secrets: { access: token.access_token, refresh: token.refresh_token }, expiresAt: Date.now() + token.expires_in * 1000 };
  },
  async refresh(secrets) {
    const token = await request(`${TT_API}/oauth/token/`, form({ client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: secrets.refresh }));
    if (!token.access_token) throw new ApiError(errorText(token, 400), 400);
    return { secrets: { access: token.access_token, refresh: token.refresh_token ?? secrets.refresh }, expiresAt: Date.now() + token.expires_in * 1000 };
  },
  async publish(job) {
    const access = (await session('tiktok')).secrets.access;
    const creator = await tiktokCall('/post/publish/creator_info/query/', access);
    const pick = job.tiktok;
    if (!pick?.privacy) throw new Error('TikTok gizlilik seçimi yapılmamış.');
    // Seçenekler paylaşım anında yeniden kontrol edilir: TikTok hesabın izinleri bu arada değişmiş olabilir
    if (!creator.privacy_level_options?.includes(pick.privacy)) throw new Error('Seçilen gizlilik bu TikTok hesabında artık kullanılamıyor, yeniden seç.');
    if (!process.env.TIKTOK_AUDITED && pick.privacy !== 'SELF_ONLY') throw new Error('TikTok denetimi bitene kadar yalnızca "Yalnızca ben" seçilebilir.');
    const chunkSize = job.size <= TIKTOK_CHUNK ? job.size : TIKTOK_CHUNK;
    const chunks = Math.floor(job.size / chunkSize);
    const init = await tiktokCall('/post/publish/video/init/', access, {
      post_info: {
        title: job.caption,
        privacy_level: pick.privacy,
        disable_comment: creator.comment_disabled || !pick.comment,
        disable_duet: creator.duet_disabled || !pick.duet,
        disable_stitch: creator.stitch_disabled || !pick.stitch,
        brand_organic_toggle: Boolean(pick.yourBrand),
        brand_content_toggle: Boolean(pick.branded),
      },
      source_info: { source: 'FILE_UPLOAD', video_size: job.size, chunk_size: chunkSize, total_chunk_count: chunks },
    });
    for (let index = 0; index < chunks; index += 1) {
      const from = index * chunkSize;
      const length = index === chunks - 1 ? job.size - from : chunkSize;
      const part = await readPart(job.file, from, length);
      await withRetry(async () => {
        const res = await fetch(init.upload_url, { method: 'PUT', headers: { 'Content-Type': job.mime, 'Content-Range': `bytes ${from}-${from + length - 1}/${job.size}` }, body: part, signal: AbortSignal.timeout(300_000) });
        if (!res.ok) throw new ApiError(`TikTok parçayı almadı (HTTP ${res.status}).`, res.status);
      });
    }
    const deadline = Date.now() + POLL_LIMIT;
    for (;;) {
      const state = await withRetry(() => tiktokCall('/post/publish/status/fetch/', access, { publish_id: init.publish_id }));
      if (state.status === 'PUBLISH_COMPLETE') {
        const postId = state.publicaly_available_post_id?.[0];
        return { url: postId && creator.creator_username ? `https://www.tiktok.com/@${creator.creator_username}/video/${postId}` : null, note: process.env.TIKTOK_AUDITED ? null : tiktok.limitNote };
      }
      if (state.status === 'FAILED') throw new Error(`TikTok paylaşımı reddetti: ${state.fail_reason ?? 'bilinmeyen neden'}`);
      if (Date.now() > deadline) throw new Error('TikTok videoyu zamanında işleyemedi.');
      await sleep(POLL_EVERY);
    }
  },
};

const PLATFORMS = { instagram, youtube, tiktok };

const isReady = (platform) => Boolean(process.env.SOCIAL_TOKEN_KEY) && PLATFORMS[platform].env.every((name) => process.env[name]);

// ── Oturum yenileme ──
const refreshing = new Map();

async function refreshAccount(platform, account) {
  const secrets = unseal(account.secrets);
  try {
    const fresh = await PLATFORMS[platform].refresh(secrets);
    db.prepare('UPDATE social_accounts SET secrets = ?, expires_at = ?, broken = 0, updated_at = ? WHERE platform = ?').run(seal(fresh.secrets), fresh.expiresAt, Date.now(), platform);
  } catch (error) {
    // Ağ hatasında bağlantı bozulmuş sayılmaz; yalnızca platform anahtarı reddederse yeniden bağlamak gerekir
    if (error instanceof ApiError && [400, 401].includes(error.status) && account.expires_at <= Date.now()) {
      db.prepare('UPDATE social_accounts SET broken = 1 WHERE platform = ?').run(platform);
    }
    if (account.expires_at <= Date.now()) throw error;
    console.warn(`[Sosyal] ${platform} anahtarı uzatılamadı: ${error.message}`);
  }
}

/** Geçerli anahtarı verir; süresi yaklaşmışsa önce yeniler */
async function session(platform) {
  let account = getAccount(platform);
  if (!account) throw new Error('Hesap bağlı değil.');
  if (account.expires_at - Date.now() < PLATFORMS[platform].refreshBefore) {
    if (!refreshing.has(platform)) refreshing.set(platform, refreshAccount(platform, account).finally(() => refreshing.delete(platform)));
    await refreshing.get(platform);
    account = getAccount(platform);
  }
  return { account, secrets: unseal(account.secrets) };
}

// ── Hesap bağlama ──
const connectStates = new Map();

export function startConnect(memberId, platform) {
  if (!PLATFORMS[platform]) throw new UserError('Geçersiz platform.');
  if (!isReady(platform)) throw new UserError(`${PLATFORMS[platform].label} için geliştirici anahtarları henüz girilmedi.`);
  const state = randomBytes(24).toString('hex');
  connectStates.set(state, { platform, memberId, expires: Date.now() + STATE_TTL });
  return { url: PLATFORMS[platform].authUrl(state) };
}

export function disconnect(platform) {
  if (!PLATFORMS[platform]) throw new UserError('Geçersiz platform.');
  db.prepare('DELETE FROM social_accounts WHERE platform = ?').run(platform);
}

// ── Video yükleme ──
const uploads = new Map();
const uploadTokens = new Map();

function dropUpload(upload, keepFile = false) {
  uploads.delete(upload.id);
  uploadTokens.delete(upload.token);
  if (!keepFile) rmSync(upload.file, { force: true });
}

export function beginUpload(memberId, { name, size }) {
  const bytes = Number(size);
  const match = String(name ?? '').match(/\.(mp4|mov)$/i);
  if (!match) throw new UserError('Yalnızca MP4 veya MOV video yüklenebilir.');
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new UserError('Dosya okunamadı.');
  if (bytes > MAX_VIDEO) throw new UserError('Video en çok 1 GB olabilir.');
  // Üye başına tek yarım yükleme kalır
  for (const upload of [...uploads.values()]) if (upload.memberId === memberId) dropUpload(upload);
  const id = randomBytes(12).toString('hex');
  const token = randomBytes(32).toString('hex');
  const extension = match[1].toLowerCase();
  const upload = { id, token, memberId, size: bytes, received: 0, busy: false, mime: extension === 'mov' ? 'video/quicktime' : 'video/mp4', file: path.join(VIDEO_DIR, `${id}.${extension}`), touched: Date.now() };
  uploads.set(id, upload);
  uploadTokens.set(token, upload);
  return { id, token, chunkSize: UPLOAD_CHUNK };
}

async function hasVideoHeader(file) {
  const head = await readPart(file, 0, 12);
  return ['ftyp', 'moov', 'wide', 'mdat', 'free'].includes(head.subarray(4, 8).toString('latin1'));
}

// ── Paylaşım ──
const getPost = (id) => db.prepare('SELECT * FROM social_posts WHERE id = ?').get(id);

function setResult(id, platform, result) {
  const post = getPost(id);
  const results = JSON.parse(post.results);
  results[platform] = result;
  db.prepare('UPDATE social_posts SET results = ? WHERE id = ?').run(JSON.stringify(results), id);
}

const safeError = (error) => String(error?.message || 'Bilinmeyen hata').replace(/(access_token|client_secret|refresh_token)=[^&\s]+/gi, '$1=***').slice(0, 300);

async function runPost(id, platforms) {
  const post = getPost(id);
  const options = JSON.parse(post.options || '{}');
  const job = { file: post.file, mime: post.mime, size: post.size, title: post.title, description: post.description, caption: [post.title, post.description].filter(Boolean).join('\n\n'), tiktok: options.tiktok };
  await Promise.all(platforms.map(async (platform) => {
    setResult(id, platform, { status: 'running' });
    try {
      const { url = null, note = null } = await PLATFORMS[platform].publish(job);
      setResult(id, platform, { status: 'done', url, note });
    } catch (error) {
      console.error(`[Sosyal] ${platform} paylaşımı başarısız: ${safeError(error)}`);
      setResult(id, platform, { status: 'failed', error: safeError(error) });
    }
  }));
  const results = Object.values(JSON.parse(getPost(id).results));
  if (results.every((r) => r.status === 'done')) rmSync(post.file, { force: true });
}

const TIKTOK_PRIVACY = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];

/** TikTok paylaşım kuralları: gizlilik elle seçilir, ticari içerik açıksa türü belirtilir, markalı içerik gizli olamaz */
function tiktokChoice(raw = {}) {
  const privacy = String(raw.privacy ?? '');
  if (!TIKTOK_PRIVACY.includes(privacy)) throw new UserError('TikTok için kimlerin görebileceğini seç.');
  const commercial = Boolean(raw.commercial);
  const yourBrand = commercial && Boolean(raw.yourBrand);
  const branded = commercial && Boolean(raw.branded);
  if (commercial && !yourBrand && !branded) throw new UserError('Ticari içerikte "Kendi markan" ya da "Markalı içerik" seçeneklerinden en az birini işaretle.');
  if (branded && privacy === 'SELF_ONLY') throw new UserError('Markalı içerik "Yalnızca ben" olarak paylaşılamaz; gizliliği değiştir.');
  return { privacy, comment: Boolean(raw.comment), duet: Boolean(raw.duet), stitch: Boolean(raw.stitch), yourBrand, branded };
}

/** Panelde TikTok ayarları için hesabın güncel bilgisi: takma ad, izin verilen gizlilikler, kapalı etkileşimler, süre sınırı */
export async function tiktokCreator() {
  const account = getAccount('tiktok');
  if (!account || account.broken) throw new UserError('TikTok hesabı bağlı değil.');
  const creator = await tiktokCall('/post/publish/creator_info/query/', (await session('tiktok')).secrets.access);
  return {
    nickname: creator.creator_nickname ?? account.name,
    username: creator.creator_username ?? null,
    avatar: creator.creator_avatar_url ?? null,
    // Denetimden geçmemiş uygulama yalnızca "Yalnızca ben" paylaşabilir; diğerleri TikTok'ta hata verir
    privacyOptions: (creator.privacy_level_options ?? []).filter((p) => TIKTOK_PRIVACY.includes(p) && (process.env.TIKTOK_AUDITED || p === 'SELF_ONLY')),
    audited: Boolean(process.env.TIKTOK_AUDITED),
    commentDisabled: Boolean(creator.comment_disabled),
    duetDisabled: Boolean(creator.duet_disabled),
    stitchDisabled: Boolean(creator.stitch_disabled),
    maxDuration: Number(creator.max_video_post_duration_sec) || null,
  };
}

export async function publishVideo(memberId, body) {
  const upload = uploads.get(String(body.id ?? ''));
  if (!upload || upload.memberId !== memberId) throw new UserError('Video bulunamadı, yeniden yükle.');
  if (upload.received !== upload.size) throw new UserError('Video henüz tam yüklenmedi.');
  const title = String(body.title ?? '').trim();
  const description = String(body.description ?? '').trim();
  if (!title) throw new UserError('Başlık yaz.');
  if (title.length > MAX_TITLE) throw new UserError(`Başlık en çok ${MAX_TITLE} karakter olabilir.`);
  if (/[<>]/.test(title)) throw new UserError('YouTube başlıkta < ve > işaretlerini kabul etmiyor.');
  if (description.length > MAX_DESCRIPTION) throw new UserError(`Açıklama en çok ${MAX_DESCRIPTION} karakter olabilir.`);
  const platforms = [...new Set(Array.isArray(body.platforms) ? body.platforms.map(String) : [])];
  if (!platforms.length) throw new UserError('En az bir platform seç.');
  for (const platform of platforms) {
    const account = PLATFORMS[platform] && getAccount(platform);
    if (!account) throw new UserError('Seçilen hesaplardan biri bağlı değil.');
    if (account.broken) throw new UserError(`${PLATFORMS[platform].label} hesabını yeniden bağla.`);
  }
  const options = platforms.includes('tiktok') ? { tiktok: tiktokChoice(body.tiktok) } : {};
  if (!(await hasVideoHeader(upload.file))) {
    dropUpload(upload);
    throw new UserError('Bu dosya geçerli bir video değil.');
  }
  dropUpload(upload, true); // Çift tıklama aynı videoyu iki kez paylaşamasın
  const results = Object.fromEntries(platforms.map((p) => [p, { status: 'pending' }]));
  db.prepare('INSERT INTO social_posts (id, title, description, file, mime, size, results, options, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(upload.id, title, description, upload.file, upload.mime, upload.size, JSON.stringify(results), JSON.stringify(options), memberId, Date.now());
  runPost(upload.id, platforms).catch((error) => console.error('[Sosyal]', safeError(error)));
  return { title, platforms: platforms.map((p) => PLATFORMS[p].label) };
}

function fileExists(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Yalnızca başarısız platformlar yeniden denenir; başarılı olanlarda ikinci kez paylaşılmaz */
export function retryPost(id) {
  const post = getPost(String(id ?? ''));
  if (!post) throw new UserError('Paylaşım bulunamadı.');
  if (!fileExists(post.file)) throw new UserError('Videonun süresi doldu, yeniden yükle.');
  const results = JSON.parse(post.results);
  const failed = Object.keys(results).filter((p) => results[p].status === 'failed');
  if (!failed.length) throw new UserError('Yeniden denenecek platform yok.');
  for (const platform of failed) if (!getAccount(platform) || getAccount(platform).broken) throw new UserError(`${PLATFORMS[platform].label} hesabını yeniden bağla.`);
  for (const platform of failed) setResult(post.id, platform, { status: 'pending' });
  runPost(post.id, failed).catch((error) => console.error('[Sosyal]', safeError(error)));
  return { platforms: failed.map((p) => PLATFORMS[p].label) };
}

/** Paylaşım kaydı ve sunucudaki video dosyası silinir; platformlarda yayınlanmış videolara dokunulmaz */
export function deletePost(id) {
  const post = getPost(String(id ?? ''));
  if (!post) throw new UserError('Paylaşım bulunamadı.');
  const results = Object.values(JSON.parse(post.results));
  if (results.some((r) => r.status === 'pending' || r.status === 'running')) throw new UserError('Paylaşım sürerken silinemez, bitmesini bekle.');
  rmSync(post.file, { force: true });
  db.prepare('DELETE FROM social_posts WHERE id = ?').run(post.id);
  return { title: post.title };
}

export function socialView() {
  const accounts = Object.entries(PLATFORMS).map(([platform, info]) => {
    const account = getAccount(platform);
    return {
      platform,
      label: info.label,
      ready: isReady(platform),
      name: account?.name ?? null,
      broken: Boolean(account?.broken),
      limit: account && info.audited && !process.env[info.audited] ? info.limitNote : null,
    };
  });
  const posts = db.prepare('SELECT * FROM social_posts ORDER BY created_at DESC LIMIT 20').all().map((post) => {
    const results = JSON.parse(post.results);
    return {
      id: post.id,
      title: post.title,
      at: post.created_at,
      results: Object.entries(results).map(([platform, result]) => ({ platform, label: PLATFORMS[platform]?.label ?? platform, ...result })),
      canRetry: Object.values(results).some((r) => r.status === 'failed') && fileExists(post.file),
    };
  });
  return { accounts, posts, maxTitle: MAX_TITLE, maxDescription: MAX_DESCRIPTION };
}

// ── Tünelden doğrudan gelen istekler: bağlanma dönüşü, video parçaları, Instagram'ın indireceği adres ──
function page(res, status, title, text) {
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#08090b;color:#f0f3f4;font:16px system-ui;text-align:center;padding:16px"><main><h1 style="font-size:22px;color:#4fcfb4">${escape(title)}</h1><p>${escape(text)}</p></main></body>`);
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function handleCallback(res, platform, query) {
  const state = query.get('state');
  const saved = state && connectStates.get(state);
  if (state) connectStates.delete(state);
  if (!saved || saved.platform !== platform || saved.expires < Date.now()) return page(res, 400, 'Bağlantı kurulamadı', 'Bağlantının süresi dolmuş. Panelden yeniden dene.');
  const code = query.get('code');
  if (!code) return page(res, 400, 'Bağlantı iptal edildi', 'İzin verilmedi. Panelden yeniden deneyebilirsin.');
  try {
    const result = await PLATFORMS[platform].connect(code);
    saveAccount(platform, { ...result, connectedBy: saved.memberId });
    console.log(`[Sosyal] ${platform} hesabı bağlandı: ${result.name}`);
    page(res, 200, `${PLATFORMS[platform].label} bağlandı`, `${result.name} hesabı artık panelden paylaşım yapabilir. Bu sekmeyi kapatabilirsin.`);
  } catch (error) {
    console.error(`[Sosyal] ${platform} bağlantısı başarısız: ${safeError(error)}`);
    // 502 kullanılmaz: Cloudflare 502/504'te bu sayfanın yerine kendi "Bad gateway" sayfasını gösterir
    page(res, error instanceof UserError ? 400 : 500, 'Bağlantı kurulamadı', safeError(error));
  }
}

async function handleChunk(req, res, token, query) {
  const upload = uploadTokens.get(token);
  if (!upload) return json(res, 404, { error: 'Yükleme bulunamadı, yeniden başla.' });
  const offset = Number(query.get('offset'));
  if (upload.busy) return json(res, 409, { error: 'Parça zaten yükleniyor.', received: upload.received });
  if (offset !== upload.received) return json(res, 409, { error: 'Parça sırası uyuşmuyor.', received: upload.received });
  upload.busy = true;
  try {
    const parts = [];
    let length = 0;
    for await (const part of req) {
      length += part.length;
      if (length > UPLOAD_CHUNK || offset + length > upload.size) return json(res, 413, { error: 'Parça çok büyük.' });
      parts.push(part);
    }
    const handle = await open(upload.file, offset === 0 ? 'w' : 'r+');
    try {
      await handle.write(Buffer.concat(parts, length), 0, length, offset);
    } finally {
      await handle.close();
    }
    upload.received += length;
    upload.touched = Date.now();
    json(res, 200, { received: upload.received });
  } finally {
    upload.busy = false;
  }
}

function handleMedia(req, res, link) {
  const media = mediaLinks.get(link);
  if (!media) return json(res, 404, { error: 'Bulunamadı.' });
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = media.size - 1;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), end);
    } else {
      start = Math.max(media.size - Number(range[2]), 0);
    }
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${media.size}` });
      return res.end();
    }
  }
  const partial = Boolean(range && (range[1] || range[2]));
  res.writeHead(partial ? 206 : 200, {
    'Content-Type': media.mime,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${media.size}` } : {}),
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(media.file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

const sha = (text) => createHash('sha256').update(String(text)).digest();
const MAIL_REQUEST_LIMIT = 1_500_000;
// Mail dışarıdan gelir: tarayıcı sandbox kuralıyla betikleri ve form göndermeyi kapatır, panel oturumuna erişemez
const MAIL_VIEW_POLICY = "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:; form-action 'none'";

function handleMailView(res, token) {
  const html = mailViewHtml(token);
  if (!html) return page(res, 404, 'Görüntülenemedi', 'Bu mail bağlantısının süresi doldu. Maili yeniden aç.');
  // Mailin kendi doctype satırı başta kalır, bağlantılar yeni sekmede açılır
  const doctype = html.match(/^\s*<!doctype[^>]*>/i)?.[0] ?? '';
  const head = '<meta charset="utf-8"><base target="_blank"><meta name="referrer" content="no-referrer">';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': MAIL_VIEW_POLICY, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' });
  res.end(doctype + head + html.slice(doctype.length));
}

/** Cloudflare Worker gelen maili buraya bırakır */
async function handleMail(req, res) {
  const secret = process.env.MAIL_WEBHOOK_SECRET;
  if (!secret || !req.headers.authorization || !timingSafeEqual(sha(req.headers.authorization), sha(secret))) return json(res, 401, { error: 'Yetkisiz.' });
  const parts = [];
  let length = 0;
  for await (const part of req) {
    length += part.length;
    if (length > MAIL_REQUEST_LIMIT) return json(res, 413, { error: 'İstek çok büyük.' });
    parts.push(part);
  }
  let mail;
  try {
    mail = JSON.parse(Buffer.concat(parts, length).toString('utf8'));
  } catch {
    return json(res, 400, { error: 'Geçersiz istek.' });
  }
  const { __status, ...result } = storeMail(mail);
  json(res, __status ?? 200, result);
}

/** /social/ altındaki istekleri karşılar; bu yol bot oturumu istemez, her uç kendi anahtarıyla korunur */
export async function socialHttp(req, res, pathname, query) {
  if (req.method === 'POST' && pathname === '/social/mail') return handleMail(req, res);
  const mailView = req.method === 'GET' && pathname.match(/^\/social\/mailview\/([a-f0-9]{64})$/);
  if (mailView) return handleMailView(res, mailView[1]);
  const callback = req.method === 'GET' && pathname.match(/^\/social\/callback\/(instagram|youtube|tiktok)$/);
  if (callback) return handleCallback(res, callback[1], query);
  const chunk = req.method === 'POST' && pathname.match(/^\/social\/upload\/([a-f0-9]{64})$/);
  if (chunk) return handleChunk(req, res, chunk[1], query);
  const media = ['GET', 'HEAD'].includes(req.method) && pathname.match(/^\/social\/media\/([a-f0-9]{64})\.mp4$/);
  if (media) return handleMedia(req, res, media[1]);
  return json(res, 404, { error: 'Bulunamadı.' });
}

// ── Bakım ──
function cleanup() {
  const now = Date.now();
  for (const [state, saved] of connectStates) if (saved.expires < now) connectStates.delete(state);
  for (const upload of [...uploads.values()]) if (now - upload.touched > UPLOAD_TTL) dropUpload(upload);
  const active = new Set([...uploads.values()].map((u) => u.file));
  const running = new Set(db.prepare('SELECT file, results FROM social_posts').all().filter((p) => /"status":"(pending|running)"/.test(p.results)).map((p) => p.file));
  for (const name of readdirSync(VIDEO_DIR)) {
    const file = path.join(VIDEO_DIR, name);
    if (!active.has(file) && !running.has(file) && now - statSync(file).mtimeMs > KEEP_FAILED) rmSync(file, { force: true });
  }
}

async function keepSessionsAlive() {
  for (const { platform } of db.prepare('SELECT platform FROM social_accounts WHERE broken = 0').all()) {
    await session(platform).catch((error) => console.warn(`[Sosyal] ${platform} oturumu yenilenemedi: ${safeError(error)}`));
  }
}

let started = false;

export function startSocial() {
  if (started) return;
  started = true;
  // Bot yarıda kapandıysa platformun durumu bilinemez: kullanıcı kontrol edip yeniden dener
  for (const post of db.prepare('SELECT id, results FROM social_posts').all()) {
    const results = JSON.parse(post.results);
    for (const [platform, result] of Object.entries(results)) {
      if (['pending', 'running'].includes(result.status)) setResult(post.id, platform, { status: 'failed', error: 'Bot paylaşım sırasında yeniden başladı. Yeniden denemeden önce platformda paylaşılıp paylaşılmadığına bak.' });
    }
  }
  if (!process.env.SOCIAL_TOKEN_KEY) return;
  keepSessionsAlive();
  setInterval(() => { try { cleanup(); } catch (error) { console.error('[Sosyal]', error.message); } keepSessionsAlive(); }, 6 * HOUR).unref();
}
