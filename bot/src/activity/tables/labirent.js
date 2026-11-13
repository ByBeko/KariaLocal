// Karia Labirent (Karia'ya özel yol kapatma yarışı): 7×7 tahta, iki oyuncu karşı kenara ilk varmaya çalışır.
// Sırada ya bir kare yürürsün, ya boş bir kareye kaya koyarsın (6 kaya), ya da kazmanla bir kayayı kırarsın (1 kez).
// Kaya, iki oyuncunun da hedefe giden yolunu tamamen kapatamaz. Rakip yanındaysa üstünden atlanabilir.
import { UserError } from '../../utils/errors.js';
import { TurnTable } from './turnTable.js';

export const LABIRENT_STAKES = [100, 500, 2500, 10000];
const SIZE = 7;
const ROCKS = 6;
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const idx = (r, c) => r * SIZE + c;

/** Hedef satırına en kısa yol (kayalar duvar, oyuncular engel değil). Yol yoksa Infinity. */
function distance(rocks, from, goalRow) {
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 0; frontier.length; d++) {
    const next = [];
    for (const i of frontier) {
      if (Math.floor(i / SIZE) === goalRow) return d;
      for (const [dr, dc] of DIRS) {
        const r = Math.floor(i / SIZE) + dr;
        const c = (i % SIZE) + dc;
        const j = idx(r, c);
        if (inside(r, c) && !rocks.has(j) && !seen.has(j)) {
          seen.add(j);
          next.push(j);
        }
      }
    }
    frontier = next;
  }
  return Infinity;
}

export class LabirentTable extends TurnTable {
  constructor(id, guildId, name, stake) {
    super(id, guildId, name, 'labirent', { seats: 2, minPlayers: 2, stake, turnMs: 45_000 });
    this.resetGame();
  }

  resetGame() {
    this.rocks = new Set();
    this.pawns = new Map();
  }

  startGame() {
    this.resetGame();
    this.state = new Map(this.players.map((p, i) => [p, { pos: i === 0 ? idx(SIZE - 1, 3) : idx(0, 3), goal: i === 0 ? 0 : SIZE - 1, rocks: ROCKS, pick: 1 }]));
    this.order = [...this.players];
    this.current = Math.random() < 0.5 ? 0 : 1;
    this.lastAction = null;
    this.setTurn(this.order[this.current]);
  }

  other(p) {
    return this.players.find((o) => o !== p);
  }

  /** Oyuncunun gidebileceği kareler (rakibin üstünden düz atlama, olmazsa yanına kayma) */
  steps(p) {
    const me = this.state.get(p);
    const foe = this.state.get(this.other(p)).pos;
    const r0 = Math.floor(me.pos / SIZE);
    const c0 = me.pos % SIZE;
    const out = new Set();
    for (const [dr, dc] of DIRS) {
      const r = r0 + dr;
      const c = c0 + dc;
      if (!inside(r, c) || this.rocks.has(idx(r, c))) continue;
      if (idx(r, c) !== foe) {
        out.add(idx(r, c));
        continue;
      }
      const jr = r + dr;
      const jc = c + dc;
      if (inside(jr, jc) && !this.rocks.has(idx(jr, jc))) out.add(idx(jr, jc));
      else for (const [sr, sc] of dr ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]]) {
        const j = idx(r + sr, c + sc);
        if (inside(r + sr, c + sc) && !this.rocks.has(j) && j !== me.pos) out.add(j);
      }
    }
    return out;
  }

  canRock(cell) {
    if (this.rocks.has(cell) || [...this.state.values()].some((s) => s.pos === cell)) return false;
    const rocks = new Set(this.rocks).add(cell);
    return [...this.state.values()].every((s) => distance(rocks, s.pos, s.goal) < Infinity);
  }

  endTurn(p, text) {
    this.lastAction = text;
    clearTimeout(this.timer);
    const me = this.state.get(p);
    if (Math.floor(me.pos / SIZE) === me.goal) return this.finish([p], 'karşı kenara ulaştı');
    this.current = 1 - this.current;
    this.setTurn(this.order[this.current]);
  }

  move(p, action, body) {
    if (action === 'resign') return this.finish([this.other(p)], `${p.name} çekildi`);
    if (this.order[this.current] !== p) throw new UserError('Sıra sende değil.');
    const me = this.state.get(p);
    const cell = Number(body.cell);
    if (!Number.isInteger(cell) || cell < 0 || cell >= SIZE * SIZE) throw new UserError('Geçersiz kare.');
    if (action === 'step') {
      if (!this.steps(p).has(cell)) throw new UserError('Oraya gidemezsin.');
      me.pos = cell;
      return this.endTurn(p, `${p.name} yürüdü`);
    }
    if (action === 'rock') {
      if (me.rocks <= 0) throw new UserError('Kayan kalmadı.');
      if (!this.canRock(cell)) throw new UserError('Oraya kaya koyamazsın (yolu tamamen kapatamazsın).');
      this.rocks.add(cell);
      me.rocks--;
      return this.endTurn(p, `${p.name} kaya koydu`);
    }
    if (action === 'pick') {
      if (me.pick <= 0) throw new UserError('Kazman kalmadı.');
      if (!this.rocks.has(cell)) throw new UserError('Orada kaya yok.');
      this.rocks.delete(cell);
      me.pick--;
      return this.endTurn(p, `${p.name} kazmayla kaya kırdı`);
    }
    throw new UserError('Geçersiz hamle.');
  }

  /** Kısa yolda öndeyse yürür; gerideyse rakibin yolunu en çok uzatan kayayı koyar */
  botMove(p) {
    if (this.order[this.current] !== p) return;
    const me = this.state.get(p);
    const foe = this.state.get(this.other(p));
    const mine = distance(this.rocks, me.pos, me.goal);
    const theirs = distance(this.rocks, foe.pos, foe.goal);
    if (me.rocks > 0 && (theirs < mine || (theirs <= 2 && Math.random() < 0.8))) {
      let best = null;
      let gain = 0;
      for (let cell = 0; cell < SIZE * SIZE; cell++) {
        if (!this.canRock(cell)) continue;
        const rocks = new Set(this.rocks).add(cell);
        const g = distance(rocks, foe.pos, foe.goal) - theirs - (distance(rocks, me.pos, me.goal) - mine) * 0.6;
        if (g > gain) {
          gain = g;
          best = cell;
        }
      }
      if (best != null) return this.move(p, 'rock', { cell: best });
    }
    if (me.pick > 0 && mine >= theirs + 3) {
      for (const rock of this.rocks) {
        const rocks = new Set(this.rocks);
        rocks.delete(rock);
        if (distance(rocks, me.pos, me.goal) < mine - 1) return this.move(p, 'pick', { cell: rock });
      }
    }
    return this.autoStep(p);
  }

  /** Hedefe en yakın kareye yürür; gidecek yer yoksa sırayı geçer (oyun takılı kalmasın) */
  autoStep(p) {
    const me = this.state.get(p);
    const options = [...this.steps(p)].sort((a, b) => distance(this.rocks, a, me.goal) - distance(this.rocks, b, me.goal));
    if (options.length) return this.move(p, 'step', { cell: options[0] });
    return this.endTurn(p, `${p.name} yürüyemedi, sırasını geçti`);
  }

  onTimeout(p) {
    if (this.phase !== 'playing') return;
    this.autoStep(p);
  }

  onLeave(p) {
    this.finish([this.other(p)], `${p.name} oyundan çıktı`);
  }

  view(userId) {
    const base = this.baseView(userId);
    const me = this.players.find((p) => p.id === userId);
    const playing = this.phase !== 'waiting' && this.state;
    const myTurn = Boolean(me && this.phase === 'playing' && this.order[this.current] === me);
    return {
      ...base, size: SIZE, rocksMax: ROCKS,
      rocks: playing ? [...this.rocks] : [],
      pawns: playing ? this.players.map((p, i) => ({ seat: p.seat, name: p.name, pos: this.state.get(p).pos, goal: this.state.get(p).goal, rocks: this.state.get(p).rocks, pick: this.state.get(p).pick, color: i })) : [],
      steps: myTurn ? [...this.steps(me)] : [],
      lastAction: this.lastAction ?? null,
    };
  }
}
