// Masa lobisi ve istekler. Her oyunun herkese açık bir varsayılan masası hep durur; oyuncuların açtığı masalar boşalınca kapanır.
// GET /tables?game=poker          → masa listesi
// POST /tables {game, stake}      → yeni masa
// GET /tables/:id?v=N             → masanın görünümü; sürüm N ise değişene kadar bekler (en çok 20 sn)
// POST /tables/:id/:hamle         → join, leave, away ve oyuna özel hamleler
import { ensureEnabled, getBalance, MIN_BET, MAX_BET } from '../../systems/economy.js';
import { UserError } from '../../utils/errors.js';
import { PokerTable, POKER_BLINDS } from './poker.js';
import { BlackjackTable } from './blackjack.js';
import { DiceTable, DICE_ANTES } from './dice.js';
import { CrashRoom } from './crash.js';
import { RouletteRoom } from './roulette.js';
import { isBot } from './hub.js';
import { ChessTable, CHESS_STAKES } from './chess.js';
import { OkeyTable, OKEY_STAKES } from './okey.js';
import { LabirentTable, LABIRENT_STAKES } from './labirent.js';

// Sıra tabanlı masa oyunları: giriş ücretli, kazanan potu alır
const TURN_GAMES = {
  satranc: { make: (id, gid, name, stake) => new ChessTable(id, gid, name, stake), stakes: CHESS_STAKES },
  okey: { make: (id, gid, name, stake) => new OkeyTable(id, gid, name, stake), stakes: OKEY_STAKES },
  labirent: { make: (id, gid, name, stake) => new LabirentTable(id, gid, name, stake), stakes: LABIRENT_STAKES },
};

const NAMES = ['Karia', 'Liman', 'Fener', 'Kale', 'Çarşı', 'Saray', 'Sahil', 'Kervan', 'Kule', 'Pazar', 'Bahçe', 'Yalı'];
const GAMES = ['poker', 'blackjack', 'zar', 'satranc', 'okey', 'labirent'];
const SEAT_GAMES = new Set(GAMES);
const MAX_TABLES = 8; // oyun başına
const SEAT_IDLE = 45_000; // bakmayan oyuncu masadan kaldırılır
const EMPTY_IDLE = 60_000;

const rooms = new Map();
const seatedAt = new Map(); // kullanıcı -> oturduğu masa (aynı anda tek masa)
let guildId = null;
let counter = 0;

function makeTable(game, stake, fixed = false) {
  const used = new Set([...rooms.values()].filter((r) => r.game === game).map((r) => r.name.split(' ')[0]));
  const word = NAMES.find((n) => !used.has(n)) ?? `Masa ${counter + 1}`;
  const id = `${game}-${++counter}`;
  let room;
  if (game === 'poker') {
    const sb = POKER_BLINDS.includes(Number(stake)) ? Number(stake) : POKER_BLINDS[0];
    room = new PokerTable(id, guildId, `${word} Masası`, sb, MAX_BET);
  } else if (game === 'blackjack') room = new BlackjackTable(id, guildId, `${word} Masası`, MIN_BET, MAX_BET);
  else if (TURN_GAMES[game]) {
    const { make, stakes } = TURN_GAMES[game];
    room = make(id, guildId, `${word} Masası`, stakes.includes(Number(stake)) ? Number(stake) : stakes[0]);
  } else {
    const ante = DICE_ANTES.includes(Number(stake)) ? Number(stake) : DICE_ANTES[0];
    room = new DiceTable(id, guildId, `${word} Masası`, ante);
  }
  room.fixed = fixed;
  room.emptySince = Date.now();
  rooms.set(id, room);
  return room;
}

export function startTables(id) {
  if (guildId) return;
  guildId = id;
  rooms.set('tayyare', new CrashRoom(guildId, MIN_BET, MAX_BET));
  rooms.set('rulet', new RouletteRoom(guildId, MIN_BET, MAX_BET));
  for (const game of GAMES) makeTable(game, null, true);

  // Bakmayı bırakan oyuncular kalkar, boş kalan oyuncu masaları kapanır
  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      // Masada insan kalmadıysa botlar da kalkar
      const humans = room.seatedIds().filter((id) => !isBot(id));
      if (!humans.length && room.botIds?.().length) {
        for (const id of room.botIds()) room.leave(id);
        room.bump();
      }
      for (const userId of humans) {
        if (now - (room.viewers.get(userId) ?? 0) > SEAT_IDLE) {
          try {
            room.leave(userId);
          } catch (error) {
            console.error('[Masa]', error);
          }
          seatedAt.delete(userId);
          room.bump();
        }
      }
      // Solo oda: sahibi bakmayı bırakınca kapanır (masadaki fiş cüzdana döner)
      if (room.owner) {
        const away = now - (room.viewers.get(room.owner) ?? room.emptySince) > SEAT_IDLE;
        if (away && !(room.bets?.size)) closeRoom(room);
        continue;
      }
      if (room.seatedIds().length) room.emptySince = now;
      else if (!room.fixed && GAMES.includes(room.game) && now - room.emptySince > EMPTY_IDLE) {
        clearTimeout(room.timer);
        rooms.delete(room.id);
      }
    }
  }, 5_000).unref?.();
}

/** Kullanıcının gerçekten oturduğu masa (el sonunda fişi biten kalkmış olabilir) */
function seatOf(userId) {
  const id = seatedAt.get(userId);
  if (id && rooms.get(id)?.seatedIds().includes(userId)) return id;
  seatedAt.delete(userId);
  return null;
}

/** Başka masaya geçen oyuncunun kendi solo masası kendiliğinden kapanır; online masadaysa önce kalkması gerekir */
function freeSeat(userId, target) {
  const other = seatOf(userId);
  if (!other || other === target) return;
  const room = rooms.get(other);
  if (room.owner === userId) closeRoom(room);
  else throw new UserError(`Önce ${room.name} masasından kalk.`);
}

const list = (game) => [...rooms.values()].filter((r) => r.game === game && !r.owner).map((r) => r.summary());

const SOLO_BOTS = { poker: 3, zar: 2, blackjack: 0, satranc: 1, labirent: 1, okey: 3 };
function soloRoom(game, user) {
  const id = `solo-${game}-${user.id}`;
  let room = rooms.get(id);
  if (room && (room.seatedIds().includes(user.id) || !SEAT_GAMES.has(game))) return room;
  if (room) closeRoom(room);
  if (game === 'tayyare') room = new CrashRoom(guildId, MIN_BET, MAX_BET, id, 4_000);
  else if (game === 'rulet') room = new RouletteRoom(guildId, MIN_BET, MAX_BET, id);
  else if (SEAT_GAMES.has(game)) {
    freeSeat(user.id, id);
    room = makeTable(game, game === 'zar' ? 100 : null);
    rooms.delete(room.id);
    room.id = id;
    room.name = 'Solo Masa';
  } else throw new UserError('Geçersiz oyun.');
  room.owner = user.id;
  room.emptySince = Date.now();
  rooms.set(id, room);
  if (SEAT_GAMES.has(game)) {
    room.join(user, {});
    seatedAt.set(user.id, id);
    for (let i = 0; i < SOLO_BOTS[game]; i++) room.addBot();
    room.refillBots = () => {
      if (!room.seatedIds().includes(user.id)) return;
      while (room.botIds().length < SOLO_BOTS[game] && room.seats.some((s) => !s)) room.addBot();
    };
  }
  return room;
}

function closeRoom(room) {
  for (const id of room.seatedIds()) {
    room.leave(id);
    if (seatedAt.get(id) === room.id) seatedAt.delete(id);
  }
  clearTimeout(room.timer);
  clearTimeout(room.botTimer);
  clearInterval(room.tick);
  rooms.delete(room.id);
  room.bump(); // bekleyen istekler masanın kapandığını hemen görsün
}

function getRoom(id) {
  const room = rooms.get(id);
  if (!room) throw new UserError('Bu masa kapandı.');
  return room;
}

export async function tablesRoute(method, path, body, query, user) {
  if (!guildId) throw new UserError('Masalar henüz hazır değil.');
  // Solo: yalnızca bu oyuncunun gördüğü oda; poker ve zarda botlarla dolu masa
  if (path === '/tables/solo' && method === 'POST') {
    ensureEnabled(guildId);
    return { id: soloRoom(String(body.game), user).id };
  }
  if (path === '/tables') {
    if (method === 'GET') {
      const game = query.get('game');
      return { tables: list(game), seatedAt: seatOf(user.id), blinds: POKER_BLINDS, antes: DICE_ANTES, stakes: TURN_GAMES[game]?.stakes ?? [] };
    }
    if (method === 'POST') {
      ensureEnabled(guildId);
      const game = String(body.game);
      if (!GAMES.includes(game)) throw new UserError('Geçersiz oyun.');
      if (list(game).length >= MAX_TABLES) throw new UserError('Şu an yeni masa açılamıyor, var olan bir masaya otur.');
      return { id: makeTable(game, body.stake).id };
    }
  }

  const match = path.match(/^\/tables\/([\w-]+)(?:\/(\w+))?$/);
  if (!match) return { __status: 404, error: 'Bulunamadı.' };
  const room = getRoom(match[1]);
  if (room.owner && room.owner !== user.id) return { __status: 403, error: 'Bu solo bir oyun.' };
  const action = match[2];

  if (method === 'GET' && !action) {
    room.seen(user.id);
    room.wake?.();
    const since = Number(query.get('v'));
    const waiting = room.wait(Number.isInteger(since) ? since : -1);
    if (waiting) await waiting;
    room.seen(user.id);
    return { v: room.v, now: Date.now(), room: room.view(user.id), balance: getBalance(guildId, user.id), seatedAt: seatOf(user.id) };
  }
  if (method !== 'POST' || !action) return { __status: 405, error: 'Geçersiz istek.' };

  room.seen(user.id);
  try {
    if (action === 'away') {
      room.away(user.id);
      return { ok: true };
    }
    if (action === 'join') {
      ensureEnabled(guildId);
      if (!room.join) throw new UserError('Bu odada oturulmaz.');
      freeSeat(user.id, room.id);
      room.join(user, body);
      seatedAt.set(user.id, room.id);
    } else if (action === 'bot' || action === 'kickbots') {
      if (!room.seatedIds().includes(user.id)) throw new UserError('Bot eklemek için önce masaya otur.');
      if (action === 'bot') room.addBot();
      else for (const id of room.botIds()) room.leave(id);
    } else if (action === 'leave') {
      // Solo masadan kalkan oyuncunun masası botlarıyla birlikte kapanır
      if (room.owner === user.id && SEAT_GAMES.has(room.game)) {
        closeRoom(room);
        return { closed: true, balance: getBalance(guildId, user.id), seatedAt: seatOf(user.id) };
      }
      room.leave?.(user.id);
      if (seatedAt.get(user.id) === room.id) seatedAt.delete(user.id);
    } else {
      ensureEnabled(guildId);
      room.act(user, action, body);
    }
  } finally {
    room.bump();
  }
  return { v: room.v, now: Date.now(), room: room.view(user.id), balance: getBalance(guildId, user.id), seatedAt: seatOf(user.id) };
}
