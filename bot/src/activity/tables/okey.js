// Okey 101: 4 kişilik masa, 106 taş (4 renk × 1-13 × 2 + 2 sahte okey). Gösterge taşının bir üstü okeydir (her taşın yerine geçer),
// sahte okey okeyin kendisi yerine kullanılır. Başlayan 22, diğerleri 21 taş alır. Sırada desteden ya da soldakinin attığından çekilir,
// el en az 101 sayıyla (seri/grup) ya da 5 çiftle açılır, açan masadaki perlere taş işleyebilir, bir taş atılır.
// Elindeki son taşı atan kazanır ve potu alır. Deste biterse ceza puanı (eldeki taşların toplamı, açmayana 202) en düşük olan kazanır.
import { randomInt } from 'node:crypto';
import { UserError } from '../../utils/errors.js';
import { TurnTable } from './turnTable.js';
import { isBot } from './hub.js';

export const OKEY_STAKES = [100, 500, 2500, 10000];
export const COLORS = ['kirmizi', 'sari', 'mavi', 'siyah'];
const OPEN_MIN = 101;
const PAIRS_MIN = 5;

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ── Taş ve per kuralları ──
export function makeRules(indicator) {
  const okey = { color: indicator.color, num: (indicator.num % 13) + 1 };
  const wild = (t) => !t.fake && t.color === okey.color && t.num === okey.num;
  const face = (t) => (t.fake ? okey : t); // sahte okey okeyin kendi değerini taşır

  /** Per geçerli mi: { kind, points, order } ya da null. order: ekranda gösterilecek sıra. */
  function meld(tiles) {
    if (tiles.length < 3) return null;
    const jokers = tiles.filter(wild);
    const normals = tiles.filter((t) => !wild(t));
    // Grup: aynı sayı, farklı renkler, 3-4 taş
    if (tiles.length <= 4 && normals.length) {
      const num = face(normals[0]).num;
      const colors = new Set(normals.map((t) => face(t).color));
      if (normals.every((t) => face(t).num === num) && colors.size === normals.length) {
        return { kind: 'set', points: num * tiles.length, order: [...normals, ...jokers] };
      }
    }
    // Seri: aynı renk ardışık; 1 başta (1-2-3) ya da 13'ün ardında (12-13-1) olabilir
    if (!normals.length) return null;
    const color = face(normals[0]).color;
    if (!normals.every((t) => face(t).color === color)) return null;
    const L = tiles.length;
    let best = null;
    for (let start = 1; start + L - 1 <= 14; start++) {
      const end = start + L - 1;
      const slots = new Map();
      let ok = true;
      for (const t of normals) {
        let n = face(t).num;
        if (n === 1 && (n < start || n > end)) n = 14;
        if (n < start || n > end || slots.has(n)) {
          ok = false;
          break;
        }
        slots.set(n, t);
      }
      if (!ok || L - slots.size > jokers.length) continue;
      const free = [...jokers];
      const order = [];
      let points = 0;
      for (let n = start; n <= end; n++) {
        order.push(slots.get(n) ?? free.shift());
        points += n === 14 ? 11 : n;
      }
      if (!best || points > best.points) best = { kind: 'run', points, order };
    }
    return best;
  }

  /** Çift: aynı renk aynı sayı iki taş (okey her taşla çift olur) */
  function pair(tiles) {
    if (tiles.length !== 2) return null;
    const [a, b] = tiles;
    if (wild(a) || wild(b) || (face(a).color === face(b).color && face(a).num === face(b).num)) return { kind: 'pair', points: 0, order: tiles };
    return null;
  }

  return { okey, wild, face, meld, pair };
}

/** Bot ve ipucu için: eldeki taşlardan en çok sayı getiren ayrık perler (sınırlı arama) */
export function findMelds(hand, rules) {
  const { wild, face, meld } = rules;
  const jokers = hand.filter(wild);
  const normals = hand.filter((t) => !wild(t));
  const cands = [];
  // Gruplar
  for (let num = 1; num <= 13; num++) {
    const byColor = new Map();
    for (const t of normals) if (face(t).num === num && !byColor.has(face(t).color)) byColor.set(face(t).color, t);
    const one = [...byColor.values()];
    const combos = (arr, k) => (k === 0 ? [[]] : arr.flatMap((x, i) => combos(arr.slice(i + 1), k - 1).map((c) => [x, ...c])));
    for (const k of [4, 3]) for (const c of combos(one, k)) cands.push(c);
    if (jokers.length) for (const c of combos(one, 2)) cands.push([...c, jokers[0]]);
  }
  // Seriler
  for (const color of COLORS.keys()) {
    const byNum = new Map();
    for (const t of normals) if (face(t).color === color && !byNum.has(face(t).num)) byNum.set(face(t).num, t);
    if (byNum.has(1)) byNum.set(14, byNum.get(1));
    for (let s = 1; s <= 12; s++) {
      for (let e = s + 2; e <= 14; e++) {
        const run = [];
        let gaps = 0;
        for (let n = s; n <= e; n++) {
          if (byNum.has(n)) run.push(byNum.get(n));
          else gaps++;
        }
        if (gaps > Math.min(1, jokers.length) || new Set(run).size !== run.length) continue;
        cands.push(gaps ? [...run, jokers[0]] : run);
      }
    }
  }
  const scored = cands.map((tiles) => ({ tiles, m: meld(tiles) })).filter((c) => c.m).sort((a, b) => b.m.points - a.m.points);
  let best = { points: 0, melds: [] };
  let nodes = 0;
  const dfs = (i, used, chosen, points) => {
    if (++nodes > 30000) return;
    if (points > best.points) best = { points, melds: [...chosen] };
    for (let k = i; k < scored.length; k++) {
      const c = scored[k];
      if (c.tiles.some((t) => used.has(t))) continue;
      for (const t of c.tiles) used.add(t);
      chosen.push(c.tiles);
      dfs(k + 1, used, chosen, points + c.m.points);
      chosen.pop();
      for (const t of c.tiles) used.delete(t);
    }
  };
  dfs(0, new Set(), [], 0);
  return best;
}

export class OkeyTable extends TurnTable {
  constructor(id, guildId, name, stake) {
    super(id, guildId, name, 'okey', { seats: 4, minPlayers: 4, stake, turnMs: 45_000 });
    this.resetGame();
  }

  resetGame() {
    this.deck = [];
    this.melds = [];
    this.indicator = null;
  }

  startGame() {
    const tiles = [];
    let id = 0;
    for (let copy = 0; copy < 2; copy++) for (const c of COLORS.keys()) for (let n = 1; n <= 13; n++) tiles.push({ id: id++, color: c, num: n, fake: false });
    tiles.push({ id: id++, color: -1, num: 0, fake: true }, { id: id++, color: -1, num: 0, fake: true });
    shuffle(tiles);
    const iIndex = tiles.findIndex((t) => !t.fake);
    this.indicator = tiles.splice(iIndex, 1)[0];
    this.rules = makeRules(this.indicator);
    this.order = [...this.players].sort((a, b) => a.seat - b.seat);
    this.current = randomInt(this.order.length);
    this.hands = new Map();
    this.order.forEach((p, i) => this.hands.set(p, tiles.splice(0, i === this.current ? 22 : 21)));
    this.deck = tiles;
    this.discards = new Map(this.order.map((p) => [p, []]));
    this.opened = new Map(this.order.map((p) => [p, null])); // null | 'melds' | 'pairs'
    this.melds = [];
    this.penalties = null;
    this.startTurn();
  }

  hand(p) {
    return this.hands.get(p);
  }

  left(p) {
    const i = this.order.indexOf(p);
    return this.order[(i - 1 + this.order.length) % this.order.length];
  }

  startTurn() {
    const p = this.order[this.current];
    this.turnState = { drawn: this.hand(p).length >= 22, took: null, changed: false };
    this.setTurn(p);
  }

  take(p, ids) {
    const hand = this.hand(p);
    const tiles = ids.map((id) => hand.find((t) => t.id === Number(id)));
    if (tiles.some((t) => !t) || new Set(ids.map(Number)).size !== ids.length) throw new UserError('Bu taşlar elinde değil.');
    return tiles;
  }

  removeFromHand(p, tiles) {
    const set = new Set(tiles);
    this.hands.set(p, this.hand(p).filter((t) => !set.has(t)));
    this.turnState.changed = true;
  }

  draw(p, from) {
    if (this.turnState.drawn) throw new UserError('Bu el zaten taş çektin.');
    if (from === 'discard') {
      const pile = this.discards.get(this.left(p));
      if (!pile.length) throw new UserError('Yerde alınacak taş yok.');
      const tile = pile.pop();
      this.hand(p).push(tile);
      this.turnState.took = tile;
      this.note(`${p.name} yerden taş aldı.`);
    } else {
      if (!this.deck.length) return this.deckOut();
      this.hand(p).push(this.deck.pop());
    }
    this.turnState.drawn = true;
  }

  /** Deste bitti: eldeki taşların toplamı ceza sayılır, açmayan 202 alır; en düşük cezalı kazanır */
  deckOut() {
    const { wild, face } = this.rules;
    const penalty = (p) => (this.opened.get(p) ? this.hand(p).reduce((s, t) => s + (wild(t) ? 0 : face(t).num), 0) : 202);
    const scores = this.order.map((p) => [p, penalty(p)]);
    const low = Math.min(...scores.map(([, s]) => s));
    this.penalties = Object.fromEntries(scores.map(([p, s]) => [p.seat, s]));
    this.finish(scores.filter(([, s]) => s === low).map(([p]) => p), `deste bitti, en az ceza ${low}`);
  }

  /** Perleri açar ya da (açtıysa) yeni per ekler */
  open(p, groups) {
    if (!this.turnState.drawn) throw new UserError('Önce taş çek.');
    if (!Array.isArray(groups) || !groups.length) throw new UserError('Açmak için per seç.');
    const used = [];
    const results = groups.map((ids) => {
      const tiles = this.take(p, Array.isArray(ids) ? ids : []);
      used.push(...tiles);
      return { tiles, m: this.rules.meld(tiles) ?? this.rules.pair(tiles) };
    });
    if (new Set(used).size !== used.length) throw new UserError('Aynı taşı iki perde kullanamazsın.');
    if (results.some((r) => !r.m)) throw new UserError('Perlerden biri geçersiz: seri aynı renk ardışık, grup aynı sayı farklı renk olmalı.');
    const was = this.opened.get(p);
    const pairs = results.every((r) => r.m.kind === 'pair');
    if (results.some((r) => r.m.kind === 'pair') && !pairs) throw new UserError('Çiftlerle serileri aynı anda açamazsın.');
    if (!was) {
      if (pairs && results.length < PAIRS_MIN) throw new UserError(`Çiftle açmak için en az ${PAIRS_MIN} çift gerekir.`);
      const total = results.reduce((s, r) => s + r.m.points, 0);
      if (!pairs && total < OPEN_MIN) throw new UserError(`Açmak için en az ${OPEN_MIN} gerekir; perlerin ${total} ediyor.`);
      if (this.hand(p).length - used.length < 1) throw new UserError('Açtıktan sonra atacak bir taşın kalmalı.');
      this.opened.set(p, pairs ? 'pairs' : 'melds');
      this.note(`${p.name} ${pairs ? `${results.length} çiftle` : `${total} ile`} elini açtı.`);
    } else {
      if (pairs && was !== 'pairs') throw new UserError('Serilerle açtın, sonradan çift açamazsın.');
      if (this.hand(p).length - used.length < 1) throw new UserError('Atacak bir taşın kalmalı.');
    }
    this.removeFromHand(p, used);
    for (const r of results) this.melds.push({ owner: p.seat, kind: r.m.kind, tiles: r.m.order });
  }

  /** Masadaki bir pere taş işler */
  add(p, meldIndex, ids) {
    if (!this.opened.get(p)) throw new UserError('İşlemek için önce elini açmalısın.');
    if (!this.turnState.drawn) throw new UserError('Önce taş çek.');
    const target = this.melds[Number(meldIndex)];
    if (!target || target.kind === 'pair') throw new UserError('Bu pere taş işlenemez.');
    const tiles = this.take(p, ids);
    if (this.hand(p).length - tiles.length < 1) throw new UserError('Atacak bir taşın kalmalı.');
    const m = this.rules.meld([...target.tiles, ...tiles]);
    if (!m || m.kind !== target.kind) throw new UserError('Bu taş o pere uymuyor.');
    target.tiles = m.order;
    this.removeFromHand(p, tiles);
    this.note(`${p.name} taş işledi.`);
  }

  discard(p, id) {
    if (!this.turnState.drawn) throw new UserError('Önce taş çek.');
    const [tile] = this.take(p, [id]);
    const took = this.turnState.took;
    if (took && this.hand(p).includes(took) && tile !== took) throw new UserError('Yerden aldığın taşı bu el bir perde kullanmalısın (ya da Geri Bırak).');
    if (took && tile === took) throw new UserError('Yerden aldığın taşı geri atamazsın; Geri Bırak\'ı kullan.');
    this.removeFromHand(p, [tile]);
    this.discards.get(p).push(tile);
    clearTimeout(this.timer);
    if (!this.hand(p).length) return this.finish([p], 'elini bitirdi');
    this.current = (this.current + 1) % this.order.length;
    this.startTurn();
  }

  move(p, action, body) {
    // Pes etmek sıra beklemeden yapılabilir
    if (action === 'resign') return this.onLeave(p);
    if (this.order[this.current] !== p) throw new UserError('Sıra sende değil.');
    if (action === 'draw') return this.draw(p, body.from === 'discard' ? 'discard' : 'deck');
    if (action === 'untake') {
      const took = this.turnState.took;
      if (!took || !this.hand(p).includes(took)) throw new UserError('Geri bırakılacak taş yok.');
      this.removeFromHand(p, [took]);
      this.discards.get(this.left(p)).push(took);
      this.turnState = { drawn: false, took: null, changed: false };
      return;
    }
    if (action === 'open') return this.open(p, body.groups);
    if (action === 'add') return this.add(p, body.meld, Array.isArray(body.tiles) ? body.tiles : []);
    if (action === 'discard') return this.discard(p, body.tile);
    throw new UserError('Geçersiz hamle.');
  }

  /** Bot ve süresi dolan oyuncu: desteden çeker, açabiliyorsa açar, işler, en işe yaramaz taşı atar */
  botMove(p) {
    if (this.order[this.current] !== p) return;
    const ts = this.turnState;
    if (ts.took && this.hand(p).includes(ts.took)) this.move(p, 'untake', {});
    if (!this.turnState.drawn) {
      this.draw(p, 'deck');
      if (this.phase !== 'playing') return;
    }
    const rules = this.rules;
    const best = findMelds(this.hand(p), rules);
    const opened = this.opened.get(p);
    const tryOpen = (groups) => {
      try {
        this.open(p, groups.map((g) => g.map((t) => t.id)));
        return true;
      } catch {
        return false;
      }
    };
    if (!opened) {
      if (best.points >= OPEN_MIN && this.hand(p).length - best.melds.flat().length >= 1) tryOpen(best.melds);
      else {
        const pairs = this.findPairs(this.hand(p));
        if (pairs.length >= PAIRS_MIN && this.hand(p).length - pairs.length * 2 >= 1) tryOpen(pairs);
      }
    } else if (opened === 'melds' && best.melds.length) {
      for (const g of best.melds) if (this.hand(p).length - g.length >= 1) tryOpen([g]);
    }
    if (this.opened.get(p) === 'melds') {
      for (const t of [...this.hand(p)]) {
        if (this.hand(p).length <= 1) break;
        for (let i = 0; i < this.melds.length; i++) {
          try {
            this.add(p, i, [t.id]);
            break;
          } catch {}
        }
      }
    }
    this.discard(p, this.worstTile(p).id);
  }

  findPairs(hand) {
    const { wild, face } = this.rules;
    const seen = new Map();
    const pairs = [];
    for (const t of hand) {
      if (wild(t)) continue;
      const k = `${face(t).color}-${face(t).num}`;
      if (seen.has(k)) {
        pairs.push([seen.get(k), t]);
        seen.delete(k);
      } else seen.set(k, t);
    }
    return pairs;
  }

  /** Hiçbir olası perde yer almayan, en yüksek taş (okey asla atılmaz) */
  worstTile(p) {
    const hand = this.hand(p);
    const { wild, face } = this.rules;
    const useful = new Set(findMelds(hand, this.rules).melds.flat());
    const near = (t) => hand.some((o) => o !== t && !wild(o) && ((face(o).color === face(t).color && Math.abs(face(o).num - face(t).num) <= 2) || (face(o).num === face(t).num && face(o).color !== face(t).color)));
    const candidates = hand.filter((t) => !wild(t) && t !== this.turnState.took);
    const pool = candidates.length ? candidates : hand.filter((t) => t !== this.turnState.took);
    return pool.sort((a, b) => (useful.has(a) - useful.has(b)) || (near(a) - near(b)) || face(b).num - face(a).num)[0] ?? hand[0];
  }

  onTimeout(p) {
    if (this.phase !== 'playing') return;
    this.note(`${p.name} süresi doldu.`);
    this.botMove(p);
  }

  /** Oyundan çıkanın yerine bot oynar; girişini kaybeder */
  onLeave(p) {
    p.gone = true;
    this.note(`${p.name} çıktı, yerine bot oynuyor.`);
    if (this.order[this.current] === p) this.botLater(() => this.botMove(p), 800);
  }

  view(userId) {
    const base = this.baseView(userId);
    const me = this.order?.find((p) => p.id === userId);
    const live = this.phase !== 'waiting' && this.hands;
    const tile = (t) => ({ id: t.id, c: t.color, n: t.num, f: t.fake, w: this.rules?.wild(t) ?? false });
    const myTurn = Boolean(me && this.phase === 'playing' && this.order[this.current] === me);
    return {
      ...base,
      indicator: live ? tile(this.indicator) : null,
      okey: live ? this.rules.okey : null,
      deck: live ? this.deck.length : 0,
      hand: live && me ? this.hand(me).map(tile) : [],
      players: live ? this.order.map((p) => ({
        seat: p.seat, name: p.name, tiles: this.hand(p).length, opened: this.opened.get(p),
        discard: this.discards.get(p).length ? tile(this.discards.get(p).at(-1)) : null, gone: Boolean(p.gone),
        hand: this.phase === 'result' ? this.hand(p).map(tile) : null,
        penalty: this.phase === 'result' ? this.penalties?.[p.seat] ?? null : null,
      })) : [],
      leftSeat: me && live ? this.left(me).seat : -1,
      melds: live ? this.melds.map((m) => ({ owner: m.owner, kind: m.kind, tiles: m.tiles.map(tile) })) : [],
      myTurn, drawn: myTurn ? this.turnState.drawn : false, took: myTurn && this.turnState.took ? this.turnState.took.id : null,
      opened: me && live ? this.opened.get(me) : null,
    };
  }
}
