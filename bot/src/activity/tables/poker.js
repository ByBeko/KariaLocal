// Texas Hold'em (limitsiz). Oyuncu masaya fiş alarak oturur, kalkınca kalan fişi cüzdana döner.
// Yan potlar, sıra süresi ve el sonunda kart gösterme burada; kartlar ve sonuçlar tarayıcıya güvenilmeden hesaplanır.
import { addMoney } from '../../systems/economy.js';
import { newDeck } from '../../systems/casino.js';
import { UserError } from '../../utils/errors.js';
import { Room, escrow, hold, cardJson, amountOf, isBot } from './hub.js';
import { evaluate, compareHands, handName } from './pokerHand.js';

export const POKER_BLINDS = [10, 50, 250]; // küçük kör; büyük kör iki katı
const SEATS = 6;
const TURN_MS = 25_000;
const START_MS = 4_000;
const SHOW_MS = 6_500;
const STREETS = ['preflop', 'flop', 'turn', 'river'];

export class PokerTable extends Room {
  constructor(id, guildId, name, sb, maxBet) {
    super(id, 'poker', guildId);
    this.name = name;
    this.sb = sb;
    this.bb = sb * 2;
    this.minBuy = this.bb * 20;
    this.maxBuy = Math.min(this.bb * 100, maxBet);
    this.seats = Array(SEATS).fill(null);
    this.phase = 'waiting';
    this.hand = null;
    this.button = -1;
    this.result = null;
    this.past = []; // son eller
  }

  seatedIds() {
    return this.seats.filter(Boolean).map((s) => s.id);
  }

  summary() {
    return { id: this.id, game: 'poker', name: this.name, players: this.seatedIds().length, max: SEATS, stake: `${this.sb}/${this.bb}`, minBuy: this.minBuy, maxBuy: this.maxBuy, playing: Boolean(this.hand) };
  }

  join(user, body) {
    if (this.seats.some((s) => s?.id === user.id)) throw new UserError('Zaten bu masadasın.');
    let index = Number.isInteger(body.seat) && body.seat >= 0 && body.seat < SEATS && !this.seats[body.seat] ? body.seat : this.seats.findIndex((s) => !s);
    if (index < 0) throw new UserError('Masa dolu.');
    const buyIn = amountOf(body.buyIn ?? this.minBuy * 5, this.minBuy, this.maxBuy);
    hold(this.guildId, user.id, buyIn);
    this.seats[index] = { id: user.id, name: user.name, seat: index, stack: buyIn, sittingOut: false, timeouts: 0, cards: [] };
    this.note(`${user.name} masaya oturdu.`);
    this.maybeStart();
  }

  /** Kalkan oyuncu elindeyse pas geçer; kalan fişi cüzdana döner. Potta kalan fiş el sonunda hesaplanır. */
  leave(userId) {
    const index = this.seats.findIndex((s) => s?.id === userId);
    if (index < 0) return;
    const p = this.seats[index];
    if (this.inHand(p) && !p.folded) this.fold(p, true);
    if (p.stack > 0) {
      if (!isBot(p.id)) addMoney(this.guildId, p.id, p.stack);
      escrow(this.guildId, p.id, -p.stack);
      p.stack = 0;
    }
    p.gone = true;
    this.seats[index] = null;
    this.note(`${p.name} masadan kalktı.`);
    if (!this.hand && this.phase === 'starting' && this.ready().length < 2) {
      clearTimeout(this.timer);
      this.phase = 'waiting';
    }
  }

  ready() {
    return this.seats.filter((s) => s && s.stack > 0 && !s.sittingOut);
  }

  inHand(p) {
    return Boolean(this.hand?.players.includes(p));
  }

  maybeStart() {
    if (this.phase !== 'waiting' || this.ready().length < 2) return;
    this.phase = 'starting';
    this.startsAt = Date.now() + START_MS;
    this.schedule(() => this.startHand(), START_MS);
  }

  /** Oyuncuları koltuk sırasıyla, verilen koltuktan sonrakinden başlayarak döner */
  around(seat, list = this.hand.players) {
    const sorted = [...list].sort((a, b) => a.seat - b.seat);
    const i = sorted.findIndex((p) => p.seat > seat);
    return i < 0 ? sorted : [...sorted.slice(i), ...sorted.slice(0, i)];
  }

  startHand() {
    this.result = null;
    const players = this.ready();
    if (players.length < 2) {
      this.phase = 'waiting';
      this.hand = null;
      return;
    }
    this.button = this.around(this.button, players)[0].seat;
    const deck = newDeck();
    for (const p of players) Object.assign(p, { cards: [deck.pop(), deck.pop()], bet: 0, committed: 0, folded: false, allIn: false, acted: false, won: 0, best: null });
    this.hand = { deck, board: [], players, street: 'preflop', currentBet: 0, minRaise: this.bb, turn: -1, deadline: 0 };
    this.phase = 'preflop';

    const order = this.around(this.button);
    const sbPlayer = players.length === 2 ? order[order.length - 1] : order[0]; // iki kişide düğme küçük kördür
    const bbPlayer = this.around(sbPlayer.seat)[0];
    this.put(sbPlayer, this.sb);
    this.put(bbPlayer, this.bb);
    this.hand.currentBet = this.bb;
    this.note(`Yeni el: ${sbPlayer.name} ${this.sb}, ${bbPlayer.name} ${this.bb} kör koydu.`);
    this.nextTurn(bbPlayer.seat);
  }

  put(p, amount) {
    const a = Math.min(amount, p.stack);
    p.stack -= a;
    p.bet += a;
    p.committed += a;
    if (p.stack === 0) p.allIn = true;
  }

  needsAction(p) {
    return !p.folded && !p.allIn && (!p.acted || p.bet < this.hand.currentBet);
  }

  live() {
    return this.hand.players.filter((p) => !p.folded);
  }

  /** Verilen koltuktan sonra sırası gelen oyuncuyu bulur; kimse kalmadıysa sokak biter */
  nextTurn(afterSeat) {
    if (this.live().length === 1) return this.finish();
    const next = this.around(afterSeat).find((p) => this.needsAction(p));
    if (!next) return this.endStreet();
    this.hand.turn = next.seat;
    this.hand.deadline = Date.now() + TURN_MS;
    this.schedule(() => this.timeout(next), TURN_MS);
    if (isBot(next.id)) this.botLater(() => this.botMove(next), 1100 + Math.random() * 1600);
  }

  /** Bot eli gücüne, potun büyüklüğüne ve biraz şansa göre oynar */
  botMove(p) {
    const h = this.hand;
    if (!h || h.turn !== p.seat) return;
    const toCall = Math.min(h.currentBet - p.bet, p.stack);
    const pot = h.players.reduce((s, o) => s + o.committed, 0);
    let strength;
    if (!h.board.length) {
      const [a, b] = p.cards.map((c) => ({ A: 14, K: 13, Q: 12, J: 11 })[c.r] ?? Number(c.r));
      strength = a === b ? 0.55 + a / 40 : (Math.max(a, b) + Math.min(a, b) / 2) / 30 + (p.cards[0].s[0] === p.cards[1].s[0] ? 0.06 : 0) + (Math.abs(a - b) === 1 ? 0.04 : 0);
    } else {
      const score = evaluate([...p.cards, ...h.board]);
      strength = [0.15, 0.45, 0.65, 0.75, 0.85, 0.88, 0.94, 0.98, 1, 1][score[0]] + Math.random() * 0.08;
    }
    const r = Math.random();
    const price = toCall / Math.max(1, pot + toCall);
    const raiseTo = (size) => Math.min(p.bet + p.stack, Math.max(h.currentBet + h.minRaise, Math.floor(h.currentBet + pot * size)));
    if (strength > 0.82 && r < 0.75 && p.stack > toCall) return this.apply(p, 'raise', raiseTo(0.6 + Math.random() * 0.5));
    if (strength > 0.6) {
      if (r < 0.25 && p.stack > toCall) return this.apply(p, 'raise', raiseTo(0.4));
      return this.apply(p, toCall > 0 ? 'call' : 'check');
    }
    if (toCall <= 0) return r < 0.12 && p.stack > 0 ? this.apply(p, 'raise', raiseTo(0.5)) : this.apply(p, 'check');
    if (strength > 0.38 && price < 0.35) return this.apply(p, 'call');
    if (price < 0.12 && r < 0.6) return this.apply(p, 'call');
    return this.apply(p, 'fold');
  }

  timeout(p) {
    if (!this.hand || this.hand.turn !== p.seat) return;
    p.timeouts++;
    if (p.timeouts >= 2) {
      p.sittingOut = true;
      this.note(`${p.name} süre doldu, ara verdi.`);
    }
    if (p.bet >= this.hand.currentBet) this.apply(p, 'check');
    else this.apply(p, 'fold');
  }

  fold(p, quiet = false) {
    p.folded = true;
    if (!quiet) this.note(`${p.name} çekildi.`);
    if (!this.hand) return;
    if (this.hand.turn === p.seat) {
      clearTimeout(this.timer);
      this.nextTurn(p.seat);
    } else if (this.live().length === 1) this.finish();
  }

  apply(p, action, raw) {
    const h = this.hand;
    if (action === 'fold') return this.fold(p);
    const toCall = h.currentBet - p.bet;
    if (action === 'check') {
      if (toCall > 0) throw new UserError('Kontrol edemezsin, önce bahsi karşıla.');
      this.note(`${p.name} kontrol etti.`);
    } else if (action === 'call') {
      if (toCall <= 0) throw new UserError('Karşılanacak bahis yok.');
      this.put(p, toCall);
      this.note(p.allIn ? `${p.name} hepsini koydu (${p.bet}).` : `${p.name} gördü.`);
    } else if (action === 'raise' || action === 'allin') {
      const maxTo = p.bet + p.stack;
      let to = action === 'allin' ? maxTo : Math.floor(Number(raw));
      if (!Number.isFinite(to)) throw new UserError('Geçerli bir miktar yaz.');
      if (to >= maxTo) to = maxTo;
      else if (to < h.currentBet + h.minRaise) throw new UserError(`En az ${(h.currentBet + h.minRaise).toLocaleString('tr-TR')} yapmalısın.`);
      if (to <= h.currentBet) {
        // Hepsi, mevcut bahsi geçmiyor: sadece karşılamadır
        if (toCall <= 0) throw new UserError('Kontrol edebilirsin.');
        this.put(p, to - p.bet);
        this.note(`${p.name} hepsini koydu (${p.bet}).`);
      } else {
        const raise = to - h.currentBet;
        const full = raise >= h.minRaise;
        if (full) h.minRaise = raise;
        h.currentBet = to;
        this.put(p, to - p.bet);
        if (full) for (const o of h.players) if (o !== p) o.acted = false;
        this.note(p.allIn ? `${p.name} hepsini koydu (${to}).` : `${p.name} ${to}'a yükseltti.`);
      }
    } else throw new UserError('Geçersiz hamle.');
    p.acted = true;
    clearTimeout(this.timer);
    this.nextTurn(p.seat);
  }

  endStreet() {
    const h = this.hand;
    for (const p of h.players) {
      p.bet = 0;
      p.acted = false;
    }
    h.currentBet = 0;
    h.minRaise = this.bb;
    h.turn = -1;
    const deal = () => {
      const i = STREETS.indexOf(h.street) + 1;
      h.street = STREETS[i];
      h.deck.pop(); // yakılan kart
      for (let n = i === 1 ? 3 : 1; n > 0; n--) h.board.push(h.deck.pop());
    };
    if (h.street === 'river') return this.showdown();
    deal();
    this.phase = h.street;
    // Bahis yapabilecek bir kişi kaldıysa kartlar sonuna kadar açılır
    if (this.live().filter((p) => !p.allIn).length < 2) {
      while (h.street !== 'river') deal();
      return this.showdown();
    }
    this.nextTurn(this.button);
  }

  finish() {
    const h = this.hand;
    const winner = this.live()[0];
    winner.won = h.players.reduce((sum, p) => sum + p.committed, 0);
    this.note(`${winner.name} potu aldı (${winner.won}).`);
    this.result = { shown: false, winners: [{ seat: winner.seat, name: winner.name, amount: winner.won, hand: null }] };
    this.award();
  }

  showdown() {
    const h = this.hand;
    const live = this.live();
    for (const p of live) p.best = evaluate([...p.cards, ...h.board]);
    // Yan potlar: her seviye, o kadar koyan ve çekilmeyenler arasında paylaşılır
    const levels = [...new Set(live.map((p) => p.committed))].sort((a, b) => a - b);
    let prev = 0;
    const pots = [];
    for (const level of levels) {
      const amount = h.players.reduce((sum, p) => sum + Math.max(0, Math.min(p.committed, level) - prev), 0);
      if (amount > 0) pots.push({ amount, eligible: live.filter((p) => p.committed >= level) });
      prev = level;
    }
    const total = h.players.reduce((sum, p) => sum + p.committed, 0);
    const counted = pots.reduce((sum, pot) => sum + pot.amount, 0);
    if (pots.length && total > counted) pots[0].amount += total - counted;

    for (const pot of pots) {
      const best = pot.eligible.reduce((a, p) => (compareHands(p.best, a) > 0 ? p.best : a), pot.eligible[0].best);
      const winners = this.around(this.button, pot.eligible.filter((p) => compareHands(p.best, best) === 0));
      const share = Math.floor(pot.amount / winners.length);
      winners.forEach((p, i) => { p.won += share + (i === 0 ? pot.amount - share * winners.length : 0); });
    }
    const winners = live.filter((p) => p.won > 0);
    this.result = { shown: true, winners: winners.map((p) => ({ seat: p.seat, name: p.name, amount: p.won, hand: handName(p.best) })) };
    this.note(winners.map((p) => `${p.name} ${handName(p.best)} ile ${p.won} kazandı.`).join(' '));
    this.award();
  }

  /** Kazançlar fişe (kalkan oyuncuda cüzdana) eklenir, emanet yeni duruma göre düzeltilir */
  award() {
    const h = this.hand;
    this.past.unshift({ winners: this.result.winners.map((w) => ({ name: w.name, amount: w.amount, hand: w.hand })), pot: h.players.reduce((s, p) => s + p.committed, 0), board: h.board.map(cardJson) });
    this.past.length = Math.min(this.past.length, 10);
    for (const p of h.players) {
      if (p.gone) {
        if (p.won && !isBot(p.id)) addMoney(this.guildId, p.id, p.won);
      } else p.stack += p.won;
      escrow(this.guildId, p.id, p.won - p.committed);
    }
    h.turn = -1;
    this.phase = 'showdown';
    this.schedule(() => this.afterHand(), SHOW_MS);
  }

  afterHand() {
    for (const [i, s] of this.seats.entries()) {
      if (s && s.stack <= 0) {
        this.seats[i] = null;
        this.note(`${s.name} fişi bitti, masadan kalktı.`);
      }
    }
    this.hand = null;
    this.phase = 'waiting';
    this.maybeStart();
  }

  act(user, action, body) {
    const p = this.seats.find((s) => s?.id === user.id);
    if (!p) throw new UserError('Bu masada oturmuyorsun.');
    if (action === 'sitout') {
      p.sittingOut = true;
      return;
    }
    if (action === 'back') {
      p.sittingOut = false;
      p.timeouts = 0;
      return this.maybeStart();
    }
    if (!this.hand || this.hand.turn !== p.seat) throw new UserError('Sıra sende değil.');
    p.timeouts = 0;
    this.apply(p, action, body.amount);
  }

  view(userId) {
    const h = this.hand;
    const me = this.seats.find((s) => s?.id === userId) ?? null;
    const reveal = this.phase === 'showdown' && this.result?.shown;
    const seats = this.seats.map((s) => {
      if (!s) return null;
      const playing = this.inHand(s);
      const show = playing && (s === me || (reveal && !s.folded));
      return {
        seat: s.seat, id: s.id, name: s.name, stack: s.stack, sittingOut: s.sittingOut,
        bet: playing ? s.bet : 0, folded: playing && s.folded, allIn: playing && s.allIn, playing,
        cards: show ? s.cards.map(cardJson) : playing && !s.folded ? [null, null] : [],
        hand: reveal && playing && !s.folded && s.best ? handName(s.best) : null,
        won: this.phase === 'showdown' ? s.won ?? 0 : 0,
      };
    });
    const mine = me && h && this.inHand(me) && !me.folded ? handName(evaluate([...me.cards, ...h.board])) : null;
    let controls = null;
    if (me && h && h.turn === me.seat) {
      const toCall = Math.min(h.currentBet - me.bet, me.stack);
      controls = { toCall, canCheck: toCall <= 0, canRaise: me.stack > h.currentBet - me.bet, currentBet: h.currentBet, minTo: Math.min(h.currentBet + h.minRaise, me.bet + me.stack), maxTo: me.bet + me.stack, pot: h.players.reduce((s, p) => s + p.committed, 0) };
    }
    return {
      id: this.id, game: 'poker', name: this.name, sb: this.sb, bb: this.bb, minBuy: this.minBuy, maxBuy: this.maxBuy, max: SEATS,
      phase: this.phase, startsAt: this.phase === 'starting' ? this.startsAt : 0,
      seats, button: this.button, board: h ? h.board.map(cardJson) : [],
      pot: h ? h.players.reduce((s, p) => s + p.committed, 0) : 0,
      turn: h?.turn ?? -1, deadline: h?.deadline ?? 0, turnMs: TURN_MS,
      mySeat: me?.seat ?? -1, myHand: mine, sittingOut: me?.sittingOut ?? false, controls,
      result: this.phase === 'showdown' ? this.result : null, log: this.log, past: this.past,
    };
  }
}
