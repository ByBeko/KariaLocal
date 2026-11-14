// Sıra tabanlı masa oyunlarının (satranç, okey 101, labirent) ortak yanı: oturma, giriş ücreti, hazır olma,
// botlar, sıra süresi, oyundan çıkma ve kazanana pot. Oyun kuralları alt sınıftadır.
import { UserError } from '../../utils/errors.js';
import { Room, hold, release, isBot } from './hub.js';

const START_MS = 1_500;
const RESULT_MS = 7_000;

export class TurnTable extends Room {
  /** opts: { seats, minPlayers, stake, turnMs, title } */
  constructor(id, guildId, name, game, opts) {
    super(id, game, guildId);
    this.name = name;
    this.max = opts.seats;
    this.minPlayers = opts.minPlayers;
    this.stake = opts.stake;
    this.turnMs = opts.turnMs;
    this.seats = Array(this.max).fill(null);
    this.phase = 'waiting'; // waiting | playing | result
    this.players = []; // oyundaki koltuklar (oyun boyunca sabit)
    this.result = null;
    this.past = [];
    this.maxBuy = 0;
  }

  seatedIds() {
    return this.seats.filter(Boolean).map((s) => s.id);
  }

  summary() {
    return { id: this.id, game: this.game, name: this.name, players: this.seatedIds().length, max: this.max, stake: this.stake.toLocaleString('tr-TR'), playing: this.phase === 'playing' };
  }

  join(user, body = {}) {
    if (this.seats.some((s) => s?.id === user.id)) throw new UserError('Zaten bu masadasın.');
    const index = Number.isInteger(body.seat) && body.seat >= 0 && body.seat < this.max && !this.seats[body.seat] ? body.seat : this.seats.findIndex((s) => !s);
    if (index < 0) throw new UserError('Masa dolu.');
    this.seats[index] = { id: user.id, name: user.name, seat: index, ready: isBot(user.id) };
    this.note(`${user.name} masaya oturdu.`);
    this.checkStart();
  }

  leave(userId) {
    const index = this.seats.findIndex((s) => s?.id === userId);
    if (index < 0) return;
    const p = this.seats[index];
    this.seats[index] = null;
    this.note(`${p.name} masadan kalktı.`);
    if (this.phase === 'playing' && this.players.includes(p)) {
      p.gone = true;
      this.onLeave(p); // oyun kendine göre çözer: hükmen yenilgi ya da bot devralır
    } else if (p.ready && !isBot(p.id)) release(this.guildId, p.id, this.stake, this.stake);
    this.checkStart();
  }

  ready() {
    return this.seats.filter((s) => s?.ready);
  }

  /** Masadaki herkes hazırsa ve en az minPlayers kişi varsa başlar */
  checkStart() {
    if (this.phase !== 'waiting') return;
    const seated = this.seats.filter(Boolean);
    const humansReady = seated.some((s) => s.ready && !isBot(s.id));
    if (seated.length >= this.minPlayers && humansReady && seated.every((s) => s.ready)) {
      this.startsAt = Date.now() + START_MS;
      this.schedule(() => this.begin(), START_MS);
    } else if (this.startsAt) {
      this.startsAt = 0;
      clearTimeout(this.timer);
    }
  }

  begin() {
    this.startsAt = 0;
    const seated = this.seats.filter(Boolean);
    if (seated.length < this.minPlayers || !seated.every((s) => s.ready)) return;
    this.players = seated;
    for (const p of this.players) p.gone = false;
    this.phase = 'playing';
    this.result = null;
    this.startGame();
  }

  /** Sıradaki oyuncu: süre başlar, botsa düşünür */
  setTurn(p) {
    this.turn = p.seat;
    this.deadline = Date.now() + this.turnMs;
    this.schedule(() => this.onTimeout(p), this.turnMs);
    if (isBot(p.id) || p.gone) this.botLater(() => { if (this.phase === 'playing' && this.turn === p.seat) this.botMove(p); }, 700 + Math.random() * 900);
  }

  /** Oyun bitti: winners boşsa berabere, herkesin girişi geri döner */
  finish(winners, reason) {
    clearTimeout(this.timer);
    clearTimeout(this.botTimer);
    const pot = this.stake * this.players.length;
    // Oyundan çıkan oyuncunun yerine bot kazandıysa pot ona gitmez; masada kalanlar paylaşır (para kaybolmasın)
    const live = winners.filter((p) => !p.gone);
    const receivers = !winners.length ? null : live.length ? live : this.players.filter((p) => !p.gone);
    const share = receivers?.length ? Math.floor(pot / receivers.length) : 0;
    for (const p of this.players) release(this.guildId, p.id, this.stake, receivers ? (receivers.includes(p) ? share : 0) : this.stake);
    // Giriş ödendi: sonuç ekranında kalkan oyuncuya giriş ikinci kez geri verilmesin
    for (const s of this.seats) if (s && !isBot(s.id)) s.ready = false;
    this.phase = 'result';
    this.turn = -1;
    this.result = { winners: winners.map((p) => ({ seat: p.seat, id: p.id, name: p.name })), amount: share, reason };
    this.past.unshift({ winners: winners.map((p) => p.name), reason, pot });
    this.past.length = Math.min(this.past.length, 10);
    this.note(winners.length ? `${winners.map((p) => p.name).join(', ')} kazandı (${reason}).` : `Berabere (${reason}).`);
    this.schedule(() => {
      this.phase = 'waiting';
      for (const s of this.seats) if (s) s.ready = isBot(s.id);
      this.players = [];
      this.resetGame?.();
    }, RESULT_MS);
  }

  act(user, action, body) {
    const p = this.seats.find((s) => s?.id === user.id);
    if (!p) throw new UserError('Bu masada oturmuyorsun.');
    if (action === 'ready' || action === 'unready') {
      if (this.phase !== 'waiting') throw new UserError('Oyun sürüyor.');
      if (action === 'ready') {
        if (p.ready) throw new UserError('Zaten hazırsın.');
        hold(this.guildId, p.id, this.stake);
        p.ready = true;
      } else {
        if (!p.ready) throw new UserError('Henüz hazır değilsin.');
        release(this.guildId, p.id, this.stake, this.stake);
        p.ready = false;
      }
      return this.checkStart();
    }
    if (this.phase !== 'playing' || !this.players.includes(p)) throw new UserError(this.phase === 'result' ? 'Oyun bitti, yeni oyun için Hazırım’a bas.' : 'Oyun başlamadı.');
    if (p.gone) throw new UserError('Bu oyundan çekildin; el bitince yeniden katılabilirsin.');
    return this.move(p, action, body ?? {});
  }

  baseView(userId) {
    const me = this.seats.find((s) => s?.id === userId);
    return {
      id: this.id, game: this.game, name: this.name, max: this.max, stake: this.stake, phase: this.phase,
      startsAt: this.startsAt ?? 0, seats: this.seats.map((s) => s && { seat: s.seat, id: s.id, name: s.name, ready: s.ready }),
      mySeat: me?.seat ?? -1, ready: me?.ready ?? false, turn: this.phase === 'playing' ? this.turn : -1,
      deadline: this.deadline ?? 0, turnMs: this.turnMs, result: this.phase === 'result' ? this.result : null,
      past: this.past, log: this.log,
    };
  }
}
