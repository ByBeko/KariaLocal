// Discord Etkinliği sunucusu. Sonuçlar burada hesaplanır, bakiye botla aynı veritabanı satırıdır; tarayıcıya güvenilmez.
import http from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { UserError } from '../utils/errors.js';
import { getBalance, addMoney, takeMoney, parseBet, ensureEnabled, lockGame, MIN_BET, MAX_BET } from '../systems/economy.js';
import { spinSlot, slotOutcome, newDeck, handTotal, isBlackjack, blackjackPayout, dealerPlay } from '../systems/casino.js';
import { getQueue, playQuery, requireVoice, voteSkip, stopMusic, goBack } from '../systems/music.js';
import { adminRoute, isPanelAdmin } from './admin.js';
import { homeView, leaderboardView, claimDailyReward, sendSuggestion } from './home.js';

const PUBLIC_DIR = path.join(import.meta.dirname, 'public');
const API = 'https://discord.com/api/v10';
const TOKEN_TTL = 10 * 60_000;
const BLACKJACK_IDLE = 3 * 60_000;
const MIN_INTERVAL = 120;
const MAX_BODY = 16 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Sadece public klasöründeki bilinen dosyalar verilir; adres ile dosya yoluna çıkılamaz
function loadStatic(dir = PUBLIC_DIR, base = '') {
  const files = new Map();
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const route = `${base}/${name}`;
    if (statSync(full).isDirectory()) for (const [k, v] of loadStatic(full, route)) files.set(k, v);
    else files.set(route, { body: readFileSync(full), type: MIME[path.extname(name)] ?? 'application/octet-stream' });
  }
  return files;
}

/** Hata metnindeki Discord biçimlerini arayüz için temizler */
export const plain = (text) => text.replace(/<a?:\w+:\d+>/g, '').replace(/\*\*|`/g, '').replace(/\s{2,}/g, ' ').trim();

const games = new Map(); // kullanıcı -> blackjack eli

function cardView(game, reveal) {
  const card = (c) => ({ r: c.r, s: c.s[0] });
  return {
    bet: game.bet,
    player: game.player.map(card),
    playerTotal: handTotal(game.player),
    dealer: reveal ? game.dealer.map(card) : [card(game.dealer[0])],
    dealerTotal: reveal ? handTotal(game.dealer) : null,
    hidden: !reveal,
  };
}

function finishGame(guildId, userId, game, outcome) {
  clearTimeout(game.timer);
  games.delete(userId);
  game.unlock();
  const payout = blackjackPayout(game.bet, outcome);
  const balance = addMoney(guildId, userId, payout);
  return { ...cardView(game, true), active: false, outcome, net: payout - game.bet, balance };
}

function touchGame(guildId, userId, game) {
  clearTimeout(game.timer);
  game.timer = setTimeout(() => {
    if (games.get(userId) === game) finishGame(guildId, userId, game, dealerPlay(game.deck, game.dealer, game.player));
  }, BLACKJACK_IDLE);
  game.timer.unref?.();
}

const activeView = (guildId, userId, game) => ({ ...cardView(game, false), active: true, canDouble: game.player.length === 2 && getBalance(guildId, userId) >= game.bet });

const youtubeId = (track) => track.thumbnail?.match(/^https:\/\/i\.ytimg\.com\/vi\/([\w-]{11})\//)?.[1] ?? null;

function musicView(guild) {
  const queue = getQueue(guild.id);
  if (!queue?.current) return { playing: false, upcoming: [], remaining: 0 };
  const brief = (t) => ({ title: t.title, artist: t.uploader, duration: t.duration, thumb: youtubeId(t) });
  return {
    playing: true,
    paused: queue.paused,
    current: brief(queue.current),
    position: queue.position,
    loop: queue.loop,
    volume: queue.volume,
    canBack: queue.history.length > 0,
    upcoming: queue.tracks.slice(0, 50).map(brief),
    remaining: queue.tracks.length,
  };
}

const avatars = new Map(); // adres -> resim

/** Yalnızca sunucu üyelerinin profil fotoğrafını Discord'dan getirir */
async function memberAvatar(guild, id) {
  const url = guild.members.cache.get(id)?.displayAvatarURL({ extension: 'png', size: 128 });
  if (!url) return null;
  if (!avatars.has(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (!res?.ok) return null;
    if (avatars.size >= 300) avatars.delete(avatars.keys().next().value);
    avatars.set(url, Buffer.from(await res.arrayBuffer()));
  }
  return avatars.get(url);
}

const thumbs = new Map(); // video -> resim; Discord dış resimleri engellediği için kapaklar buradan verilir

/** Yalnızca çalan ya da sıradaki şarkının kapağını i.ytimg.com'dan getirir */
async function trackThumb(guild, id) {
  const queue = getQueue(guild.id);
  if (!thumbs.has(id)) {
    if (![queue?.current, ...(queue?.tracks ?? [])].some((t) => t && youtubeId(t) === id)) return null;
    const res = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (!res?.ok) return null;
    if (thumbs.size >= 50) thumbs.delete(thumbs.keys().next().value);
    thumbs.set(id, Buffer.from(await res.arrayBuffer()));
  }
  return thumbs.get(id);
}

function coinflip(guildId, userId, body) {
  ensureEnabled(guildId);
  const bet = parseBet(body.bet, guildId, userId);
  const pick = body.pick === 'tura' ? 'tura' : 'yazi';
  takeMoney(guildId, userId, bet);
  const result = Math.random() < 0.5 ? 'yazi' : 'tura';
  const won = result === pick;
  return { pick, result, won, net: won ? bet : -bet, balance: addMoney(guildId, userId, won ? bet * 2 : 0) };
}

function slot(guildId, userId, body) {
  ensureEnabled(guildId);
  const bet = parseBet(body.bet, guildId, userId);
  const unlock = lockGame(guildId, userId);
  try {
    takeMoney(guildId, userId, bet);
    const reels = [spinSlot(), spinSlot(), spinSlot()];
    const { n, multiplier } = slotOutcome(reels);
    const payout = Math.floor(bet * multiplier);
    return { reels: reels.map((s) => s.key), matches: n, multiplier, net: payout - bet, balance: addMoney(guildId, userId, payout) };
  } finally {
    unlock();
  }
}

function blackjackStart(guildId, userId, body) {
  ensureEnabled(guildId);
  const bet = parseBet(body.bet, guildId, userId);
  const unlock = lockGame(guildId, userId);
  let game;
  try {
    takeMoney(guildId, userId, bet);
    const deck = newDeck();
    game = { bet, deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], unlock };
  } catch (error) {
    unlock();
    throw error;
  }
  if (isBlackjack(game.player) || isBlackjack(game.dealer)) {
    const outcome = isBlackjack(game.player) && isBlackjack(game.dealer) ? 'push' : isBlackjack(game.player) ? 'blackjack' : 'lose';
    return finishGame(guildId, userId, game, outcome);
  }
  games.set(userId, game);
  touchGame(guildId, userId, game);
  return { ...activeView(guildId, userId, game), balance: getBalance(guildId, userId) };
}

function blackjackMove(guildId, userId, move) {
  const game = games.get(userId);
  if (!game) throw new UserError('Devam eden bir elin yok.');
  if (move === 'double') {
    if (game.player.length !== 2) throw new UserError('Sadece ilk iki kartta ikiye katlayabilirsin.');
    takeMoney(guildId, userId, game.bet);
    game.bet *= 2;
    game.player.push(game.deck.pop());
    return finishGame(guildId, userId, game, handTotal(game.player) > 21 ? 'bust' : dealerPlay(game.deck, game.dealer, game.player));
  }
  if (move === 'stand') return finishGame(guildId, userId, game, dealerPlay(game.deck, game.dealer, game.player));
  game.player.push(game.deck.pop());
  const value = handTotal(game.player);
  if (value > 21) return finishGame(guildId, userId, game, 'bust');
  if (value === 21) return finishGame(guildId, userId, game, dealerPlay(game.deck, game.dealer, game.player));
  touchGame(guildId, userId, game);
  return { ...activeView(guildId, userId, game), balance: getBalance(guildId, userId) };
}

export function startActivityServer(client, { port = Number(process.env.ACTIVITY_PORT || 8787), guildId = process.env.GUILD_ID } = {}) {
  const files = loadStatic();
  const tokens = new Map(); // erişim anahtarı -> { user, at }
  const lastCall = new Map();
  const devMode = process.env.ACTIVITY_DEV === '1'; // yalnızca yerel test; canlıda asla açılmaz
  const guild = () => client.guilds.cache.get(guildId);

  async function identify(req) {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!token) return null;
    if (devMode && token.startsWith('dev:')) return { id: token.slice(4), username: 'Test Oyuncu', avatar: null };
    const cached = tokens.get(token);
    if (cached && Date.now() - cached.at < TOKEN_TTL) return cached.user;
    const res = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    const user = { id: data.id, username: data.global_name ?? data.username, avatar: data.avatar };
    if (tokens.size > 2000) tokens.clear();
    tokens.set(token, { user, at: Date.now() });
    return user;
  }

  async function exchangeCode(code) {
    const secret = process.env.DISCORD_CLIENT_SECRET;
    if (!secret) throw new UserError('Etkinlik henüz kurulmadı: istemci anahtarı eksik.');
    const res = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.application.id, client_secret: secret, grant_type: 'authorization_code', code: String(code) }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      console.error(`[Etkinlik] Discord girişi reddedildi: ${res.status} ${detail.error ?? ''}`);
      throw new UserError('Discord girişi doğrulanamadı.');
    }
    return { access_token: (await res.json()).access_token };
  }

  async function route(req, pathname, body) {
    if (req.method === 'GET' && pathname === '/config') return { clientId: client.application.id, minBet: MIN_BET, maxBet: MAX_BET };
    if (req.method === 'POST' && pathname === '/token') return exchangeCode(body.code);

    const user = await identify(req);
    if (!user) return { __status: 401, error: 'Oturum doğrulanamadı.' };
    const member = await guild().members.fetch(user.id).catch(() => null);
    if (!member) return { __status: 403, error: 'Bu etkinlik sadece Karia üyeleri içindir.' };
    const id = user.id;

    const now = Date.now();
    // Sadece bahis ve komutlar sınırlanır; arka plandaki bakiye yenilemesi oyuncuya uyarı göstermesin
    if (req.method === 'POST') {
      if (now - (lastCall.get(id) ?? 0) < MIN_INTERVAL) return { __status: 429, error: 'Biraz yavaşla.' };
      if (lastCall.size > 5000) lastCall.clear();
      lastCall.set(id, now);
    }

    if (req.method === 'GET' && pathname === '/state') {
      const game = games.get(id);
      return { user, isAdmin: isPanelAdmin(member), balance: getBalance(guildId, id), blackjack: game ? activeView(guildId, id, game) : null, music: musicView(guild()) };
    }
    if (req.method === 'GET' && pathname === '/home') return homeView(guild(), member);
    const board = pathname.match(/^\/leaderboard\/(\w+)$/);
    if (req.method === 'GET' && board) return leaderboardView(guild(), id, board[1]);
    if (req.method === 'POST' && pathname === '/daily') return claimDailyReward(guild(), id);
    if (req.method === 'POST' && pathname === '/suggest') return sendSuggestion(client, guild(), member, body.text);
    if (pathname.startsWith('/admin/')) return adminRoute(client, guild(), member, req.method, pathname, body);
    if (req.method === 'GET' && pathname === '/music') return musicView(guild());
    if (req.method !== 'POST') return { __status: 405, error: 'Geçersiz istek.' };

    switch (pathname) {
      case '/coinflip': return coinflip(guildId, id, body);
      case '/slot': return slot(guildId, id, body);
      case '/blackjack/start': return blackjackStart(guildId, id, body);
      case '/blackjack/hit': return blackjackMove(guildId, id, 'hit');
      case '/blackjack/stand': return blackjackMove(guildId, id, 'stand');
      case '/blackjack/double': return blackjackMove(guildId, id, 'double');
      case '/music/play': {
        const query = String(body.query ?? '').trim().slice(0, 500);
        if (!query) throw new UserError('Şarkı adı ya da link yaz.');
        const channel = member.voice.channel;
        if (!channel) throw new UserError('Önce bir ses kanalına gir.');
        await playQuery(member, channel, query);
        return musicView(guild());
      }
      case '/music/pause': requireVoice(member).queue.togglePause(); return musicView(guild());
      case '/music/skip': { const r = voteSkip(member); return { ...musicView(guild()), notice: r.skipped ? '' : `Geçme oyu: ${r.votes}/${r.needed}` }; }
      case '/music/stop': stopMusic(member); return musicView(guild());
      case '/music/previous': goBack(member); return musicView(guild());
      case '/music/shuffle': {
        const { queue } = requireVoice(member);
        if (queue.tracks.length < 2) throw new UserError('Karıştırmak için sırada en az 2 şarkı olmalı.');
        queue.shuffle();
        return musicView(guild());
      }
      case '/music/loop': {
        const { queue } = requireVoice(member);
        queue.cycleLoop();
        await queue.refreshPanel();
        return musicView(guild());
      }
      case '/music/volume': {
        const level = Number(body.level);
        if (!Number.isInteger(level) || level < 0 || level > 150) throw new UserError('Ses düzeyi 0 ile 150 arasında olmalı.');
        const { queue } = requireVoice(member);
        queue.setVolume(level);
        await queue.refreshPanel();
        return musicView(guild());
      }
      default: return { __status: 404, error: 'Bulunamadı.' };
    }
  }

  const server = http.createServer(async (req, res) => {
    const send = (status, payload) => {
      // Tanılama: anahtar ve kod yazılmaz; sadece yol, sonuç ve kullanıcıya gösterilen hata
      if (req.method === 'POST' || status >= 400) console.log(`[Etkinlik] ${req.method} ${req.url.split('?')[0]} ${status}${payload.error ? ` ${payload.error}` : ''}`);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    };
    try {
      // Discord, adresleri /.proxy altından da iletebilir
      const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/\.proxy/, '') || '/';
      const avatar = req.method === 'GET' && pathname.match(/^\/avatar\/(\d{17,20})\.png$/);
      if (avatar) {
        const image = await memberAvatar(guild(), avatar[1]);
        if (!image) return send(404, { error: 'Bulunamadı.' });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
        return res.end(image);
      }
      const thumb = req.method === 'GET' && pathname.match(/^\/thumb\/([\w-]{11})\.jpg$/);
      if (thumb) {
        const image = await trackThumb(guild(), thumb[1]);
        if (!image) return send(404, { error: 'Bulunamadı.' });
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });
        return res.end(image);
      }
      if (!pathname.startsWith('/api/')) {
        const file = files.get(pathname === '/' ? '/index.html' : pathname);
        if (!file || req.method !== 'GET') return send(404, { error: 'Bulunamadı.' });
        res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-cache' });
        return res.end(file.body);
      }

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
      const { __status, ...payload } = await route(req, pathname.slice(4), body);
      send(__status ?? 200, payload);
    } catch (error) {
      if (error instanceof UserError) return send(400, { error: plain(error.message) });
      console.error('[Etkinlik]', error);
      send(500, { error: 'Bir hata oluştu.' });
    }
  });

  server.on('error', (error) => console.error('[Etkinlik sunucusu]', error.message));
  // Sadece bu bilgisayardan erişilir; dışarıya tünel üzerinden açılır
  server.listen(port, '127.0.0.1', () => console.log(`✔ Etkinlik sunucusu hazır (127.0.0.1:${port})`));
  return server;
}
