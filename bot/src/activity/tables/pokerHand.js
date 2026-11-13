// Poker eli değerlendirme: 2-7 karttan en iyi 5'li el. Sonuç karşılaştırılabilir dizi: [kategori, ...yüksek kartlar]
const VALUE = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };
export const HAND_NAMES = ['Yüksek Kart', 'Per', 'Döper', 'Üçlü', 'Kent', 'Renk', 'Full', 'Kare', 'Kent Renk', 'Floş Royal'];

const suitOf = (c) => (Array.isArray(c.s) ? c.s[0] : c.s);

/** Azalan, tekrarsız değerlerde en yüksek kentin başı; As 1 olarak da sayılır. Yoksa 0. */
function straightHigh(values) {
  const u = [...new Set(values)].sort((a, b) => b - a);
  if (u[0] === 14) u.push(1);
  for (let i = 0; i + 4 < u.length; i++) if (u[i] - u[i + 4] === 4) return u[i];
  return 0;
}

export function evaluate(cards) {
  const values = cards.map((c) => VALUE[c.r]).sort((a, b) => b - a);
  const bySuit = new Map();
  for (const c of cards) {
    const s = suitOf(c);
    if (!bySuit.has(s)) bySuit.set(s, []);
    bySuit.get(s).push(VALUE[c.r]);
  }
  const flush = [...bySuit.values()].find((a) => a.length >= 5)?.sort((a, b) => b - a);
  if (flush) {
    const high = straightHigh(flush);
    if (high) return [high === 14 ? 9 : 8, high];
  }
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const rest = (...skip) => values.filter((v) => !skip.includes(v));
  const [top, second] = groups;

  if (top[1] === 4) return [7, top[0], ...rest(top[0]).slice(0, 1)];
  if (top[1] === 3 && second?.[1] >= 2) return [6, top[0], second[0]];
  if (flush) return [5, ...flush.slice(0, 5)];
  const straight = straightHigh(values);
  if (straight) return [4, straight];
  if (top[1] === 3) return [3, top[0], ...rest(top[0]).slice(0, 2)];
  if (top[1] === 2 && second?.[1] === 2) return [2, top[0], second[0], ...rest(top[0], second[0]).slice(0, 1)];
  if (top[1] === 2) return [1, top[0], ...rest(top[0]).slice(0, 3)];
  return [0, ...values.slice(0, 5)];
}

export function compareHands(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export const handName = (score) => HAND_NAMES[score[0]];
