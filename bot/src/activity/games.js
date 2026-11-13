// Etkinliğin tek kişilik oyunları: slot ve blackjack. Sonuçlar burada hesaplanır; tarayıcıya güvenilmez.
// Çok oyunculu masalar (poker, Süper Tayyare, rulet, çok oyunculu blackjack, zar) tables/ klasöründedir.
import { UserError } from '../utils/errors.js';
import { getBalance, addMoney, takeMoney, parseBet, ensureEnabled, lockGame } from '../systems/economy.js';
import { spinSlot, slotOutcome, newDeck, handTotal, isBlackjack, blackjackPayout } from '../systems/casino.js';

const BLACKJACK_IDLE = 3 * 60_000;
const games = new Map(); // kullanıcı -> blackjack eli

// ───────────────────────── Slot ─────────────────────────

// Slot salonu: sunucudaki herkesin son kazançları Etkinlikte canlı görünür
const slotFeed = [];
export const slotWins = () => slotFeed;

export function slot(guildId, userId, body, name = 'Bir oyuncu') {
  ensureEnabled(guildId);
  const bet = parseBet(body.bet, guildId, userId);
  const unlock = lockGame(guildId, userId);
  try {
    takeMoney(guildId, userId, bet);
    const reels = [spinSlot(), spinSlot(), spinSlot()];
    const { n, multiplier } = slotOutcome(reels);
    const payout = Math.floor(bet * multiplier);
    if (payout > bet) {
      slotFeed.unshift({ id: userId, name, multiplier, win: payout - bet, at: Date.now() });
      slotFeed.length = Math.min(slotFeed.length, 15);
    }
    return { reels: reels.map((s) => s.key), matches: n, multiplier, net: payout - bet, balance: addMoney(guildId, userId, payout) };
  } finally {
    unlock();
  }
}

// ───────────────────────── Blackjack ─────────────────────────

const cardJson = (c) => ({ r: c.r, s: c.s[0] });
const cardValue = (c) => (['J', 'Q', 'K'].includes(c.r) ? 10 : c.r === 'A' ? 11 : Number(c.r));

function view(game, reveal) {
  const hands = game.hands.map((h) => ({ cards: h.cards.map(cardJson), total: handTotal(h.cards), bet: h.bet, outcome: h.outcome ?? null }));
  const current = Math.min(game.current, hands.length - 1);
  return {
    bet: hands.reduce((sum, h) => sum + h.bet, 0),
    hands,
    current,
    player: hands[current].cards, // tek elde eski alanlar
    playerTotal: hands[current].total,
    dealer: reveal ? game.dealer.map(cardJson) : [cardJson(game.dealer[0])],
    dealerTotal: reveal ? handTotal(game.dealer) : null,
    hidden: !reveal,
  };
}

function activeView(guildId, userId, game) {
  const hand = game.hands[game.current];
  const enough = getBalance(guildId, userId) >= hand.bet;
  return {
    ...view(game, false),
    active: true,
    balance: getBalance(guildId, userId),
    canDouble: hand.cards.length === 2 && enough,
    canSplit: game.hands.length === 1 && hand.cards.length === 2 && cardValue(hand.cards[0]) === cardValue(hand.cards[1]) && enough,
  };
}

/** Eller bitti: krupiye oynar, her el ayrı hesaplanır */
function settle(guildId, userId, game) {
  clearTimeout(game.timer);
  games.delete(userId);
  if (!game.forced && game.hands.some((h) => handTotal(h.cards) <= 21)) {
    while (handTotal(game.dealer) < 17) game.dealer.push(game.deck.pop());
  }
  const dealer = handTotal(game.dealer);
  let payout = 0;
  let staked = 0;
  for (const h of game.hands) {
    const p = handTotal(h.cards);
    h.outcome = game.forced ?? (p > 21 ? 'bust' : dealer > 21 || p > dealer ? 'win' : p === dealer ? 'push' : 'lose');
    payout += blackjackPayout(h.bet, h.outcome);
    staked += h.bet;
  }
  game.unlock();
  const net = payout - staked;
  const outcome = game.hands.length === 1 ? game.hands[0].outcome : net > 0 ? 'win' : net < 0 ? 'lose' : 'push';
  return { ...view(game, true), active: false, outcome, net, balance: addMoney(guildId, userId, payout) };
}

function touch(guildId, userId, game) {
  clearTimeout(game.timer);
  game.timer = setTimeout(() => {
    if (games.get(userId) === game) settle(guildId, userId, game); // süre dolunca kalan eller durur
  }, BLACKJACK_IDLE);
  game.timer.unref?.();
}

export function activeBlackjack(guildId, userId) {
  const game = games.get(userId);
  return game ? activeView(guildId, userId, game) : null;
}

export function blackjackStart(guildId, userId, body) {
  ensureEnabled(guildId);
  const bet = parseBet(body.bet, guildId, userId);
  const unlock = lockGame(guildId, userId);
  let game;
  try {
    takeMoney(guildId, userId, bet);
    const deck = newDeck();
    game = { deck, hands: [{ cards: [deck.pop(), deck.pop()], bet }], dealer: [deck.pop(), deck.pop()], current: 0, unlock };
  } catch (error) {
    unlock();
    throw error;
  }
  const player = game.hands[0].cards;
  if (isBlackjack(player) || isBlackjack(game.dealer)) {
    game.forced = isBlackjack(player) && isBlackjack(game.dealer) ? 'push' : isBlackjack(player) ? 'blackjack' : 'lose';
    return settle(guildId, userId, game);
  }
  games.set(userId, game);
  touch(guildId, userId, game);
  return activeView(guildId, userId, game);
}

export function blackjackMove(guildId, userId, move) {
  const game = games.get(userId);
  if (!game) throw new UserError('Devam eden bir elin yok.');
  const hand = game.hands[game.current];

  if (move === 'split') {
    if (game.hands.length > 1 || hand.cards.length !== 2 || cardValue(hand.cards[0]) !== cardValue(hand.cards[1])) throw new UserError('Bu eli ikiye ayıramazsın.');
    takeMoney(guildId, userId, hand.bet);
    const [a, b] = hand.cards;
    game.hands = [{ cards: [a, game.deck.pop()], bet: hand.bet }, { cards: [b, game.deck.pop()], bet: hand.bet }];
    game.current = 0;
    for (const h of game.hands) if (handTotal(h.cards) === 21) h.done = true;
  } else if (move === 'double') {
    if (hand.cards.length !== 2) throw new UserError('Sadece ilk iki kartta ikiye katlayabilirsin.');
    takeMoney(guildId, userId, hand.bet);
    hand.bet *= 2;
    hand.cards.push(game.deck.pop());
    hand.done = true;
  } else if (move === 'stand') {
    hand.done = true;
  } else {
    hand.cards.push(game.deck.pop());
    if (handTotal(hand.cards) >= 21) hand.done = true;
  }

  while (game.current < game.hands.length && game.hands[game.current].done) game.current++;
  if (game.current >= game.hands.length) return settle(guildId, userId, game);
  touch(guildId, userId, game);
  return activeView(guildId, userId, game);
}
