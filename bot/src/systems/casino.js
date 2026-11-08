// Slot ve blackjack kuralları. Hem bot komutları hem Discord Etkinliği bunları kullanır, kazanç oranları her yerde aynıdır.

// Ağırlık ve üçlü çarpanı. Herhangi iki aynı sembol 1.5x öder. Beklenen geri dönüş ≈ %95.
export const SLOT_SYMBOLS = [
  { key: 'kurabiye', fallback: '🍪', w: 30, x: 3 },
  { key: 'hediye', fallback: '🎁', w: 25, x: 4 },
  { key: 'kalp', fallback: '❤️', w: 20, x: 5 },
  { key: 'zil', fallback: '🔔', w: 12, x: 10 },
  { key: 'elmas', fallback: '💎', w: 8, x: 20 },
  { key: 'slot_yedi', fallback: '👑', w: 5, x: 50 },
];
const SLOT_TOTAL = SLOT_SYMBOLS.reduce((a, s) => a + s.w, 0);
const SLOT_PAIR = 1.5;

export function spinSlot() {
  let r = Math.random() * SLOT_TOTAL;
  for (const s of SLOT_SYMBOLS) {
    if ((r -= s.w) < 0) return s;
  }
  return SLOT_SYMBOLS[0];
}

/** En çok tekrar eden sembol, tekrar sayısı ve çarpan */
export function slotOutcome(reels) {
  const counts = new Map();
  for (const s of reels) counts.set(s, (counts.get(s) ?? 0) + 1);
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return { top, n, multiplier: n === 3 ? top.x : n === 2 ? SLOT_PAIR : 0 };
}

export const SUITS = [['maca', '♠'], ['kupa_kart', '♥'], ['karo', '♦'], ['sinek', '♣']];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function newDeck() {
  const deck = SUITS.flatMap((s) => RANKS.map((r) => ({ r, s })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function handTotal(hand) {
  let sum = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.r === 'A') {
      aces++;
      sum += 11;
    } else sum += ['J', 'Q', 'K'].includes(c.r) ? 10 : Number(c.r);
  }
  while (sum > 21 && aces--) sum -= 10;
  return sum;
}

export const isBlackjack = (hand) => hand.length === 2 && handTotal(hand) === 21;

/** outcome: blackjack | win | push | lose | bust */
export const blackjackPayout = (bet, outcome) => ({ blackjack: Math.floor(bet * 2.5), win: bet * 2, push: bet, lose: 0, bust: 0 })[outcome];

/** Krupiye 17'ye kadar çeker ve el sonuçlanır */
export function dealerPlay(deck, dealer, player) {
  while (handTotal(dealer) < 17) dealer.push(deck.pop());
  const p = handTotal(player);
  const d = handTotal(dealer);
  if (d > 21 || p > d) return 'win';
  return p === d ? 'push' : 'lose';
}
