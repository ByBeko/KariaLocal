// Çok oyunculu blackjack: masadakiler aynı krupiyeye karşı oynar. İlk bahisle geri sayım başlar,
// herkes bahsini koyunca beklemeden dağıtılır. Sıra sırayla kart çek, dur ya da ikiye katla.
import { newDeck, handTotal, isBlackjack, blackjackPayout } from '../../systems/casino.js';
import { UserError } from '../../utils/errors.js';
import { Room, hold, release, cardJson, amountOf, isBot } from './hub.js';

const SEATS = 6;
const BET_MS = 12_000;
const TURN_MS = 20_000;
const RESULT_MS = 5_500;

export class BlackjackTable extends Room {
  constructor(id, guildId, name, minBet, maxBet) {
    super(id, 'blackjack', guildId);
    this.name = name;
    this.minBet = minBet;
    this.maxBet = maxBet;
    this.seats = Array(SEATS).fill(null);
    this.phase = 'betting';
    this.round = null;
    this.endsAt = 0;
    this.past = []; // son eller
  }

  seatedIds() {
    return this.seats.filter(Boolean).map((s) => s.id);
  }

  summary() {
    return { id: this.id, game: 'blackjack', name: this.name, players: this.seatedIds().length, max: SEATS, stake: `${this.minBet}+`, playing: this.phase !== 'betting' };
  }

  join(user, body) {
    if (this.seats.some((s) => s?.id === user.id)) throw new UserError('Zaten bu masadasın.');
    const index = Number.isInteger(body.seat) && body.seat >= 0 && body.seat < SEATS && !this.seats[body.seat] ? body.seat : this.seats.findIndex((s) => !s);
    if (index < 0) throw new UserError('Masa dolu.');
    this.seats[index] = { id: user.id, name: user.name, seat: index, bet: 0, cards: [], idle: 0, bot: isBot(user.id) };
    this.note(`${user.name} masaya oturdu.`);
  }

  leave(userId) {
    const index = this.seats.findIndex((s) => s?.id === userId);
    if (index < 0) return;
    const p = this.seats[index];
    this.seats[index] = null;
    this.note(`${p.name} masadan kalktı.`);
    if (this.phase === 'betting' && p.bet) {
      release(this.guildId, p.id, p.bet, p.bet); // dağıtılmadan kalkan bahsini geri alır
      p.bet = 0;
      if (!this.seats.some((s) => s?.bet)) {
        clearTimeout(this.timer);
        this.endsAt = 0;
      } else this.dealIfAllIn();
    } else if (this.phase === 'playing' && this.round.players.includes(p) && !p.done) {
      if (this.round.turn === p.seat) this.stand(p);
      else p.done = true;
    }
    // Elde kalan bahis el sonunda normal hesaplanır
  }

  dealIfAllIn() {
    const seated = this.seats.filter(Boolean);
    if (seated.length && seated.every((s) => s.bet)) this.schedule(() => this.deal(), 700);
  }

  bet(p, raw) {
    if (this.phase !== 'betting') throw new UserError('El sürüyor, bir sonraki ele bahis koy.');
    if (p.bet) throw new UserError('Bu ele zaten bahis koydun.');
    const amount = amountOf(raw, this.minBet, this.maxBet);
    hold(this.guildId, p.id, amount);
    p.bet = amount;
    p.idle = 0;
    if (!this.endsAt) {
      this.endsAt = Date.now() + BET_MS;
      this.schedule(() => this.deal(), BET_MS);
    }
    // Biri bahis koyunca botlar da koyar
    for (const s of this.seats) if (s && isBot(s.id) && !s.bet) s.bet = this.minBet * (1 + Math.floor(Math.random() * 10));
    this.dealIfAllIn();
  }

  deal() {
    const players = this.seats.filter((s) => s?.bet);
    this.endsAt = 0;
    if (!players.length) return;
    // Bahis koymayanlar üst üste 3 eli kaçırırsa kaldırılır
    for (const [i, s] of this.seats.entries()) {
      if (s && !s.bet && !isBot(s.id) && ++s.idle >= 3) {
        this.seats[i] = null;
        this.note(`${s.name} uzun süre oynamadığı için kalktı.`);
      }
    }
    const deck = [...newDeck(), ...newDeck(), ...newDeck(), ...newDeck()];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    for (const p of players) Object.assign(p, { cards: [deck.pop(), deck.pop()], done: false, outcome: null, payout: 0, doubled: false, surrendered: false });
    this.round = { deck, players, dealer: [deck.pop(), deck.pop()], turn: -1, deadline: 0 };
    this.phase = 'playing';
    if (isBlackjack(this.round.dealer)) return this.settle();
    for (const p of players) if (isBlackjack(p.cards)) p.done = true;
    this.nextTurn();
  }

  nextTurn() {
    const next = this.round.players.find((p) => !p.done);
    if (!next) return this.settle();
    this.round.turn = next.seat;
    this.round.deadline = Date.now() + TURN_MS;
    this.schedule(() => this.stand(next), TURN_MS);
    if (isBot(next.id)) this.botLater(() => this.botMove(next), 1000 + Math.random() * 900);
  }

  /** Bot temel stratejiye yakın oynar: 17'ye kadar çeker, krupiye zayıfsa 12'de durur */
  botMove(p) {
    if (this.phase !== 'playing' || this.round.turn !== p.seat) return;
    const total = handTotal(p.cards);
    const up = handTotal([this.round.dealer[0]]);
    if (p.cards.length === 2 && (total === 11 || total === 10) && up < 10) return this.act(p, 'double', {});
    if (total < 12 || (total < 17 && (up >= 7 || total < 13))) {
      this.act(p, 'hit', {});
      if (this.phase === 'playing' && this.round.turn === p.seat) this.botLater(() => this.botMove(p), 900 + Math.random() * 700);
      return;
    }
    this.act(p, 'stand', {});
  }

  stand(p) {
    p.done = true;
    clearTimeout(this.timer);
    this.nextTurn();
  }

  settle() {
    const r = this.round;
    r.turn = -1;
    const dealerBj = isBlackjack(r.dealer);
    if (!dealerBj && r.players.some((p) => !p.surrendered && handTotal(p.cards) <= 21 && !isBlackjack(p.cards))) {
      while (handTotal(r.dealer) < 17) r.dealer.push(r.deck.pop());
    }
    const dealer = handTotal(r.dealer);
    for (const p of r.players) {
      const total = handTotal(p.cards);
      const bj = isBlackjack(p.cards);
      p.outcome = p.surrendered ? 'surrender' : dealerBj ? (bj ? 'push' : 'lose') : bj ? 'blackjack' : total > 21 ? 'bust' : dealer > 21 || total > dealer ? 'win' : total === dealer ? 'push' : 'lose';
      p.payout = blackjackPayout(p.bet, p.outcome);
      release(this.guildId, p.id, p.bet, p.payout);
    }
    this.phase = 'result';
    this.past.unshift({ dealer: dealer > 21 ? 'Battı' : dealerBj ? 'Blackjack' : String(dealer), players: r.players.map((p) => ({ name: p.name, outcome: p.outcome, net: p.payout - p.bet })) });
    this.past.length = Math.min(this.past.length, 10);
    this.schedule(() => {
      for (const p of r.players) p.bet = 0;
      this.round = null;
      this.phase = 'betting';
    }, RESULT_MS);
  }

  act(user, action, body) {
    const p = this.seats.find((s) => s?.id === user.id) ?? (this.round?.players.includes(user) ? user : null);
    if (!p) throw new UserError('Bu masada oturmuyorsun.');
    if (action === 'bet') return this.bet(p, body.bet);
    if (this.phase !== 'playing' || this.round.turn !== p.seat) throw new UserError('Sıra sende değil.');
    if (action === 'stand') return this.stand(p);
    if (action === 'double') {
      if (p.cards.length !== 2) throw new UserError('Sadece ilk iki kartta ikiye katlayabilirsin.');
      hold(this.guildId, p.id, p.bet);
      p.bet *= 2;
      p.doubled = true;
      p.cards.push(this.round.deck.pop());
      return this.stand(p);
    }
    if (action === 'surrender') {
      if (p.cards.length !== 2) throw new UserError('Sadece ilk iki kartta teslim olabilirsin.');
      p.surrendered = true; // bahsin yarısı el sonunda döner
      return this.stand(p);
    }
    if (action === 'hit') {
      p.cards.push(this.round.deck.pop());
      if (handTotal(p.cards) >= 21) return this.stand(p);
      this.round.deadline = Date.now() + TURN_MS;
      return this.schedule(() => this.stand(p), TURN_MS);
    }
    throw new UserError('Geçersiz hamle.');
  }

  view(userId) {
    const r = this.round;
    const reveal = this.phase === 'result';
    const seats = this.seats.map((s) => {
      if (!s) return null;
      const playing = Boolean(r?.players.includes(s));
      return {
        seat: s.seat, id: s.id, name: s.name, bet: s.bet,
        cards: playing ? s.cards.map(cardJson) : [], total: playing ? handTotal(s.cards) : null,
        outcome: reveal && playing ? s.outcome : null, payout: reveal && playing ? s.payout : null,
      };
    });
    const me = this.seats.find((s) => s?.id === userId);
    const myTurn = Boolean(me && r && this.phase === 'playing' && r.turn === me.seat);
    return {
      id: this.id, game: 'blackjack', name: this.name, phase: this.phase, max: SEATS, minBet: this.minBet, maxBet: this.maxBet,
      endsAt: this.endsAt, seats, mySeat: me?.seat ?? -1,
      dealer: r ? (reveal ? r.dealer.map(cardJson) : [cardJson(r.dealer[0]), null]) : [],
      dealerTotal: r && reveal ? handTotal(r.dealer) : null,
      turn: r?.turn ?? -1, deadline: r?.deadline ?? 0, turnMs: TURN_MS,
      controls: myTurn ? { canDouble: me.cards.length === 2, canSurrender: me.cards.length === 2 } : null, log: this.log, past: this.past,
    };
  }
}
