// Zar Düellosu: masanın girişi sabittir. Hazır olanlar girişi pota koyar, herkes iki zar atar,
// en yüksek atan potun tamamını alır. Eşitlikte yalnızca berabere kalanlar yeniden atar. Ev payı yok.
import { randomInt } from 'node:crypto';
import { UserError } from '../../utils/errors.js';
import { Room, hold, release, isBot } from './hub.js';

export const DICE_ANTES = [100, 500, 2500, 10000];
const SEATS = 6;
const WAIT_MS = 10_000;
const ROLL_MS = 2_600;
const RESULT_MS = 5_000;

const roll = () => [randomInt(1, 7), randomInt(1, 7)];

export class DiceTable extends Room {
  constructor(id, guildId, name, ante) {
    super(id, 'zar', guildId);
    this.name = name;
    this.ante = ante;
    this.seats = Array(SEATS).fill(null);
    this.phase = 'waiting';
    this.endsAt = 0;
    this.rounds = [];
    this.winner = null;
    this.past = []; // son turlar
    this.maxBuy = 0;
  }

  seatedIds() {
    return this.seats.filter(Boolean).map((s) => s.id);
  }

  summary() {
    return { id: this.id, game: 'zar', name: this.name, players: this.seatedIds().length, max: SEATS, stake: this.ante.toLocaleString('tr-TR'), playing: this.phase !== 'waiting' };
  }

  join(user, body) {
    if (this.seats.some((s) => s?.id === user.id)) throw new UserError('Zaten bu masadasın.');
    const index = Number.isInteger(body.seat) && body.seat >= 0 && body.seat < SEATS && !this.seats[body.seat] ? body.seat : this.seats.findIndex((s) => !s);
    if (index < 0) throw new UserError('Masa dolu.');
    this.seats[index] = { id: user.id, name: user.name, seat: index, ready: false };
    this.note(`${user.name} masaya oturdu.`);
  }

  leave(userId) {
    const index = this.seats.findIndex((s) => s?.id === userId);
    if (index < 0) return;
    const p = this.seats[index];
    this.seats[index] = null;
    if (this.phase === 'waiting' && p.ready) release(this.guildId, p.id, this.ante, this.ante);
    this.note(`${p.name} masadan kalktı.`);
    this.checkStart();
  }

  readyPlayers() {
    return this.seats.filter((s) => s?.ready);
  }

  checkStart() {
    if (this.phase !== 'waiting') return;
    // Bir oyuncu hazır olunca masadaki botlar da katılır
    // Hazır insan kalmadıysa botlar da çekilir (botlar kendi aralarında tur atmasın)
    const humanReady = this.seats.some((s) => s?.ready && !isBot(s.id));
    for (const s of this.seats) if (s && isBot(s.id)) s.ready = humanReady;
    const ready = this.readyPlayers();
    if (ready.length < 2) {
      if (this.endsAt) {
        clearTimeout(this.timer);
        this.endsAt = 0;
      }
      return;
    }
    if (ready.length === this.seats.filter(Boolean).length) {
      this.endsAt = Date.now() + 800;
      this.schedule(() => this.play(), 800);
    } else if (!this.endsAt) {
      this.endsAt = Date.now() + WAIT_MS;
      this.schedule(() => this.play(), WAIT_MS);
    }
  }

  play() {
    const players = this.readyPlayers();
    this.endsAt = 0;
    if (players.length < 2) return;
    this.rounds = [];
    let alive = players;
    // Eşitlikte sadece en yüksek atanlar yeniden atar
    for (let i = 0; i < 20 && alive.length > 1; i++) {
      const rolls = Object.fromEntries(alive.map((p) => [p.id, roll()]));
      this.rounds.push(rolls);
      const best = Math.max(...alive.map((p) => rolls[p.id][0] + rolls[p.id][1]));
      alive = alive.filter((p) => rolls[p.id][0] + rolls[p.id][1] === best);
    }
    const pot = this.ante * players.length;
    const share = Math.floor(pot / alive.length);
    for (const p of players) release(this.guildId, p.id, this.ante, alive.includes(p) ? share : 0);
    this.winner = { ids: alive.map((p) => p.id), names: alive.map((p) => p.name), amount: share };
    this.players = players.map((p) => ({ id: p.id, name: p.name, seat: p.seat }));
    for (const p of players) p.ready = false;
    this.phase = 'rolling';
    this.schedule(() => {
      this.phase = 'result';
      this.note(`${this.winner.names.join(', ')} ${pot.toLocaleString('tr-TR')} coinlik potu aldı.`);
      const last = this.rounds.at(-1);
      this.past.unshift({ winners: this.winner.names, pot, players: this.players.length, best: Math.max(...Object.values(last).map(([a, b]) => a + b)) });
      this.past.length = Math.min(this.past.length, 10);
      this.schedule(() => {
        this.phase = 'waiting';
        this.rounds = [];
        this.winner = null;
        this.players = [];
      }, RESULT_MS);
    }, ROLL_MS * this.rounds.length);
  }

  act(user, action) {
    const p = this.seats.find((s) => s?.id === user.id);
    if (!p) throw new UserError('Bu masada oturmuyorsun.');
    if (this.phase !== 'waiting') throw new UserError('Zarlar atılıyor, bir sonraki tura katıl.');
    if (action === 'ready') {
      if (p.ready) throw new UserError('Zaten hazırsın.');
      hold(this.guildId, p.id, this.ante);
      p.ready = true;
    } else if (action === 'unready') {
      if (!p.ready) throw new UserError('Henüz hazır değilsin.');
      release(this.guildId, p.id, this.ante, this.ante);
      p.ready = false;
    } else throw new UserError('Geçersiz hamle.');
    this.checkStart();
  }

  view(userId) {
    const me = this.seats.find((s) => s?.id === userId);
    const showing = this.phase === 'rolling' || this.phase === 'result';
    return {
      id: this.id, game: 'zar', name: this.name, ante: this.ante, phase: this.phase, max: SEATS, serverNow: Date.now(),
      endsAt: this.endsAt, seats: this.seats.map((s) => s && { seat: s.seat, id: s.id, name: s.name, ready: s.ready }),
      mySeat: me?.seat ?? -1, ready: me?.ready ?? false,
      pot: showing ? this.ante * (this.players?.length ?? 0) : this.ante * this.readyPlayers().length,
      rounds: showing ? this.rounds : [], rollMs: ROLL_MS, players: showing ? this.players : [],
      winner: this.phase === 'result' ? this.winner : null, log: this.log, past: this.past,
    };
  }
}
