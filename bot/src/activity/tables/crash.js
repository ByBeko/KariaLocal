// Süper Tayyare: herkes aynı uçuşa bahis koyar, çarpan yükselir, tayyare düşmeden "Çek" diyen kazanır.
// Düşüş noktası kalkışta sunucuda belirlenir ve uçuş bitene kadar kimseye gösterilmez. Ev payı %3.
import { randomInt } from 'node:crypto';
import { UserError } from '../../utils/errors.js';
import { Room, hold, release, amountOf } from './hub.js';

const K = 0.00008; // çarpan = e^(K × ms): 2× ≈ 8,7 sn, 10× ≈ 29 sn
const BET_MS = 8_000;
const END_MS = 4_000;
const MAX_X = 1000;
const IDLE_MS = 45_000;

const multAt = (ms) => Math.max(1, Math.floor(Math.exp(K * Math.max(0, ms)) * 100) / 100);

export class CrashRoom extends Room {
  constructor(guildId, minBet, maxBet, id = 'tayyare', betMs = BET_MS) {
    super(id, 'tayyare', guildId);
    this.betMs = betMs;
    this.name = 'Süper Tayyare';
    this.minBet = minBet;
    this.maxBet = maxBet;
    this.phase = 'idle';
    this.bets = new Map();
    this.history = [];
  }

  summary() {
    return { id: this.id, game: 'tayyare', name: this.name, players: this.present().length, phase: this.phase };
  }

  /** Biri bakınca uçuşlar başlar; kimse yoksa durur */
  wake() {
    if (this.phase === 'idle') {
      this.openBetting();
      this.bump();
    }
  }

  openBetting() {
    this.phase = 'betting';
    this.bets.clear();
    this.crashAt = 0;
    this.endsAt = Date.now() + this.betMs;
    this.schedule(() => this.takeOff(), this.betMs);
  }

  takeOff() {
    if (!this.bets.size && !this.present(IDLE_MS).length) {
      this.phase = 'idle';
      return;
    }
    const r = randomInt(0, 2 ** 32) / 2 ** 32;
    this.crashAt = Math.min(MAX_X, Math.max(1, Math.floor(97 / (1 - r)) / 100));
    this.phase = 'flying';
    this.startAt = Date.now();
    const flight = Math.log(this.crashAt) / K;
    clearInterval(this.tick);
    this.tick = setInterval(() => {
      if (this.autoCashouts(multAt(Date.now() - this.startAt))) this.bump();
    }, 100);
    this.tick.unref?.();
    this.schedule(() => this.crash(), flight);
  }

  /** Otomatik çekme hedefine ulaşanlar tam hedeften öder. Değişiklik olduysa true. */
  autoCashouts(m) {
    let changed = false;
    for (const [id, b] of this.bets) {
      if (!b.cashedAt && b.auto && b.auto <= m && b.auto < this.crashAt) {
        this.cashout(id, b.auto);
        changed = true;
      }
    }
    return changed;
  }

  cashout(userId, m) {
    const b = this.bets.get(userId);
    b.cashedAt = m;
    b.win = Math.floor(b.bet * m);
    release(this.guildId, userId, b.bet, b.win);
  }

  crash() {
    clearInterval(this.tick);
    this.autoCashouts(this.crashAt);
    for (const [id, b] of this.bets) if (!b.cashedAt) release(this.guildId, id, b.bet, 0);
    this.phase = 'crashed';
    this.history.unshift(this.crashAt);
    this.history.length = Math.min(this.history.length, 16);
    this.endsAt = Date.now() + END_MS;
    this.schedule(() => this.openBetting(), END_MS);
  }

  act(user, action, body) {
    if (action === 'bet') {
      this.wake();
      if (this.phase !== 'betting') throw new UserError('Tayyare havada, bir sonraki uçuşa bahis koy.');
      if (this.bets.has(user.id)) throw new UserError('Bu uçuşa zaten bahis koydun.');
      const bet = amountOf(body.bet, this.minBet, this.maxBet);
      let auto = null;
      if (body.auto != null && body.auto !== '') {
        auto = Math.floor(Number(String(body.auto).replace(',', '.')) * 100) / 100;
        if (!Number.isFinite(auto) || auto < 1.01 || auto > MAX_X) throw new UserError('Otomatik çekme 1,01× ile 1000× arasında olmalı.');
      }
      hold(this.guildId, user.id, bet);
      this.bets.set(user.id, { name: user.name, bet, auto, cashedAt: 0, win: 0 });
      return;
    }
    if (action === 'cancel') {
      const b = this.bets.get(user.id);
      if (!b || this.phase !== 'betting') throw new UserError('Geri alınacak bahis yok.');
      release(this.guildId, user.id, b.bet, b.bet);
      this.bets.delete(user.id);
      return;
    }
    if (action === 'cashout') {
      const b = this.bets.get(user.id);
      if (!b || this.phase !== 'flying') throw new UserError('Çekilecek bahis yok.');
      if (b.cashedAt) throw new UserError('Zaten çektin.');
      const m = multAt(Date.now() - this.startAt);
      if (m >= this.crashAt) throw new UserError('Geç kaldın, tayyare düştü!');
      this.cashout(user.id, m);
      return;
    }
    throw new UserError('Geçersiz hamle.');
  }

  view(userId) {
    const mine = this.bets.get(userId);
    const bets = [...this.bets].map(([id, b]) => ({ id, name: b.name, bet: b.bet, cashedAt: b.cashedAt, win: b.win }))
      .sort((a, b) => b.bet - a.bet);
    return {
      id: this.id, game: 'tayyare', name: this.name, phase: this.phase, betMs: this.betMs, serverNow: Date.now(), k: K,
      endsAt: this.endsAt, startAt: this.startAt, crashAt: this.phase === 'crashed' ? this.crashAt : 0,
      history: this.history, bets, minBet: this.minBet, maxBet: this.maxBet,
      me: mine ? { bet: mine.bet, auto: mine.auto, cashedAt: mine.cashedAt, win: mine.win } : null,
    };
  }
}
