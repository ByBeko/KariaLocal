// Satranç: iki kişilik masa. Kurallar tamdır (rok, geçerken alma, terfi, şah mat, pat, üç tekrar, 50 hamle,
// yetersiz taş). Bot alfa-beta araması ile oynar. Kare 0 = a8, 63 = h1; büyük harf beyaz, küçük harf siyah.
import { UserError } from '../../utils/errors.js';
import { TurnTable } from './turnTable.js';

export const CHESS_STAKES = [100, 500, 2500, 10000];
const START = 'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR'.split('');
const N_STEPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const K_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const LINE = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

const colorOf = (pc) => (pc === '.' ? null : pc === pc.toUpperCase() ? 'w' : 'b');
const at = (r, c) => (r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : -1);
export const squareName = (i) => `${'abcdefgh'[i % 8]}${8 - Math.floor(i / 8)}`;

export function newGame() {
  return { board: [...START], turn: 'w', castle: { K: true, Q: true, k: true, q: true }, ep: -1, half: 0, seen: new Map() };
}

/** sq karesi byColor tarafından tehdit ediliyor mu */
function attacked(board, sq, by) {
  const r = Math.floor(sq / 8);
  const c = sq % 8;
  const is = (i, types) => i >= 0 && colorOf(board[i]) === by && types.includes(board[i].toLowerCase());
  const pr = by === 'w' ? r + 1 : r - 1; // saldıran piyonun satırı
  if (is(at(pr, c - 1), 'p') || is(at(pr, c + 1), 'p')) return true;
  for (const [dr, dc] of N_STEPS) if (is(at(r + dr, c + dc), 'n')) return true;
  for (const [dr, dc] of K_STEPS) if (is(at(r + dr, c + dc), 'k')) return true;
  const ray = (dirs, types) => dirs.some(([dr, dc]) => {
    for (let k = 1; k < 8; k++) {
      const i = at(r + dr * k, c + dc * k);
      if (i < 0) return false;
      if (board[i] !== '.') return colorOf(board[i]) === by && types.includes(board[i].toLowerCase());
    }
    return false;
  });
  return ray(DIAG, 'bq') || ray(LINE, 'rq');
}

const kingSq = (board, color) => board.indexOf(color === 'w' ? 'K' : 'k');
export const inCheck = (g, color = g.turn) => attacked(g.board, kingSq(g.board, color), color === 'w' ? 'b' : 'w');

function pseudoMoves(g) {
  const { board, turn } = g;
  const enemy = turn === 'w' ? 'b' : 'w';
  const moves = [];
  for (let i = 0; i < 64; i++) {
    const pc = board[i];
    if (colorOf(pc) !== turn) continue;
    const r = Math.floor(i / 8);
    const c = i % 8;
    const type = pc.toLowerCase();
    const add = (to, extra = {}) => moves.push({ from: i, to, ...extra });
    if (type === 'p') {
      const dir = turn === 'w' ? -1 : 1;
      const startRow = turn === 'w' ? 6 : 1;
      const lastRow = turn === 'w' ? 0 : 7;
      const push = (to) => (Math.floor(to / 8) === lastRow ? ['q', 'r', 'b', 'n'].forEach((p) => add(to, { promo: p })) : add(to));
      const one = at(r + dir, c);
      if (one >= 0 && board[one] === '.') {
        push(one);
        const two = at(r + 2 * dir, c);
        if (r === startRow && board[two] === '.') add(two, { double: true });
      }
      for (const dc of [-1, 1]) {
        const to = at(r + dir, c + dc);
        if (to < 0) continue;
        if (colorOf(board[to]) === enemy) push(to);
        else if (to === g.ep) add(to, { ep: true });
      }
    } else if (type === 'n' || type === 'k') {
      for (const [dr, dc] of type === 'n' ? N_STEPS : K_STEPS) {
        const to = at(r + dr, c + dc);
        if (to >= 0 && colorOf(board[to]) !== turn) add(to);
      }
      if (type === 'k') {
        const row = turn === 'w' ? 7 : 0;
        const [kSide, qSide] = turn === 'w' ? ['K', 'Q'] : ['k', 'q'];
        if (i === row * 8 + 4 && !attacked(board, i, enemy)) {
          if (g.castle[kSide] && board[row * 8 + 5] === '.' && board[row * 8 + 6] === '.' && !attacked(board, row * 8 + 5, enemy)) add(row * 8 + 6, { castle: 'k' });
          if (g.castle[qSide] && board[row * 8 + 3] === '.' && board[row * 8 + 2] === '.' && board[row * 8 + 1] === '.' && !attacked(board, row * 8 + 3, enemy)) add(row * 8 + 2, { castle: 'q' });
        }
      }
    } else {
      const dirs = type === 'b' ? DIAG : type === 'r' ? LINE : [...DIAG, ...LINE];
      for (const [dr, dc] of dirs) {
        for (let k = 1; k < 8; k++) {
          const to = at(r + dr * k, c + dc * k);
          if (to < 0 || colorOf(board[to]) === turn) break;
          add(to, board[to] !== '.' ? { capture: true } : {});
          if (board[to] !== '.') break;
        }
      }
    }
  }
  return moves;
}

/** Hamleyi uygular, yeni durum döner (eski durum değişmez) */
export function play(g, m) {
  const board = [...g.board];
  const pc = board[m.from];
  const captured = m.ep ? board[m.to + (g.turn === 'w' ? 8 : -8)] : board[m.to];
  board[m.to] = m.promo ? (g.turn === 'w' ? m.promo.toUpperCase() : m.promo) : pc;
  board[m.from] = '.';
  if (m.ep) board[m.to + (g.turn === 'w' ? 8 : -8)] = '.';
  if (m.castle) {
    const row = g.turn === 'w' ? 7 : 0;
    const [rf, rt] = m.castle === 'k' ? [row * 8 + 7, row * 8 + 5] : [row * 8, row * 8 + 3];
    board[rt] = board[rf];
    board[rf] = '.';
  }
  const castle = { ...g.castle };
  for (const sq of [m.from, m.to]) {
    if (sq === 60) castle.K = castle.Q = false;
    if (sq === 4) castle.k = castle.q = false;
    if (sq === 63) castle.K = false;
    if (sq === 56) castle.Q = false;
    if (sq === 7) castle.k = false;
    if (sq === 0) castle.q = false;
  }
  return {
    board, castle, turn: g.turn === 'w' ? 'b' : 'w',
    ep: m.double ? (m.from + m.to) / 2 : -1,
    half: pc.toLowerCase() === 'p' || captured !== '.' ? 0 : g.half + 1,
    seen: g.seen, captured: captured !== '.' ? captured : null,
  };
}

export function legalMoves(g) {
  return pseudoMoves(g).filter((m) => !inCheck(play(g, m), g.turn));
}

const key = (g) => `${g.board.join('')}${g.turn}${Object.entries(g.castle).filter(([, v]) => v).map(([k]) => k).join('')}${g.ep}`;

function insufficient(board) {
  const rest = board.filter((p) => p !== '.' && p.toLowerCase() !== 'k');
  return rest.length === 0 || (rest.length === 1 && 'bn'.includes(rest[0].toLowerCase()));
}

/** Oyun durumu: null sürüyor, yoksa { winner: 'w'|'b'|null, reason } */
export function outcome(g) {
  if ((g.seen.get(key(g)) ?? 0) >= 3) return { winner: null, reason: 'üç kez aynı konum' };
  if (g.half >= 100) return { winner: null, reason: '50 hamle kuralı' };
  if (insufficient(g.board)) return { winner: null, reason: 'yetersiz taş' };
  if (legalMoves(g).length) return null;
  return inCheck(g) ? { winner: g.turn === 'w' ? 'b' : 'w', reason: 'şah mat' } : { winner: null, reason: 'pat' };
}

// ── Bot: malzeme + merkez değerlendirmesi, alfa-beta ──
function evaluate(board) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const pc = board[i];
    if (pc === '.') continue;
    const r = Math.floor(i / 8);
    const c = i % 8;
    const type = pc.toLowerCase();
    let v = VALUE[type];
    const center = 3.5 - Math.max(Math.abs(3.5 - r), Math.abs(3.5 - c));
    if (type === 'n' || type === 'b') v += center * 8;
    if (type === 'p') v += (colorOf(pc) === 'w' ? 6 - r : r - 1) * 6 + (c > 1 && c < 6 ? center * 4 : 0);
    if (type === 'q') v += center * 2;
    score += colorOf(pc) === 'w' ? v : -v;
  }
  return score;
}

function search(g, depth, alpha, beta, stopAt) {
  if (Date.now() > stopAt) throw new Error('timeout');
  const moves = legalMoves(g);
  if (!moves.length) return inCheck(g) ? -100000 - depth : 0;
  if (depth === 0) return (g.turn === 'w' ? 1 : -1) * evaluate(g.board);
  moves.sort((a, b) => (g.board[b.to] !== '.') - (g.board[a.to] !== '.'));
  for (const m of moves) {
    const score = -search(play(g, m), depth - 1, -beta, -alpha, stopAt);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

export function bestMove(g, ms = 1500) {
  const moves = legalMoves(g);
  const stopAt = Date.now() + ms;
  let best = moves[Math.floor(Math.random() * moves.length)];
  for (let depth = 1; depth <= 4; depth++) {
    try {
      let alpha = -Infinity;
      let pick = best;
      const ordered = [best, ...moves.filter((m) => m !== best)];
      for (const m of ordered) {
        const score = -search(play(g, m), depth - 1, -Infinity, -alpha, stopAt) + Math.random() * 6;
        if (score > alpha) {
          alpha = score;
          pick = m;
        }
      }
      best = pick;
    } catch {
      break;
    }
  }
  return best;
}

export class ChessTable extends TurnTable {
  constructor(id, guildId, name, stake) {
    super(id, guildId, name, 'satranc', { seats: 2, minPlayers: 2, stake, turnMs: 90_000 });
    this.g = null;
    this.flip = false;
  }

  startGame() {
    this.flip = !this.flip; // her oyunda renkler değişir
    this.colors = new Map(this.players.map((p, i) => [p, (i === 0) === this.flip ? 'w' : 'b']));
    this.g = newGame();
    this.g.seen.set(key(this.g), 1);
    this.lastMove = null;
    this.moves = [];
    this.nextTurn();
  }

  playerOf(color) {
    return this.players.find((p) => this.colors.get(p) === color);
  }

  nextTurn() {
    const done = outcome(this.g);
    if (done) return this.finish(done.winner ? [this.playerOf(done.winner)] : [], done.reason);
    this.setTurn(this.playerOf(this.g.turn));
  }

  apply(m) {
    const san = `${squareName(m.from)}${m.to === m.from ? '' : '-'}${squareName(m.to)}${m.promo ? '=' + m.promo.toUpperCase() : ''}`;
    this.g = play(this.g, m);
    this.g.seen.set(key(this.g), (this.g.seen.get(key(this.g)) ?? 0) + 1);
    this.lastMove = { from: m.from, to: m.to };
    this.moves.push(san);
    clearTimeout(this.timer);
    this.nextTurn();
  }

  move(p, action, body) {
    if (action === 'resign') return this.finish(this.players.filter((o) => o !== p), `${p.name} çekildi`);
    if (action !== 'move') throw new UserError('Geçersiz hamle.');
    if (this.colors.get(p) !== this.g.turn) throw new UserError('Sıra sende değil.');
    const m = legalMoves(this.g).find((x) => x.from === Number(body.from) && x.to === Number(body.to) && (!x.promo || x.promo === (body.promo ?? 'q')));
    if (!m) throw new UserError('Bu hamle kurallara uygun değil.');
    this.apply(m);
  }

  botMove(p) {
    if (this.colors.get(p) !== this.g.turn) return;
    this.apply(bestMove(this.g, 1200));
  }

  onTimeout(p) {
    if (this.phase !== 'playing') return;
    this.finish(this.players.filter((o) => o !== p), `${p.name} süresini doldurdu`);
  }

  onLeave(p) {
    this.finish(this.players.filter((o) => o !== p), `${p.name} oyundan çıktı`);
  }

  resetGame() {
    this.g = null;
  }

  view(userId) {
    const base = this.baseView(userId);
    const me = this.players.find((p) => p.id === userId);
    const myColor = me ? this.colors.get(me) : null;
    const g = this.g;
    const myTurn = Boolean(g && this.phase === 'playing' && myColor === g.turn);
    return {
      ...base,
      board: g ? g.board : START,
      colors: this.players.length ? Object.fromEntries(this.players.map((p) => [p.seat, this.colors.get(p)])) : {},
      myColor, toMove: g?.turn ?? 'w', check: g ? inCheck(g) : false,
      legal: myTurn ? legalMoves(g).map((m) => [m.from, m.to, m.promo ?? '']) : [],
      lastMove: this.lastMove ?? null, moves: this.moves?.slice(-12) ?? [],
    };
  }
}
