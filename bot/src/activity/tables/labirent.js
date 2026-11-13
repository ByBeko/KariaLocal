// Karia Labirent (koridor yarışı): 9×9 tahta, iki oyuncu karşı kenara ilk varmaya çalışır.
// Sırada ya bir kare yürürsün ya da iki kare uzunluğunda bir engeli karelerin arasına koyarsın (kişi başı 10 engel).
// Engeller kesişemez, üst üste binemez ve iki oyuncunun da hedefe giden yolunu tamamen kapatamaz.
// Rakip yanındaysa üstünden atlanır; arkasında engel varsa çapraz yana geçilir.
import { UserError } from '../../utils/errors.js';
import { TurnTable } from './turnTable.js';

export const LABIRENT_STAKES = [100, 500, 2500, 10000];
const SIZE = 9;
const WALLS = 10;
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const idx = (r, c) => r * SIZE + c;
const rc = (i) => [Math.floor(i / SIZE), i % SIZE];
const wallKey = (o, r, c) => `${o}-${r}-${c}`;

/** (r,c) karesinden (r+dr, c+dc) komşusuna geçiş bir engelle kapalı mı. walls: Set('h-r-c' | 'v-r-c') */
function blocked(walls, r, c, dr, dc) {
  if (dr === 1) return walls.has(wallKey('h', r, c)) || walls.has(wallKey('h', r, c - 1));
  if (dr === -1) return blocked(walls, r - 1, c, 1, 0);
  if (dc === 1) return walls.has(wallKey('v', r, c)) || walls.has(wallKey('v', r - 1, c));
  return blocked(walls, r, c - 1, 0, 1);
}

/** Hedef satırına en kısa yol (engeller duvar, oyuncular engel değil). Yol yoksa Infinity. */
function distance(walls, from, goalRow) {
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 0; frontier.length; d++) {
    const next = [];
    for (const i of frontier) {
      const [r0, c0] = rc(i);
      if (r0 === goalRow) return d;
      for (const [dr, dc] of DIRS) {
        const r = r0 + dr;
        const c = c0 + dc;
        const j = idx(r, c);
        if (inside(r, c) && !blocked(walls, r0, c0, dr, dc) && !seen.has(j)) {
          seen.add(j);
          next.push(j);
        }
      }
    }
    frontier = next;
  }
  return Infinity;
}

/** Engel kurallara uygun mu (yol kontrolü hariç): tahta içinde, üst üste binmiyor, kesişmiyor */
function wallFits(walls, o, r, c) {
  if (!['h', 'v'].includes(o) || !Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r > SIZE - 2 || c > SIZE - 2) return false;
  if (walls.has(wallKey('h', r, c)) || walls.has(wallKey('v', r, c))) return false; // aynı yerde ya da çapraz kesişme
  if (o === 'h') return !walls.has(wallKey('h', r, c - 1)) && !walls.has(wallKey('h', r, c + 1));
  return !walls.has(wallKey('v', r - 1, c)) && !walls.has(wallKey('v', r + 1, c));
}

export class LabirentTable extends TurnTable {
  constructor(id, guildId, name, stake) {
    super(id, guildId, name, 'labirent', { seats: 2, minPlayers: 2, stake, turnMs: 45_000 });
    this.resetGame();
  }

  resetGame() {
    this.walls = new Set();
    this.state = null;
  }

  startGame() {
    this.resetGame();
    const mid = Math.floor(SIZE / 2);
    this.state = new Map(this.players.map((p, i) => [p, { pos: i === 0 ? idx(SIZE - 1, mid) : idx(0, mid), goal: i === 0 ? 0 : SIZE - 1, walls: WALLS }]));
    this.order = [...this.players];
    this.current = Math.random() < 0.5 ? 0 : 1;
    this.lastAction = null;
    this.lastWall = null;
    this.setTurn(this.order[this.current]);
  }

  other(p) {
    return this.players.find((o) => o !== p);
  }

  /** Oyuncunun gidebileceği kareler: bir adım; rakip yanındaysa üstünden atlama, arkası kapalıysa çapraz yana */
  steps(p) {
    const me = this.state.get(p);
    const foe = this.state.get(this.other(p)).pos;
    const [r0, c0] = rc(me.pos);
    const out = new Set();
    for (const [dr, dc] of DIRS) {
      const r = r0 + dr;
      const c = c0 + dc;
      if (!inside(r, c) || blocked(this.walls, r0, c0, dr, dc)) continue;
      if (idx(r, c) !== foe) {
        out.add(idx(r, c));
        continue;
      }
      if (inside(r + dr, c + dc) && !blocked(this.walls, r, c, dr, dc)) {
        out.add(idx(r + dr, c + dc));
        continue;
      }
      for (const [sr, sc] of dr ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]]) {
        if (inside(r + sr, c + sc) && !blocked(this.walls, r, c, sr, sc)) out.add(idx(r + sr, c + sc));
      }
    }
    return out;
  }

  /** Engel konabilir mi: yerine sığıyor ve iki oyuncunun da yolu açık kalıyor */
  canWall(o, r, c) {
    if (!wallFits(this.walls, o, r, c)) return false;
    const walls = new Set(this.walls).add(wallKey(o, r, c));
    return [...this.state.values()].every((s) => distance(walls, s.pos, s.goal) < Infinity);
  }

  legalWalls() {
    const out = [];
    for (const o of ['h', 'v']) for (let r = 0; r < SIZE - 1; r++) for (let c = 0; c < SIZE - 1; c++) if (this.canWall(o, r, c)) out.push(wallKey(o, r, c));
    return out;
  }

  endTurn(p, text) {
    this.lastAction = text;
    clearTimeout(this.timer);
    const me = this.state.get(p);
    if (rc(me.pos)[0] === me.goal) return this.finish([p], 'karşı kenara ulaştı');
    this.current = 1 - this.current;
    this.setTurn(this.order[this.current]);
  }

  move(p, action, body) {
    if (action === 'resign') return this.finish([this.other(p)], `${p.name} çekildi`);
    if (this.order[this.current] !== p) throw new UserError('Sıra sende değil.');
    const me = this.state.get(p);
    if (action === 'step') {
      const cell = Number(body.cell);
      if (!this.steps(p).has(cell)) throw new UserError('Oraya gidemezsin.');
      me.pos = cell;
      this.lastWall = null;
      return this.endTurn(p, `${p.name} yürüdü`);
    }
    if (action === 'wall') {
      const o = body.o === 'v' ? 'v' : 'h';
      const r = Number(body.r);
      const c = Number(body.c);
      if (me.walls <= 0) throw new UserError('Engelin kalmadı, yürümelisin.');
      if (!wallFits(this.walls, o, r, c)) throw new UserError('Oraya engel konmaz (başka bir engelle çakışıyor).');
      if (!this.canWall(o, r, c)) throw new UserError('Bu engel yolu tamamen kapatır; her iki oyuncuya da bir yol kalmalı.');
      this.walls.add(wallKey(o, r, c));
      this.lastWall = wallKey(o, r, c);
      me.walls--;
      return this.endTurn(p, `${p.name} engel koydu`);
    }
    throw new UserError('Geçersiz hamle.');
  }

  /** Rakip yolda öndeyse yolunu en çok uzatan engeli koyar; değilse en kısa yoldan yürür */
  botMove(p) {
    if (this.order[this.current] !== p) return;
    const me = this.state.get(p);
    const foe = this.state.get(this.other(p));
    const mine = distance(this.walls, me.pos, me.goal);
    const theirs = distance(this.walls, foe.pos, foe.goal);
    if (me.walls > 0 && (theirs < mine || (theirs <= 3 && Math.random() < 0.7) || Math.random() < 0.12)) {
      let best = null;
      let gain = 0;
      for (const k of this.legalWalls()) {
        const walls = new Set(this.walls).add(k);
        const g = distance(walls, foe.pos, foe.goal) - theirs - (distance(walls, me.pos, me.goal) - mine) * 1.2 + Math.random() * 0.3;
        if (g > gain) {
          gain = g;
          best = k;
        }
      }
      if (best && gain >= 1) {
        const [o, r, c] = best.split('-');
        return this.move(p, 'wall', { o, r: Number(r), c: Number(c) });
      }
    }
    return this.autoStep(p);
  }

  /** Hedefe en yakın kareye yürür; gidecek yer yoksa sırayı geçer (oyun takılı kalmasın) */
  autoStep(p) {
    const me = this.state.get(p);
    const options = [...this.steps(p)].sort((a, b) => distance(this.walls, a, me.goal) - distance(this.walls, b, me.goal));
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
      ...base, size: SIZE, wallsMax: WALLS,
      walls: playing ? [...this.walls] : [],
      lastWall: playing ? this.lastWall : null,
      pawns: playing ? this.players.map((p, i) => {
        const s = this.state.get(p);
        return { seat: p.seat, name: p.name, pos: s.pos, goal: s.goal, walls: s.walls, color: i, dist: distance(this.walls, s.pos, s.goal) };
      }) : [],
      steps: myTurn ? [...this.steps(me)] : [],
      wallOk: myTurn && this.state.get(me).walls > 0 ? this.legalWalls() : [],
      lastAction: this.lastAction ?? null,
    };
  }
}
