// Ortak rulet (tek sıfırlı, Avrupa). Odadaki herkes aynı çarka bahis koyar. İlk bahisle geri sayım başlar;
// odadaki herkes bahsini koyduysa beklemeden döner, tek başına oynayan hemen çevirir.
import { randomInt } from 'node:crypto';
import { UserError } from '../../utils/errors.js';
import { Room, hold, release } from './hub.js';

export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const BET_KEY = /^(?:n(?:[0-9]|[12][0-9]|3[0-6])|red|black|even|odd|low|high|d[123]|c[123])$/;

/** İç bahisler (sayılar küçükten büyüğe, "g1-2-4-5"): ayrık 2, sokak/üçlü 3, köşe 4, altılı 6 sayı. Masada geçerli olan gruplar: */
export const GROUPS = (() => {
  const out = new Set();
  const add = (...nums) => out.add(`g${nums.join('-')}`);
  for (let n = 1; n <= 36; n++) {
    if (n % 3 !== 0) add(n, n + 1); // dikey ayrık
    if (n <= 33) add(n, n + 3); // yatay ayrık
    if (n % 3 !== 0 && n <= 32) add(n, n + 1, n + 3, n + 4); // köşe
  }
  for (let r = 1; r <= 12; r++) add(3 * r - 2, 3 * r - 1, 3 * r); // sokak
  for (let r = 1; r <= 11; r++) add(3 * r - 2, 3 * r - 1, 3 * r, 3 * r + 1, 3 * r + 2, 3 * r + 3); // altılı
  add(0, 1); add(0, 2); add(0, 3); add(0, 1, 2); add(0, 2, 3); add(0, 1, 2, 3); // sıfırlı ayrık, üçlü ve ilk dört
  return out;
})();
const validKey = (key) => BET_KEY.test(key) || GROUPS.has(key);
const MAX_CELLS = 40;
const BET_MS = 15_000;
const SPIN_MS = 5_000;
const RESULT_MS = 4_500;

/** Bahis anahtarı ve gelen sayı için ödeme çarpanı (bahis dahil). 0 gelince dış bahisler kaybeder. */
export function multiplier(key, n) {
  if (key[0] === 'n') return Number(key.slice(1)) === n ? 36 : 0;
  if (key[0] === 'g') {
    const nums = key.slice(1).split('-').map(Number);
    return nums.includes(n) ? 36 / nums.length : 0;
  }
  if (n === 0) return 0;
  switch (key) {
    case 'red': return RED.has(n) ? 2 : 0;
    case 'black': return RED.has(n) ? 0 : 2;
    case 'even': return n % 2 === 0 ? 2 : 0;
    case 'odd': return n % 2 === 1 ? 2 : 0;
    case 'low': return n <= 18 ? 2 : 0;
    case 'high': return n >= 19 ? 2 : 0;
    case 'd1': return n <= 12 ? 3 : 0;
    case 'd2': return n > 12 && n <= 24 ? 3 : 0;
    case 'd3': return n > 24 ? 3 : 0;
    case 'c1': return n % 3 === 1 ? 3 : 0;
    case 'c2': return n % 3 === 2 ? 3 : 0;
    case 'c3': return n % 3 === 0 ? 3 : 0;
    default: return 0;
  }
}

const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

export class RouletteRoom extends Room {
  constructor(guildId, minBet, maxBet, id = 'rulet') {
    super(id, 'rulet', guildId);
    this.name = 'Karia Ruleti';
    this.minBet = minBet;
    this.maxBet = maxBet;
    this.phase = 'open';
    this.bets = new Map(); // kullanıcı -> { name, cells: Map, total }
    this.history = [];
    this.last = null;
  }

  summary() {
    return { id: this.id, game: 'rulet', name: this.name, players: this.present().length, phase: this.phase };
  }

  act(user, action, body) {
    if (action !== 'bet') throw new UserError('Geçersiz hamle.');
    if (this.phase === 'spinning' || this.phase === 'result') throw new UserError('Çark dönüyor, bir sonraki tura bahis koy.');
    const entries = Object.entries(body.bets && typeof body.bets === 'object' ? body.bets : {});
    if (!entries.length) throw new UserError('Önce masaya bahis koy.');
    const prev = this.bets.get(user.id);
    const cells = new Map(prev?.cells);
    let total = prev?.total ?? 0;
    let added = 0;
    for (const [key, raw] of entries) {
      const amount = Number(raw);
      if (!validKey(key) || !Number.isInteger(amount) || amount < this.minBet) throw new UserError(`Her bahis en az ${this.minBet} coin olmalı.`);
      cells.set(key, (cells.get(key) ?? 0) + amount);
      added += amount;
    }
    if (cells.size > MAX_CELLS) throw new UserError('Çok fazla kutuya bahis koydun.');
    total += added;
    if (total > this.maxBet) throw new UserError(`Bir turda toplam bahis en fazla ${this.maxBet.toLocaleString('tr-TR')} coin olabilir.`);
    hold(this.guildId, user.id, added);
    this.bets.set(user.id, { name: user.name, cells, total });
    if (this.phase === 'open') {
      this.phase = 'betting';
      this.endsAt = Date.now() + BET_MS;
      this.schedule(() => this.spin(), BET_MS);
    }
    // Odada bakan herkes bahsini koyduysa beklenmez
    if (this.present().every((id) => this.bets.has(id))) this.schedule(() => this.spin(), 600);
  }

  spin() {
    if (!this.bets.size) {
      this.phase = 'open';
      return;
    }
    const result = randomInt(37);
    const winners = [];
    for (const [id, b] of this.bets) {
      const payout = [...b.cells].reduce((sum, [key, amount]) => sum + amount * multiplier(key, result), 0);
      b.payout = payout;
      release(this.guildId, id, b.total, payout);
      if (payout > 0) winners.push({ name: b.name, amount: payout });
    }
    this.last = { result, color: colorOf(result) };
    this.phase = 'spinning';
    this.spinAt = Date.now();
    this.schedule(() => {
      this.phase = 'result';
      this.history.unshift(this.last);
      this.history.length = Math.min(this.history.length, 14);
      this.note(winners.length ? winners.map((w) => `${w.name} +${w.amount.toLocaleString('tr-TR')}`).join(', ') : 'Bu turda kazanan yok.');
      this.schedule(() => {
        this.phase = 'open';
        this.bets.clear();
      }, RESULT_MS);
    }, SPIN_MS);
  }

  view(userId) {
    const mine = this.bets.get(userId);
    const reveal = this.phase === 'spinning' || this.phase === 'result';
    const players = [...this.bets].map(([id, b]) => ({ id, name: b.name, total: b.total, payout: this.phase === 'result' ? b.payout ?? 0 : null }));
    // Herkesin kutulara koyduğu toplam: masada kimin nereye oynadığı görünür
    const table = {};
    for (const b of this.bets.values()) for (const [key, amount] of b.cells) table[key] = (table[key] ?? 0) + amount;
    return {
      id: this.id, game: 'rulet', name: this.name, phase: this.phase, serverNow: Date.now(),
      endsAt: this.phase === 'betting' ? this.endsAt : 0, spinAt: this.spinAt, spinMs: SPIN_MS,
      result: reveal ? this.last : null, history: this.history, players, table,
      mine: mine ? Object.fromEntries(mine.cells) : {}, myTotal: mine?.total ?? 0,
      myPayout: this.phase === 'result' && mine ? mine.payout ?? 0 : null,
      minBet: this.minBet, maxBet: this.maxBet, log: this.log,
    };
  }
}
