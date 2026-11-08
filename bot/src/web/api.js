// karia.live sitesinin veri kapısı. Sadece aynı makineden ve paylaşılan anahtarla erişilir.
// Kullanıcıyı site Discord girişiyle doğrular ve X-User-Id ile bildirir; yetki burada, her istekte Discord üyeliğinden okunur.
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import config from '../config.js';
import { UserError } from '../utils/errors.js';
import { plain } from '../activity/server.js';
import { adminRoute, isPanelAdmin } from '../activity/admin.js';
import { getBalance, richBoard } from '../systems/economy.js';
import { getProfile, levelBoard } from '../systems/levels.js';
import { leaderboard, serverStats, userStats } from '../systems/stats.js';
import { getServerStatus, mcEnabled, mcIp } from '../systems/minecraft.js';

const MAX_BODY = 16 * 1024;
const BOARD_SIZE = 15;
const STATS_DAYS = 30;

const digest = (value) => createHash('sha256').update(String(value)).digest();
const sameSecret = (given, secret) => timingSafeEqual(digest(given), digest(secret));

const BOARDS = {
  seviye: (guildId) => levelBoard(guildId, 50).map((r) => ({ userId: r.userId, value: r.xp, level: r.level })),
  para: (guildId) => richBoard(guildId, 50),
  mesaj: (guildId) => leaderboard(guildId, 'mesaj', STATS_DAYS, 50),
  ses: (guildId) => leaderboard(guildId, 'ses', STATS_DAYS, 50),
};

async function minecraftView() {
  if (!mcEnabled) return { enabled: false };
  const status = await getServerStatus();
  return {
    enabled: true,
    ip: mcIp,
    version: config.minecraft.version || status?.version || null,
    online: Boolean(status?.online),
    players: status?.players ?? 0,
    max: status?.max ?? 0,
    sample: status?.sample ?? [],
    motd: status?.motd ?? '',
  };
}

function guildView(client, guild) {
  const inVoice = guild.voiceStates.cache.filter((v) => v.channelId && !v.member?.user.bot).size;
  const online = client.presenceEnabled ? guild.presences.cache.filter((p) => p.status !== 'offline').size : null;
  return {
    name: guild.name,
    icon: guild.iconURL({ size: 128, extension: 'webp' }),
    members: guild.memberCount,
    online,
    inVoice,
    boosts: guild.premiumSubscriptionCount ?? 0,
    boostTier: guild.premiumTier,
    channels: guild.channels.cache.size,
    roles: guild.roles.cache.size,
  };
}

async function statusView(client, guild) {
  const stats = serverStats(guild.id, STATS_DAYS);
  return {
    bot: {
      name: client.user.username,
      avatar: client.user.displayAvatarURL({ size: 128, extension: 'webp' }),
      ping: client.ws.ping,
      uptime: client.uptime,
      commands: client.commands.size,
    },
    guild: guildView(client, guild),
    activity: {
      days: STATS_DAYS,
      messages: stats.messages,
      previousMessages: stats.previousMessages,
      voiceSeconds: stats.voiceSeconds,
      activeUsers: stats.activeUsers,
      joins: stats.joins,
      leaves: stats.leaves,
      daily: stats.daily,
    },
    minecraft: await minecraftView(),
  };
}

function profileView(guild, member) {
  const stats = userStats(guild.id, member.id, STATS_DAYS);
  const roles = [...member.roles.cache.values()]
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .slice(0, 12)
    .map((r) => ({ name: r.name, color: r.hexColor }));
  return {
    member: true,
    isAdmin: isPanelAdmin(member),
    displayName: member.displayName,
    joinedAt: member.joinedTimestamp,
    roles,
    level: getProfile(guild.id, member.id),
    balance: getBalance(guild.id, member.id),
    stats: {
      days: STATS_DAYS,
      messages: stats.messages,
      voiceSeconds: stats.voiceSeconds,
      activeDays: stats.activeDays,
      messageRank: stats.messageRank,
      voiceRank: stats.voiceRank,
      daily: stats.daily,
    },
  };
}

function boardView(guild, type) {
  const build = Object.hasOwn(BOARDS, type) ? BOARDS[type] : null;
  if (!build) return { __status: 400, error: 'Geçersiz sıralama.' };
  // Sunucudan ayrılanlar listede görünmez
  const rows = build(guild.id).filter((r) => guild.members.cache.has(r.userId)).slice(0, BOARD_SIZE);
  return {
    type,
    rows: rows.map((r, index) => {
      const member = guild.members.cache.get(r.userId);
      return { rank: index + 1, name: member.displayName, avatar: member.displayAvatarURL({ size: 64, extension: 'webp' }), value: r.value, level: r.level ?? null };
    }),
  };
}

async function route(client, guild, req, url, body) {
  const { pathname } = url;
  if (req.method === 'GET' && pathname === '/status') return statusView(client, guild);

  const userId = String(req.headers['x-user-id'] ?? '');
  if (!/^\d{17,20}$/.test(userId)) return { __status: 401, error: 'Giriş yapılmamış.' };
  const member = await guild.members.fetch(userId).catch(() => null);
  if (pathname === '/me' && req.method === 'GET') return member ? profileView(guild, member) : { member: false };
  if (!member) return { __status: 403, error: 'Bu bölüm sadece Karia üyeleri içindir.' };

  if (pathname === '/leaderboard' && req.method === 'GET') return boardView(guild, url.searchParams.get('type') ?? 'seviye');
  if (pathname.startsWith('/admin/')) return adminRoute(client, guild, member, req.method, pathname, body);
  return { __status: 404, error: 'Bulunamadı.' };
}

/** WEB_API_SECRET yoksa kapı hiç açılmaz. */
export function startWebApi(client, { port = Number(process.env.WEB_API_PORT || 8788), guildId = process.env.GUILD_ID, secret = process.env.WEB_API_SECRET } = {}) {
  if (!secret) return null;

  const server = http.createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    };
    try {
      if (!sameSecret(req.headers['x-api-secret'] ?? '', secret)) return send(401, { error: 'Yetkisiz.' });
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return send(503, { error: 'Bot sunucuya bağlı değil.' });

      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > MAX_BODY) return send(413, { error: 'İstek çok büyük.' });
      }
      let body = {};
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          return send(400, { error: 'Geçersiz istek.' });
        }
      }
      const { __status, ...payload } = await route(client, guild, req, new URL(req.url, 'http://x'), body);
      send(__status ?? 200, payload);
    } catch (error) {
      if (error instanceof UserError) return send(400, { error: plain(error.message) });
      console.error('[Site API]', error);
      send(500, { error: 'Bir hata oluştu.' });
    }
  });

  server.on('error', (error) => console.error('[Site API sunucusu]', error.message));
  server.listen(port, '127.0.0.1', () => console.log(`✔ Site API hazır (127.0.0.1:${port})`));
  return server;
}
