const UNITS = {
  sn: 1_000, s: 1_000,
  dk: 60_000, m: 60_000,
  sa: 3_600_000, h: 3_600_000,
  g: 86_400_000, d: 86_400_000,
  hf: 604_800_000, w: 604_800_000,
};

/**
 * "10m", "1sa", "2g", "1h30m", "1 gün" gibi süreleri milisaniyeye çevirir.
 * Geçersizse null döner.
 */
export function parseDuration(input) {
  if (!input) return null;
  const text = input
    .toLocaleLowerCase('tr')
    .replace(/saniye/g, 'sn').replace(/dakika/g, 'dk').replace(/saat/g, 'sa')
    .replace(/gün/g, 'g').replace(/hafta/g, 'hf')
    .replace(/\s+/g, '');
  const re = /(\d+)(sn|dk|sa|hf|s|m|h|g|d|w)/g;
  let total = 0;
  let consumed = 0;
  for (const match of text.matchAll(re)) {
    total += Number(match[1]) * UNITS[match[2]];
    consumed += match[0].length;
  }
  if (consumed !== text.length || total <= 0) return null;
  return total;
}

export function formatDuration(ms) {
  const parts = [];
  const units = [
    ['gün', 86_400_000],
    ['saat', 3_600_000],
    ['dakika', 60_000],
    ['saniye', 1_000],
  ];
  let rest = ms;
  for (const [name, size] of units) {
    const n = Math.floor(rest / size);
    if (n) parts.push(`${n} ${name}`);
    rest %= size;
  }
  return parts.slice(0, 2).join(' ') || '0 saniye';
}

/** Discord zaman damgası: <t:...:R> → "3 gün önce" */
export const relativeTime = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
