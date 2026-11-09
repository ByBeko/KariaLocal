// Karia Etkinliği arayüzü. Tüm sonuçlar sunucudan gelir, burada yalnızca gösterilir.
const API = location.hostname.endsWith('discordsays.com') ? '/.proxy/api' : '/api';
const params = new URLSearchParams(location.search);
const LOCAL = ['127.0.0.1', 'localhost'].includes(location.hostname);
const devId = LOCAL ? params.get('dev') : null;

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('tr-TR');
let token = '';
let sdk = null;
let limits = { minBet: 10, maxBet: 50000 };
let balance = 0;
let busy = false;

async function api(path, body) {
  const res = await fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Sunucuya ulaşılamadı.');
  return data;
}

function setBalance(value) {
  if (value === undefined) return;
  if (value !== balance) {
    const el = document.querySelector('.balance');
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
  balance = value;
  $('balance').textContent = fmt(value);
}

let sayTimer = 0;
// Bildirim üstte görünür ve kendiliğinden kaybolur
function say(text, kind = 'info') {
  const box = $('message');
  clearTimeout(sayTimer);
  box.textContent = text;
  box.className = `message ${kind}`;
  if (text) sayTimer = setTimeout(() => { box.textContent = ''; }, kind === 'lose' ? 6000 : 4500);
}

const netText = (net) => (net > 0 ? `+${fmt(net)}` : fmt(net));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Aynı anda tek işlem: çift tıklama iki bahis açmasın */
async function guarded(action) {
  if (busy) return;
  busy = true;
  try {
    await action();
  } catch (error) {
    say(error.message, 'lose');
  } finally {
    busy = false;
  }
}

// ── Sekmeler ──
const GAMES = ['blackjack', 'slot', 'coin', 'roulette'];

const GAME_INFO = {
  blackjack: [['kupa', 'Kazanç', '2×'], ['kart', 'Blackjack', '2,5×'], ['yenile', 'Beraberlik', 'İade']],
  slot: [['slot_yedi', 'Üçlü', '50×'], ['elmas', 'Üçlü', '20×'], ['zil', 'Üçlü', '10×'], ['kalp', 'Üçlü', '5×'], ['hediye', 'Üçlü', '4×'], ['kurabiye', 'Üçlü', '3×'], ['coin', 'Herhangi ikili', '1,5×']],
  coin: [['coin', 'Doğru tahmin', '2×'], ['yenile', 'Şans', '%50']],
  roulette: [['elmas', 'Tek sayı', '36×'], ['kalp', 'Kırmızı / Siyah / Tek / Çift', '2×'], ['zil', 'Düzine / Sütun', '3×']],
};

function drawGameInfo(name) {
  $('game-info').replaceChildren(
    el('h4', { textContent: 'Ödüller' }),
    ...GAME_INFO[name].map(([icon, label, value]) => el('div', { className: 'game-row' }, el('img', { src: `emojis/${icon}.png`, alt: '' }), el('span', { textContent: label }), el('b', { textContent: value }))),
  );
}

function setAdminOpen(open) {
  $('admin-links').hidden = !open;
  $('admin-toggle').setAttribute('aria-expanded', String(open));
}
$('admin-toggle').addEventListener('click', () => setAdminOpen($('admin-links').hidden));

function openTab(name) {
  const isGame = GAMES.includes(name);
  const sideName = isGame ? 'blackjack' : name;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === sideName);
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.dataset.panel !== name;
  for (const b of document.querySelectorAll('[data-game]')) b.classList.toggle('active', b.dataset.game === name);
  $('betbar').hidden = !isGame;
  $('game-switch').hidden = !isGame;
  if (isGame) drawGameInfo(name);
  document.querySelector('.content').classList.toggle('fill', isGame || ['home', 'music', 'leaderboard'].includes(name));
  document.querySelector('.content').classList.toggle('game', isGame);
  const active = document.querySelector(`.tab[data-tab="${sideName}"]`);
  if ($('admin-links').contains(active)) setAdminOpen(true);
  $('page-title').textContent = [...active.childNodes].find((n) => n.nodeType === 3)?.textContent.trim() ?? '';
  $('page-title').hidden = name === 'home'; // ana sayfanın kendi karşılama alanı var
  say('');
  if (name === 'music') refreshMusic();
  DASH[name]?.();
}
for (const b of document.querySelectorAll('[data-game]')) b.addEventListener('click', () => openTab(b.dataset.game));
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => openTab(t.dataset.tab));

// ── Bahis ──
const betValue = () => Math.floor(Number($('bet').value.replace(/\D/g, '')) || 0);
for (const b of document.querySelectorAll('[data-bet]')) {
  b.addEventListener('click', () => {
    const now = betValue();
    const next = { half: Math.floor(now / 2), double: now * 2, min: limits.minBet, all: balance }[b.dataset.bet];
    $('bet').value = Math.max(limits.minBet, Math.min(next, limits.maxBet));
  });
}

for (const chip of document.querySelectorAll('[data-add]')) {
  chip.addEventListener('click', () => {
    $('bet').value = Math.min(betValue() + Number(chip.dataset.add), limits.maxBet);
  });
}

// ── Blackjack ──
const RED = new Set(['kupa_kart', 'karo']);
function cardEl(card) {
  const root = document.createElement('div');
  if (!card) {
    root.className = 'card back';
    return root;
  }
  root.className = `card${RED.has(card.s) ? ' red' : ''}`;
  const suit = () => {
    const img = document.createElement('img');
    img.src = `emojis/${card.s}.png`;
    img.alt = '';
    return img;
  };
  const corner = (side) => {
    const box = document.createElement('span');
    box.className = `corner ${side}`;
    box.textContent = card.r;
    box.append(suit());
    return box;
  };
  root.append(corner('t'), suit(), corner('b'));
  return root;
}

const OUTCOME = { blackjack: 'BLACKJACK!', win: 'Kazandın!', push: 'Berabere', lose: 'Krupiye kazandı', bust: "21'i geçtin" };

function drawBlackjack(g) {
  const multi = g.hands.length > 1;
  $('player').classList.toggle('multi', multi);
  $('player').replaceChildren(...(multi
    ? g.hands.map((h, i) => el('div', { className: `subhand${g.active && i === g.current ? ' current' : ''}` },
      el('div', { className: 'cards' }, ...h.cards.map(cardEl)),
      el('span', { className: 'total', textContent: `${h.total}${h.outcome ? ` • ${OUTCOME[h.outcome]}` : ''}` })))
    : g.player.map(cardEl)));
  $('dealer').replaceChildren(...g.dealer.map(cardEl), ...(g.hidden ? [cardEl(null)] : []));
  $('player-total').textContent = multi ? '' : g.playerTotal;
  $('dealer-total').textContent = g.dealerTotal ?? '';
  $('bj-start').hidden = g.active;
  $('bj-hit').hidden = !g.active;
  $('bj-stand').hidden = !g.active;
  $('bj-double').hidden = !g.active;
  $('bj-double').disabled = !g.canDouble;
  $('bj-split').hidden = !(g.active && g.canSplit);
  setBalance(g.balance);
  if (g.active) say(`Bahis: ${fmt(g.bet)}`);
  else {
    const result = multi ? g.hands.map((h, i) => `El ${i + 1}: ${OUTCOME[h.outcome]}`).join(' • ') : OUTCOME[g.outcome];
    say(`${result} ${g.net ? netText(g.net) : ''}`.trim(), g.net > 0 ? 'win' : g.net < 0 ? 'lose' : 'info');
  }
}

$('bj-start').addEventListener('click', () => guarded(async () => drawBlackjack(await api('/blackjack/start', { bet: String(betValue()) }))));
for (const [id, move] of [['bj-hit', 'hit'], ['bj-stand', 'stand'], ['bj-double', 'double'], ['bj-split', 'split']]) {
  $(id).addEventListener('click', () => guarded(async () => drawBlackjack(await api(`/blackjack/${move}`, {}))));
}

// ── Slot ──
$('slot-spin').addEventListener('click', () => guarded(async () => {
  const reels = [0, 1, 2].map((i) => $(`reel${i}`));
  const boxes = reels.map((r) => r.parentElement);
  boxes.forEach((b) => { b.classList.remove('hit'); b.classList.add('spin'); });
  say('');
  try {
    const result = await api('/slot', { bet: String(betValue()) });
    setBalance(result.balance - Math.max(result.net, 0)); // kazanç, makara durunca görünür
    for (let i = 0; i < 3; i++) {
      await sleep(320);
      reels[i].src = `emojis/${result.reels[i]}.png`;
      boxes[i].classList.remove('spin');
    }
    if (result.matches >= 2) {
      const top = result.reels.find((k, i, a) => a.indexOf(k) !== a.lastIndexOf(k));
      boxes.forEach((b, i) => b.classList.toggle('hit', result.reels[i] === top));
    }
    setBalance(result.balance);
    if (result.net > 0) say(`${result.matches === 3 ? 'ÜÇLÜ' : 'İkili'}! ${result.multiplier}× ${netText(result.net)}`, 'win');
    else say(`Olmadı. ${netText(result.net)}`, 'lose');
  } finally {
    boxes.forEach((b) => b.classList.remove('spin'));
  }
}));

// ── Yazı tura ──
for (const b of document.querySelectorAll('[data-pick]')) {
  b.addEventListener('click', () => guarded(async () => {
    const coin = $('coin');
    const result = await api('/coinflip', { bet: String(betValue()), pick: b.dataset.pick });
    setBalance(result.won ? result.balance - result.net * 2 : result.balance); // bahis düşmüş hali, kazanç para durunca görünür
    coin.classList.remove('flip');
    void coin.offsetWidth;
    coin.classList.add('flip');
    say('');
    await sleep(900);
    coin.firstElementChild.textContent = result.result === 'yazi' ? 'Y' : 'T';
    setBalance(result.balance);
    const name = result.result === 'yazi' ? 'Yazı' : 'Tura';
    say(`${name} geldi. ${netText(result.net)}`, result.won ? 'win' : 'lose');
  }));
}

// ── Rulet ──
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const rouletteBets = new Map();
const rouletteOrder = []; // geri almak için son bahisler
let lastRouletteBets = null;
let wheelDeg = 0;
let spinning = false;
const numColor = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');

function buildWheel() {
  const slice = 360 / WHEEL.length;
  const colors = { green: '#1f9a6a', red: '#c62f3a', black: '#15191d' };
  const wheel = $('wheel');
  wheel.style.background = `conic-gradient(${WHEEL.map((n, i) => `${colors[numColor(n)]} ${(i * slice).toFixed(3)}deg ${((i + 1) * slice).toFixed(3)}deg`).join(',')})`;
  // Sayılar çarkla birlikte döner
  wheel.replaceChildren(...WHEEL.map((n, i) => {
    const mark = el('span', { className: 'wn', textContent: String(n) });
    mark.style.transform = `rotate(${((i + 0.5) * slice).toFixed(3)}deg) translateY(calc(var(--wr) * -1))`;
    return mark;
  }));
}

function buildRouletteBoard() {
  const cells = [];
  const add = (key, text, cls, area) => {
    const b = el('button', { className: `rc ${cls}`, type: 'button', textContent: text });
    b.dataset.key = key;
    b.style.gridArea = area;
    cells.push(b);
  };
  add('n0', '0', 'green', '1 / 1 / 4 / 2');
  for (let col = 0; col < 12; col++) for (let row = 0; row < 3; row++) { const n = col * 3 + (3 - row); add(`n${n}`, String(n), numColor(n), `${row + 1} / ${col + 2} / ${row + 2} / ${col + 3}`); }
  [['c3', '2:1'], ['c2', '2:1'], ['c1', '2:1']].forEach(([key, text], row) => add(key, text, 'out', `${row + 1} / 14 / ${row + 2} / 15`));
  [['d1', '1-12'], ['d2', '13-24'], ['d3', '25-36']].forEach(([key, text], i) => add(key, text, 'out', `4 / ${2 + i * 4} / 5 / ${6 + i * 4}`));
  [['low', '1-18'], ['even', 'Çift'], ['red', 'Kırmızı'], ['black', 'Siyah'], ['odd', 'Tek'], ['high', '19-36']]
    .forEach(([key, text], i) => add(key, text, key === 'red' ? 'red' : key === 'black' ? 'black' : 'out', `5 / ${2 + i * 2} / 6 / ${4 + i * 2}`));
  $('roulette-board').replaceChildren(...cells);
}

function renderRouletteBets() {
  let total = 0;
  for (const b of $('roulette-board').children) {
    const amount = rouletteBets.get(b.dataset.key);
    if (amount) { b.dataset.bet = amount >= 1000 ? `${+(amount / 1000).toFixed(1)}K` : String(amount); total += amount; }
    else delete b.dataset.bet;
  }
  $('roulette-total').textContent = total ? `Toplam: ${fmt(total)}` : 'Masa boş';
}

function placeRouletteBet(key) {
  const amount = betValue();
  if (amount < limits.minBet) throw new Error(`Her bahis en az ${limits.minBet} coin olmalı.`);
  rouletteBets.set(key, (rouletteBets.get(key) ?? 0) + amount);
  rouletteOrder.push(key);
  renderRouletteBets();
}

$('roulette-board').addEventListener('click', (event) => {
  const cell = event.target.closest('.rc');
  if (!cell || spinning) return;
  try { placeRouletteBet(cell.dataset.key); } catch (error) { say(error.message, 'lose'); }
});
$('roulette-board').addEventListener('contextmenu', (event) => {
  const cell = event.target.closest('.rc');
  if (!cell || spinning) return;
  event.preventDefault();
  rouletteBets.delete(cell.dataset.key);
  renderRouletteBets();
});
$('roulette-undo').addEventListener('click', () => {
  if (spinning) return;
  const key = rouletteOrder.pop();
  if (!key || !rouletteBets.has(key)) return;
  const left = rouletteBets.get(key) - betValue();
  if (left >= limits.minBet) rouletteBets.set(key, left); else rouletteBets.delete(key);
  renderRouletteBets();
});
$('roulette-clear').addEventListener('click', () => { if (spinning) return; rouletteBets.clear(); rouletteOrder.length = 0; renderRouletteBets(); });
$('roulette-repeat').addEventListener('click', () => {
  if (spinning || !lastRouletteBets) return;
  rouletteBets.clear();
  for (const [key, amount] of lastRouletteBets) rouletteBets.set(key, amount);
  renderRouletteBets();
});
$('roulette-spin').addEventListener('click', () => guarded(async () => {
  if (spinning) return;
  if (!rouletteBets.size) throw new Error('Önce masaya bahis koy.');
  spinning = true;
  try {
    const bets = Object.fromEntries(rouletteBets);
    const r = await api('/roulette', { bets });
    lastRouletteBets = new Map(rouletteBets);
    setBalance(r.balance - r.payout); // bahis düşmüş hali, kazanç top durunca görünür
    say('');
    $('roulette-result').textContent = '';
    const slice = 360 / WHEEL.length;
    const target = 360 - (WHEEL.indexOf(r.result) + 0.5) * slice;
    wheelDeg = Math.ceil(wheelDeg / 360) * 360 + 360 * 5 + target;
    const wheel = $('wheel');
    wheel.style.transition = 'transform 4s cubic-bezier(.15,.6,.1,1)';
    wheel.style.transform = `rotate(${wheelDeg}deg)`;
    await sleep(4200);
    $('roulette-result').textContent = r.result;
    $('roulette-result').className = `roulette-result ${r.color}`;
    setBalance(r.balance);
    say(`${r.result} ${{ green: 'yeşil', red: 'kırmızı', black: 'siyah' }[r.color]} geldi. ${netText(r.net)}`, r.net > 0 ? 'win' : r.net < 0 ? 'lose' : 'info');
    rouletteBets.clear();
    rouletteOrder.length = 0;
    renderRouletteBets();
  } finally {
    spinning = false;
  }
}));
// ── Müzik ──
const LOOP_LABEL = { off: 'kapalı', track: 'şarkı', queue: 'sıra' };
const mmss = (total) => {
  const sec = Math.max(0, Math.floor(total));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
let musicClock = null;
let volumeBusy = false;

function drawProgress() {
  const c = musicClock;
  const elapsed = c ? c.position + (c.paused ? 0 : (Date.now() - c.at) / 1000) : 0;
  const shown = c?.duration ? Math.min(elapsed, c.duration) : elapsed;
  $('music-now').textContent = mmss(shown);
  $('music-total').textContent = c && !c.duration ? 'CANLI' : mmss(c?.duration ?? 0);
  $('music-fill').style.width = c ? (c.duration ? `${Math.min(100, (shown / c.duration) * 100)}%` : '100%') : '0%';
}

function setCover(id) {
  const src = id ? `thumb/${id}.jpg` : 'emojis/kulaklik.png';
  if ($('music-cover').getAttribute('src') !== src) $('music-cover').src = src;
}
$('music-cover').addEventListener('error', () => { $('music-cover').src = 'emojis/kulaklik.png'; });

function drawMusic(m) {
  $('music-title').textContent = m.playing ? m.current.title : 'Bir şarkı aç';
  $('music-artist').textContent = m.playing ? (m.paused ? 'Duraklatıldı' : m.current.artist || 'Çalıyor') : 'Şu an çalmıyor';
  setCover(m.playing ? m.current.thumb : null);
  $('music-pause-icon').src = m.playing && !m.paused ? 'emojis/duraklat.png' : 'emojis/oynat.png';
  for (const id of ['music-pause', 'music-skip', 'music-stop', 'music-loop', 'music-volume']) $(id).disabled = !m.playing;
  $('music-prev').disabled = !m.canBack;
  $('music-shuffle').disabled = m.remaining < 2;
  const loop = m.loop ?? 'off';
  $('music-loop').classList.toggle('on', loop !== 'off');
  $('music-loop').title = `Döngü: ${LOOP_LABEL[loop]}`;
  $('music-loop-one').hidden = loop !== 'track';
  if (m.playing && !volumeBusy) $('music-volume').value = m.volume;
  musicClock = m.playing ? { position: m.position, duration: m.current.duration, paused: m.paused, at: Date.now() } : null;
  drawProgress();

  $('music-count').textContent = m.remaining ? `(${m.remaining})` : '';
  $('music-list').replaceChildren(...(m.upcoming.length
    ? m.upcoming.map((t, i) => el('li', {}, el('b', { textContent: String(i + 1) }), el('span', {}, el('strong', { textContent: t.title }), el('small', { textContent: t.artist || '' })), el('em', { textContent: t.duration ? mmss(t.duration) : 'CANLI' })))
    : [el('li', { className: 'queue-empty', textContent: 'Sırada şarkı yok.' })]));
  if (m.notice) say(m.notice);
}

async function refreshMusic() {
  try {
    drawMusic(await api('/music'));
  } catch {}
}

$('music-form').addEventListener('submit', (event) => {
  event.preventDefault();
  guarded(async () => {
    const input = $('music-query');
    if (!input.value.trim()) return;
    say('Şarkı aranıyor...');
    drawMusic(await api('/music/play', { query: input.value }));
    input.value = '';
    say('Sıraya eklendi.', 'win');
  });
});
for (const [id, path] of [['music-pause', 'pause'], ['music-skip', 'skip'], ['music-stop', 'stop'], ['music-prev', 'previous'], ['music-shuffle', 'shuffle'], ['music-loop', 'loop']]) {
  $(id).addEventListener('click', () => guarded(async () => drawMusic(await api(`/music/${path}`, {}))));
}

$('music-volume').addEventListener('pointerdown', () => { volumeBusy = true; });
$('music-volume').addEventListener('change', () => guarded(async () => {
  try {
    drawMusic(await api('/music/volume', { level: Number($('music-volume').value) }));
  } finally {
    volumeBusy = false;
  }
}));

setInterval(drawProgress, 1000);
setInterval(() => {
  if (!$('app').hidden && !document.querySelector('[data-panel="music"]').hidden) refreshMusic();
}, 5000);

// ── Yönetim Paneli (sekmeyi sadece yöneticiler görür; asıl kontrol sunucudadır) ──
const CHANNEL_KINDS = { text: [0, 5], voice: [2], category: [4] };
const OPT = { STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10 };
const GROUP_TITLES = { channel: 'Kanallar', role: 'Roller', number: 'Sayılar', text: 'Yazılar' };
let admin = null;
let confirmTimer = null;

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
function selectFrom(items, value, empty = 'Seçilmedi') {
  const select = el('select', { className: 'field' }, el('option', { value: '', textContent: empty }));
  for (const item of items) select.append(el('option', { value: item.value, textContent: item.label }));
  select.value = value ?? '';
  return select;
}
const channelItems = (types) => admin.channels.filter((c) => !types || types.includes(c.type)).map((c) => ({ value: c.id, label: c.type === 4 ? `[${c.name}]` : `#${c.name}` }));
const roleItems = () => admin.roles.map((r) => ({ value: r.id, label: `@${r.name}` }));
const memberItems = () => admin.members.map((m) => ({ value: m.id, label: m.bot ? `${m.name} (bot)` : m.name }));

async function saveSetting(key, value, control) {
  control.disabled = true;
  try {
    const saved = await api('/admin/setting', { key, value });
    admin.settings.find((s) => s.key === key).value = saved.value;
    say('Kaydedildi.', 'win');
  } catch (error) {
    say(error.message, 'lose');
    drawSettings();
    drawModules();
  } finally {
    control.disabled = false;
  }
}

function settingControl(s) {
  if (s.type === 'bool') {
    const box = el('input', { type: 'checkbox', checked: Boolean(s.value), className: 'switch' });
    box.setAttribute('aria-label', s.label);
    box.addEventListener('change', () => saveSetting(s.key, box.checked, box));
    return box;
  }
  if (s.type === 'channel' || s.type === 'role') {
    const select = selectFrom(s.type === 'channel' ? channelItems(CHANNEL_KINDS[s.kind]) : roleItems().filter((r) => !admin.roles.find((x) => x.id === r.value).managed), s.value);
    select.setAttribute('aria-label', s.label);
    select.addEventListener('change', () => saveSetting(s.key, select.value || null, select));
    return select;
  }
  const input = el('input', { className: 'field', value: s.value ?? '', inputMode: s.type === 'number' ? 'numeric' : 'text' });
  input.setAttribute('aria-label', s.label);
  const button = el('button', { textContent: 'Kaydet', type: 'submit' });
  const form = el('form', { className: 'inline' }, input, button);
  form.addEventListener('submit', (event) => { event.preventDefault(); saveSetting(s.key, input.value, button); });
  return form;
}

function drawSettings() {
  const query = $('set-search').value.toLocaleLowerCase('tr').trim();
  const groups = [];
  for (const [type, title] of Object.entries(GROUP_TITLES)) {
    const rows = admin.settings.filter((s) => s.type === type && s.label.toLocaleLowerCase('tr').includes(query));
    if (!rows.length) continue;
    groups.push(el('h4', { textContent: title }), ...rows.map((s) => el('div', { className: 'setting' }, el('span', { textContent: s.label }), settingControl(s))));
  }
  $('set-list').replaceChildren(...(groups.length ? groups : [el('p', { className: 'hint', textContent: 'Sonuç yok.' })]));
}

function optionField(o) {
  let control;
  if (o.choices) control = selectFrom(o.choices.map((c) => ({ value: c.value, label: c.name })), '', o.required ? 'Seç' : 'Boş');
  else if (o.type === OPT.BOOLEAN) control = selectFrom([{ value: 'true', label: 'Evet' }, { value: 'false', label: 'Hayır' }], '', o.required ? 'Seç' : 'Boş');
  else if (o.type === OPT.USER || o.type === OPT.MENTIONABLE) control = selectFrom(memberItems(), '', o.required ? 'Üye seç' : 'Boş');
  else if (o.type === OPT.CHANNEL) control = selectFrom(channelItems(o.channelTypes), '', o.required ? 'Kanal seç' : 'Boş');
  else if (o.type === OPT.ROLE) control = selectFrom(roleItems(), '', o.required ? 'Rol seç' : 'Boş');
  else if (o.multiline) control = el('textarea', { className: 'field', rows: 4, maxLength: o.maxLength ?? 2000 });
  else control = el('input', { className: 'field', inputMode: o.type === OPT.INTEGER || o.type === OPT.NUMBER ? 'numeric' : 'text', autocomplete: 'off', ...(o.maxLength ? { maxLength: o.maxLength } : {}) });
  control.dataset.option = o.name;
  return el('label', { className: 'opt' }, el('span', { textContent: `${o.description}${o.required ? ' *' : ''}` }), control);
}

const selectedCommand = () => admin.commands.find((c) => c.name === $('cmd-select').value);

function drawOptions(options) {
  const box = $('cmd-options');
  box.replaceChildren(...options.map(optionField));
}

// Komutlar yardım menüsü gibi kategorilere ayrılır; "Bota Mesaj Yazdır" Yönetim grubunda bir komut gibi durur.
const CMD_CATEGORIES = [
  ['bilgi', 'Genel', 'ev'],
  ['topluluk', 'Topluluk', 'kupa'],
  ['muzik', 'Müzik', 'muzik'],
  ['eglence', 'Ekonomi', 'oyun'],
  ['analiz', 'Analiz', 'istatistik'],
  ['moderasyon', 'Moderasyon', 'tokmak'],
  ['sunucu', 'Sunucu', 'araclar'],
  ['yonetim', 'Yönetim', 'ayarlar'],
];
const SAY_COMMAND = { name: '__say__', category: 'yonetim', description: 'Botun ağzından bir kanala mesaj yazdır: normal ya da embed', pseudo: true };

function markCommand() {
  for (const b of document.querySelectorAll('.cmd-item')) b.classList.toggle('active', b.dataset.name === $('cmd-select').value);
}

function drawCommandForm() {
  resetConfirm();
  const isSay = $('cmd-select').value === '__say__';
  $('say-card').hidden = !isSay;
  $('cmd-card').hidden = isSay;
  markCommand();
  if (isSay) return;
  const cmd = selectedCommand();
  $('cmd-output').hidden = true;
  $('cmd-run').disabled = !cmd;
  if (!cmd) return $('cmd-form').replaceChildren(el('p', { className: 'hint left', textContent: 'Soldan bir komut seç. Bota mesaj yazdırmak için Yönetim grubuna bak.' }));
  const parts = [el('h3', { className: 'cmd-title', textContent: `/${cmd.name}` }), el('p', { className: 'hint left', textContent: cmd.description })];
  const channel = selectFrom(channelItems([0, 5, 2]), '', 'Kanal seç');
  channel.id = 'cmd-channel';
  channel.value = admin.lastChannel ?? '';
  channel.addEventListener('change', () => { admin.lastChannel = channel.value; });
  parts.push(el('label', { className: 'opt' }, el('span', { textContent: 'Çalışacağı kanal *' }), channel));
  if (cmd.subs) {
    const sub = selectFrom(cmd.subs.map((s) => ({ value: s.name, label: `${s.name} — ${s.description}` })), cmd.subs[0].name, 'Seç');
    sub.id = 'cmd-sub';
    sub.addEventListener('change', () => { resetConfirm(); drawOptions(cmd.subs.find((s) => s.name === sub.value)?.options ?? []); });
    parts.push(el('label', { className: 'opt' }, el('span', { textContent: 'İşlem *' }), sub));
  }
  parts.push(el('div', { id: 'cmd-options' }));
  $('cmd-form').replaceChildren(...parts);
  drawOptions(cmd.subs ? cmd.subs[0].options : cmd.options);
}

function drawCommandList() {
  const query = $('cmd-search').value.toLocaleLowerCase('tr').trim();
  const select = $('cmd-select');
  const current = select.value;
  const groups = new Map(CMD_CATEGORIES.map(([key]) => [key, []]));
  for (const c of [...admin.commands, SAY_COMMAND]) {
    if (!`${c.name} ${c.description} ${c.pseudo ? 'bota mesaj yazdır embed' : ''}`.toLocaleLowerCase('tr').includes(query)) continue;
    if (!groups.has(c.category)) groups.set(c.category, []);
    groups.get(c.category).push(c);
  }
  select.replaceChildren(el('option', { value: '', textContent: '' }), ...[...groups.values()].flat().map((c) => el('option', { value: c.name, textContent: c.name })));
  const sections = [...groups].filter(([, list]) => list.length).map(([key, list]) => {
    const [, label, icon] = CMD_CATEGORIES.find((c) => c[0] === key) ?? [key, key, 'araclar'];
    return el('section', { className: 'cmd-group' },
      el('h5', {}, el('img', { src: `emojis/${icon}.png`, alt: '' }), label, el('em', { textContent: String(list.length) })),
      ...list.map((c) => {
        const button = el('button', { className: 'cmd-item', type: 'button' },
          el('strong', { textContent: c.pseudo ? 'Bota Mesaj Yazdır' : `/${c.name}` }),
          el('small', { textContent: c.description.split(/[.:(]/)[0].trim() }));
        button.dataset.name = c.name;
        button.addEventListener('click', () => { select.value = c.name; drawCommandForm(); });
        return button;
      }));
  });
  $('cmd-list').replaceChildren(...(sections.length ? sections : [empty('Komut bulunamadı.')]));
  select.value = current;
  if (select.value !== current) { select.value = ''; drawCommandForm(); }
  markCommand();
}

function resetConfirm() {
  clearTimeout(confirmTimer);
  confirmTimer = null;
  $('cmd-run').textContent = 'Çalıştır';
}

function runCommand() {
  const cmd = selectedCommand();
  if (!cmd) return;
  if (cmd.staff && !confirmTimer) {
    $('cmd-run').textContent = 'Emin misin? Tekrar bas';
    confirmTimer = setTimeout(resetConfirm, 4000);
    return;
  }
  resetConfirm();
  guarded(async () => {
    const values = {};
    for (const control of $('cmd-options').querySelectorAll('[data-option]')) if (control.value !== '') values[control.dataset.option] = control.value;
    say('Çalışıyor...');
    const out = $('cmd-output');
    try {
      const result = await api('/admin/run', { name: cmd.name, sub: $('cmd-sub')?.value ?? null, channelId: $('cmd-channel').value, values });
      out.textContent = result.output;
      out.hidden = false;
      say('');
    } catch (error) {
      out.hidden = true;
      throw error;
    }
  });
}

// ── Bota mesaj yazdır ──
let sayMode = 'normal';
function drawSay() {
  const select = $('say-channel');
  const keep = select.value || admin.lastSayChannel || '';
  select.replaceChildren(el('option', { value: '', textContent: 'Kanal seç' }), ...channelItems([0, 5]).map((c) => el('option', { value: c.value, textContent: c.label })));
  select.value = keep;
}

function drawSayPreview() {
  const text = $('say-text').value.trim();
  const box = $('say-preview');
  box.hidden = !text;
  box.className = `say-preview${sayMode === 'embed' ? ' embed' : ''}`;
  const title = $('say-title').value.trim();
  box.replaceChildren(...(sayMode === 'embed' && title ? [el('strong', { textContent: title })] : []), ...renderMarkdown(text));
}

for (const b of document.querySelectorAll('[data-say]')) {
  b.addEventListener('click', () => {
    sayMode = b.dataset.say;
    for (const x of document.querySelectorAll('[data-say]')) x.classList.toggle('active', x === b);
    $('say-title').hidden = sayMode !== 'embed';
    drawSayPreview();
  });
}
// @ ile üye ya da rol, # ile kanal seçilir; seçilen Discord etiketi olarak yazıya girer
const MENTION_AT_END = /(?<![\w<@#&])([@#])([\p{L}\p{N}_-]*)$/u;
let suggestItems = [];
let suggestIndex = 0;

function suggestFor(sign, query) {
  const q = query.toLocaleLowerCase('tr');
  const hit = (name) => name.toLocaleLowerCase('tr').includes(q);
  if (sign === '#') {
    return admin.channels.filter((c) => [0, 5].includes(c.type) && hit(c.name)).slice(0, 8)
      .map((c) => ({ label: `#${plainChannel(c.name)}`, hint: 'kanal', insert: `<#${c.id}>` }));
  }
  const readable = (name) => /[\p{L}\p{N}]/u.test(name) && !/-{3,}/.test(name); // ayraç rolleri ve harfsiz adlar listelenmez
  const people = admin.members.filter((m) => readable(m.name) && hit(m.name)).slice(0, 5).map((m) => ({ label: `@${m.name}`, hint: m.bot ? 'bot' : 'üye', insert: `<@${m.id}>` }));
  const groups = admin.roles.filter((r) => r.name !== '@everyone' && readable(r.name) && hit(r.name)).slice(0, 4).map((r) => ({ label: `@${r.name}`, hint: 'rol', insert: `<@&${r.id}>` }));
  return [...people, ...groups];
}

function closeSuggest() {
  suggestItems = [];
  $('say-suggest').hidden = true;
}

function drawSuggest() {
  $('say-suggest').replaceChildren(...suggestItems.map((item, i) => {
    const row = el('button', { type: 'button', className: `suggest-item${i === suggestIndex ? ' active' : ''}` }, el('strong', { textContent: item.label }), el('small', { textContent: item.hint }));
    row.addEventListener('mousedown', (event) => { event.preventDefault(); pickSuggest(i); });
    return row;
  }));
  $('say-suggest').hidden = !suggestItems.length;
}

function updateSuggest() {
  const area = $('say-text');
  const match = admin && area.value.slice(0, area.selectionStart).match(MENTION_AT_END);
  suggestItems = match ? suggestFor(match[1], match[2]) : [];
  suggestIndex = 0;
  drawSuggest();
}

function pickSuggest(i) {
  const area = $('say-text');
  const pos = area.selectionStart;
  const match = area.value.slice(0, pos).match(MENTION_AT_END);
  if (!match || !suggestItems[i]) return closeSuggest();
  const start = pos - match[0].length;
  const insert = `${suggestItems[i].insert} `;
  area.value = area.value.slice(0, start) + insert + area.value.slice(pos);
  area.setSelectionRange(start + insert.length, start + insert.length);
  closeSuggest();
  drawSayPreview();
  area.focus();
}

$('say-text').addEventListener('input', () => { drawSayPreview(); updateSuggest(); });
$('say-text').addEventListener('click', updateSuggest);
$('say-text').addEventListener('blur', () => setTimeout(closeSuggest, 120));
$('say-text').addEventListener('keydown', (event) => {
  if (!suggestItems.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    suggestIndex = (suggestIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestItems.length) % suggestItems.length;
    drawSuggest();
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    pickSuggest(suggestIndex);
  } else if (event.key === 'Escape') closeSuggest();
});
$('say-title').addEventListener('input', drawSayPreview);
$('say-channel').addEventListener('change', () => { if (admin) admin.lastSayChannel = $('say-channel').value; });
$('say-send').addEventListener('click', () => guarded(async () => {
  await api('/admin/say', { channelId: $('say-channel').value, mode: sayMode, title: $('say-title').value, text: $('say-text').value });
  $('say-text').value = '';
  $('say-title').value = '';
  drawSayPreview();
  say('Mesaj gönderildi.', 'win');
}));

async function loadAdmin() {
  if (admin) return;
  try {
    admin = await api('/admin/overview');
    drawSettings();
    drawModules();
    drawCommandList();
    drawSay();
  } catch (error) {
    say(error.message, 'lose');
  }
}

function drawModules() {
  if (!admin) return;
  $('module-grid').replaceChildren(...admin.settings.filter((s) => s.type === 'bool').map((s) => {
    const box = el('input', { type: 'checkbox', checked: Boolean(s.value), className: 'switch' });
    box.setAttribute('aria-label', s.label);
    box.addEventListener('change', () => saveSetting(s.key, box.checked, box));
    const label = s.label.replace(/^Koruma: /, '');
    return el('label', { className: 'module' }, el('span', { textContent: label[0].toLocaleUpperCase('tr') + label.slice(1) }), box);
  }));
}

// ── Kontrol paneli ──
const when = (ms) => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const empty = (text) => el('p', { className: 'hint', textContent: text });
const openLink = (url) => (sdk ? sdk.commands.openExternalLink({ url }).catch(() => {}) : window.open(url, '_blank'));
const linkButton = (url) => { const b = el('button', { textContent: 'Discord’da aç' }); b.addEventListener('click', () => openLink(url)); return b; };

/** Geri alınamayan işlemlerde ikinci tıklama istenir */
function confirmButton(label, action) {
  const button = el('button', { textContent: label, className: 'danger' });
  let armed = null;
  button.addEventListener('click', () => {
    if (!armed) {
      button.textContent = 'Emin misin?';
      armed = setTimeout(() => { armed = null; button.textContent = label; }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    button.textContent = label;
    guarded(action);
  });
  return button;
}

function setBadge(id, count) {
  $(id).hidden = !count;
  $(id).textContent = count;
  const total = ['badge-tickets', 'badge-reports'].reduce((sum, key) => sum + (Number($(key).textContent) || 0), 0);
  $('admin-count').hidden = !total;
  $('admin-count').textContent = total;
}

// Sunucu panelindeki özet kartlar. Etkin sayıları gerçek ayarlardan gelir.
const MODULE_CARDS = [
  { icon: 'kalkan', tone: 'red', title: 'Koruma', tab: 'modules', keys: ['anti_spam', 'anti_invite', 'anti_link', 'anti_mention', 'anti_profanity', 'anti_raid', 'anti_nuke'] },
  { icon: 'mesaj', tone: 'blue', title: 'Destek', tab: 'tickets', keys: ['verify_enabled', 'autoresponse_enabled'] },
  { icon: 'oyun', tone: 'green', title: 'Etkileşim', tab: 'leaderboard', keys: ['level_enabled', 'level_announce', 'economy_enabled'] },
  { icon: 'araclar', tone: 'purple', title: 'Araçlar', tab: 'settings', note: 'Ayarlar ve komutlar' },
];

function moduleCard(m) {
  const on = m.keys?.filter((key) => admin?.settings.find((s) => s.key === key)?.value).length;
  const card = el('button', { className: `mod ${m.tone}` },
    el('span', { className: 'mod-icon' }, el('img', { src: `emojis/${m.icon}.png`, alt: '' })),
    el('span', { className: 'mod-text' }, el('strong', { textContent: m.title }), el('small', { textContent: m.keys ? `${on}/${m.keys.length} aktif` : m.note })));
  card.addEventListener('click', () => openTab(m.tab));
  return card;
}

const card = (label, value, note) => el('div', { className: 'stat' }, el('small', { textContent: label }), el('strong', { textContent: value }), ...(note ? [el('em', { textContent: note })] : []));
const rank = (title, rows) => el('div', { className: 'box' }, el('h4', { textContent: title }), rows.length
  ? el('ol', { className: 'rank' }, ...rows.slice(0, 5).map((r) => el('li', {}, el('span', { textContent: r.name }), el('b', { textContent: typeof r.value === 'number' ? fmt(r.value) : r.value }))))
  : empty('Henüz veri yok.'));

function barChart(title, points) {
  const max = Math.max(...points.map((p) => p.value), 1);
  return el('div', { className: 'box' }, el('h4', { textContent: title }), el('div', { className: 'chart' }, ...points.map((p) => {
    const bar = el('i', { title: `${p.label}: ${fmt(p.value)}` });
    bar.style.height = `${Math.max(3, Math.round((p.value / max) * 100))}%`;
    return bar;
  })));
}

let overviewDays = 7;
async function loadOverview() {
  try {
    await loadAdmin();
    const d = await api(`/admin/dashboard/${overviewDays}`);
    setBadge('badge-tickets', d.open.tickets);
    setBadge('badge-reports', d.open.reports);
    const change = d.stats.previous ? Math.round(((d.stats.messages - d.stats.previous) / d.stats.previous) * 100) : null;
    const periods = el('div', { className: 'period' }, ...[[1, 'Bugün'], [7, '7 Gün'], [30, '30 Gün']].map(([days, label]) => {
      const b = el('button', { textContent: label, className: days === d.days ? 'active' : '' });
      b.addEventListener('click', () => { overviewDays = days; loadOverview(); });
      return b;
    }));
    $('overview').replaceChildren(
      el('div', { className: 'dash-head' }, periods),
      el('div', { className: 'stats' },
        card('Üye', fmt(d.members.humans), `${d.boosts} takviye`),
        card('Mesaj', fmt(d.stats.messages), change === null ? '' : `${change >= 0 ? '+' : ''}${change}% önceki döneme göre`),
        card('Aktif Üye', fmt(d.stats.active), `+${d.stats.joins} giriş • -${d.stats.leaves} çıkış`),
        card('Ses', d.stats.voice)),
      el('div', { className: 'mods' }, ...MODULE_CARDS.map(moduleCard)),
      barChart('Günlük Mesaj', d.daily.map((p) => ({ label: p.day, value: p.value }))),
      el('div', { className: 'grid2' }, rank('En Çok Yazanlar', d.topUsers), rank('En Çok Seste', d.topVoice)),
      ...(d.bot.music ? [el('p', { className: 'hint', textContent: `Şimdi çalıyor: ${d.bot.music}` })] : []),
    );
  } catch (error) {
    say(error.message, 'lose');
  }
}

function drawTicketList(tickets) {
  setBadge('badge-tickets', tickets.length);
  $('ticket-view').hidden = true;
  $('ticket-list').replaceChildren(...(tickets.length ? tickets.map((t) => {
    const open = el('button', { textContent: 'Görüntüle', className: 'primary' });
    open.addEventListener('click', () => guarded(() => openTicket(t)));
    return el('article', { className: 'item' },
      el('div', {}, el('strong', { textContent: `#${t.number} • ${t.category}` }), el('p', { textContent: `${t.user} • ${when(t.createdAt)}${t.claimedBy ? ` • Üstlenen: ${t.claimedBy}` : ''}` })),
      el('div', { className: 'item-actions' }, open));
  }) : [empty('Açık destek talebi yok.')]));
}

function drawMessages(box, messages) {
  box.replaceChildren(...messages.map((m) => el('div', { className: `msg${m.bot ? ' bot' : ''}` },
    el('small', { textContent: `${m.author} • ${when(m.at)}` }),
    el('p', { textContent: `${m.text}${m.files ? ` [${m.files} dosya]` : ''}` || ' ' }))));
  box.scrollTop = box.scrollHeight;
}

async function openTicket(t) {
  const { messages } = await api(`/admin/tickets/${t.id}`);
  const log = el('div', { className: 'log' });
  const input = el('input', { className: 'field', placeholder: 'Talebe yanıt yaz', maxLength: 1500, autocomplete: 'off' });
  const form = el('form', { className: 'inline' }, input, el('button', { textContent: 'Gönder', className: 'primary' }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    guarded(async () => {
      if (!input.value.trim()) return;
      const data = await api(`/admin/tickets/${t.id}/reply`, { text: input.value });
      input.value = '';
      drawMessages(log, data.messages);
    });
  });
  const claim = el('button', { textContent: 'Üstlen', disabled: Boolean(t.claimedBy) });
  claim.addEventListener('click', () => guarded(async () => { await api(`/admin/tickets/${t.id}/claim`, {}); say('Talebi üstlendin.', 'win'); claim.disabled = true; }));
  const close = confirmButton('Talebi Kapat', async () => { const data = await api(`/admin/tickets/${t.id}/close`, {}); drawTicketList(data.tickets); say('Talep kapatıldı.', 'win'); });
  const view = $('ticket-view');
  view.replaceChildren(
    el('div', { className: 'dash-head' }, el('strong', { textContent: `Talep #${t.number} • ${t.user}` }), el('div', { className: 'item-actions' }, claim, linkButton(t.url), close)),
    log, form);
  view.hidden = false;
  drawMessages(log, messages);
}

const loadTickets = () => guarded(async () => drawTicketList((await api('/admin/tickets')).tickets));

function drawReports(reports) {
  setBadge('badge-reports', reports.filter((r) => !r.resolved).length);
  $('report-list').replaceChildren(...(reports.length ? reports.map((r) => {
    const actions = el('div', { className: 'item-actions' });
    if (r.link) actions.append(linkButton(r.link));
    if (!r.resolved) {
      const done = el('button', { textContent: 'Çözüldü', className: 'primary' });
      done.addEventListener('click', () => guarded(async () => drawReports((await api(`/admin/reports/${r.id}/resolve`, {})).reports)));
      actions.append(done);
    }
    return el('article', { className: `item${r.resolved ? ' done' : ''}` },
      el('div', {}, el('strong', { textContent: r.target }), el('p', { textContent: r.reason }),
        el('small', { textContent: `Bildiren: ${r.reporter} • #${r.channel} • ${when(r.createdAt)}${r.resolved ? ` • Çözen: ${r.resolved.by}` : ''}` })), actions);
  }) : [empty('Henüz rapor yok.')]));
}
const loadReports = () => guarded(async () => drawReports((await api('/admin/reports')).reports));

function drawSuggestions(data) {
  $('suggestion-list').replaceChildren(...(data.items.length ? data.items.map((s) => el('article', { className: 'item' },
    el('div', {}, el('strong', { textContent: s.author }), el('p', { textContent: s.text }), el('small', { textContent: `${s.up} evet • ${s.down} hayır • ${when(s.at)}` })),
    el('div', { className: 'item-actions' }, linkButton(s.url), confirmButton('Sil', async () => drawSuggestions(await api(`/admin/suggestions/${s.id}/delete`, {})))))) : [empty('Henüz öneri yok.')]));
}
const loadSuggestions = () => guarded(async () => drawSuggestions(await api('/admin/suggestions')));

const loadCases = () => guarded(async () => {
  const { cases } = await api('/admin/cases');
  $('case-list').replaceChildren(...(cases.length ? cases.map((c) => el('article', { className: 'item' },
    el('div', {}, el('strong', { textContent: `#${c.id} • ${c.type} • ${c.user}` }), el('p', { textContent: c.reason }), el('small', { textContent: `Yetkili: ${c.mod} • ${when(c.at)}` })))) : [empty('Henüz ceza kaydı yok.')]));
});

// ── Discord yazısını (kalın, italik, madde, başlık, emoji) arayüz fontuyla çizer; HTML eklenmez ──
const MD_INLINE = /(<@&\d+>|<@!?\d+>|<#\d+>|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|:[A-Za-z0-9_]+:|(?<![\w<])[@#][\p{L}\p{N}_-]+)/gu;
const mention = (text) => el('span', { className: 'mention', textContent: text });
const plainChannel = (name) => name.replace(/^[^\p{L}\p{N}]+/u, '');

function mdInline(text) {
  const nodes = [];
  let last = 0;
  for (const m of text.matchAll(MD_INLINE)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('<@&')) nodes.push(mention(`@${admin?.roles.find((r) => r.id === t.slice(3, -1))?.name ?? 'rol'}`));
    else if (t.startsWith('<@')) nodes.push(mention(`@${admin?.members.find((u) => u.id === t.replace(/\D/g, ''))?.name ?? 'üye'}`));
    else if (t.startsWith('<#')) nodes.push(mention(`#${plainChannel(admin?.channels.find((c) => c.id === t.slice(2, -1))?.name ?? 'kanal')}`));
    else if (t[0] === '@' || t[0] === '#') nodes.push(mention(t)); // duyurulardaki düz yazı etiketleri
    else if (t.startsWith('**')) nodes.push(el('strong', {}, ...mdInline(t.slice(2, -2))));
    else if (t.startsWith('__')) nodes.push(el('u', {}, ...mdInline(t.slice(2, -2))));
    else if (t.startsWith('~~')) nodes.push(el('s', {}, ...mdInline(t.slice(2, -2))));
    else if (t[0] === '`') nodes.push(el('code', { textContent: t.slice(1, -1) }));
    else if (t[0] === ':') {
      if (t.startsWith(':Karia_')) {
        const img = el('img', { className: 'emo', src: `emojis/${t.slice(7, -1)}.png`, alt: '' });
        img.addEventListener('error', () => img.remove(), { once: true });
        nodes.push(img);
      } else if (!/^:[A-Za-z_]{2,}:$/.test(t)) nodes.push(t); // başka sunucu emojileri çizilemez, saat gibi yazılar kalır
    } else nodes.push(el('em', {}, ...mdInline(t.slice(1, -1))));
    last = m.index + t.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderMarkdown(text) {
  return String(text).split('\n').map((line) => {
    const heading = line.match(/^#{1,3} (.*)/);
    if (heading) return el('div', { className: 'md-h' }, ...mdInline(heading[1]));
    const small = line.match(/^-# (.*)/);
    if (small) return el('div', { className: 'md-sub' }, ...mdInline(small[1]));
    const quote = line.match(/^> ?(.*)/);
    if (quote) return el('div', { className: 'md-q' }, ...mdInline(quote[1]));
    const item = line.match(/^\s*[-*] (.*)/);
    if (item) return el('div', { className: 'md-li' }, el('span', { textContent: '•' }), el('span', {}, ...mdInline(item[1])));
    return line.trim() ? el('div', { className: 'md-p' }, ...mdInline(line)) : el('div', { className: 'md-gap' });
  });
}

// ── Üye ana sayfası ──
function waitText(at) {
  const minutes = Math.ceil((at - Date.now()) / 60000);
  if (minutes < 60) return `${minutes} dk`;
  return `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`;
}

function dailyButton(nextAt) {
  const button = el('button', { textContent: nextAt ? `Günlük Ödül • ${waitText(nextAt)}` : 'Günlük Ödül', className: nextAt ? '' : 'primary', disabled: Boolean(nextAt) });
  button.addEventListener('click', () => guarded(async () => {
    const r = await api('/daily', {});
    setBalance(r.balance);
    await loadHome();
    say(`+${fmt(r.amount)} coin aldın`, 'win');
  }));
  return button;
}

let myId = null;

async function loadHome() {
  try {
    const h = await api('/home');
    setBalance(h.balance);
    const progress = Math.min(100, Math.round((h.level.current / h.level.needed) * 100));
    const fill = el('i');
    fill.style.width = `${progress}%`;
    const name = $('username').textContent;
    const input = el('textarea', { className: 'field', maxLength: 1500, placeholder: 'Sunucu, Minecraft, bot ya da site için aklındaki fikri yaz' });
    const send = el('form', { className: 'suggest compact' }, input, el('button', { textContent: 'Gönder', className: 'primary' }));
    send.addEventListener('submit', (event) => {
      event.preventDefault();
      guarded(async () => {
        await api('/suggest', { text: input.value });
        input.value = '';
        say('Önerin gönderildi. Teşekkürler!', 'win');
      });
    });
    const reportWho = selectFrom((h.members ?? []).map((m) => ({ value: m.id, label: m.name })), '', 'Kimi bildiriyorsun?');
    const reportText = el('textarea', { className: 'field', maxLength: 500, placeholder: 'Ne oldu? (en az 5 karakter)' });
    const report = el('form', { className: 'report' }, reportWho, reportText, el('button', { textContent: 'Yetkililere Bildir', className: 'primary' }));
    report.addEventListener('submit', (event) => {
      event.preventDefault();
      guarded(async () => {
        await api('/report', { target: reportWho.value, reason: reportText.value });
        reportText.value = '';
        reportWho.value = '';
        say('Raporun yetkililere iletildi. Teşekkürler.', 'win');
      });
    });
    $('home').replaceChildren(
      el('div', { className: 'hero' },
        el('img', { className: 'hero-cover', src: 'cover.png', alt: 'Karia' }),
        el('div', { className: 'hero-top' },
          el('div', {}, el('h2', {}, ...(myId ? [avatarImg(myId, 'hero-avatar')] : []), `Hoş geldin, ${name}`), el('p', { textContent: `${h.server.members} üye • ${h.server.inVoice} kişi seste` })),
          el('div', { className: 'hero-actions' }, dailyButton(h.dailyAt))),
        el('div', { className: 'level-head' }, el('strong', { textContent: `Seviye ${h.level.level}` }), el('span', { textContent: `${fmt(h.level.current)} / ${fmt(h.level.needed)} XP` })),
        el('div', { className: 'progress' }, fill)),
      el('div', { className: 'stats' },
        card('Sıralaman', h.level.rank ? `#${h.level.rank}` : '-'),
        card('Haftalık Mesaj', fmt(h.week.messages)),
        card('Haftalık Ses', h.week.voice)),
      el('div', { className: 'grid2 home-cols' },
        el('div', { className: 'box' }, el('h4', { textContent: 'Duyurular' }), ...(h.announcements.length
          ? h.announcements.slice(0, 5).map((a) => el('div', { className: 'ann' }, el('div', { className: 'ann-body' }, ...renderMarkdown(a.text)), el('small', { textContent: when(a.at) })))
          : [empty('Henüz duyuru yok.')])),
        el('div', { className: 'stack' },
          el('div', { className: 'box' }, el('h4', { textContent: 'Şikayet Et' }), report),
          el('div', { className: 'box' }, el('h4', { textContent: 'Öneri Gönder' }), send))),
    );
  } catch (error) {
    say(error.message, 'lose');
  }
}

let boardType = 'seviye';
function avatarImg(id, className) {
  const img = el('img', { className, src: `avatar/${id}.png`, alt: '' });
  img.addEventListener('error', () => { img.src = 'logo.png'; }, { once: true });
  return img;
}

function boardView(rows) {
  const column = (r, place) => el('div', { className: `podium-col p${place}${r.me ? ' me' : ''}` },
    el('strong', { className: 'podium-name', textContent: r.name }),
    el('div', { className: 'podium-block' },
      ...(place === 1 ? [el('img', { className: 'podium-crown', src: 'emojis/tac.png', alt: '' })] : []),
      avatarImg(r.id, 'podium-avatar'),
      el('b', { textContent: String(place) }),
      el('em', { textContent: r.value })));
  const order = [[rows[1], 2], [rows[0], 1], [rows[2], 3]].filter(([r]) => r);
  const confetti = Array.from({ length: 26 }, (_, i) => {
    const bit = el('i');
    bit.style.left = `${(i * 37) % 100}%`;
    bit.style.animationDelay = `${(i * 0.37) % 4}s`;
    bit.style.background = ['#4fcfb4', '#ffd479', '#ef7a7f', '#7aa8ff', '#c79bff'][i % 5];
    return bit;
  });
  const runners = rows.slice(3).map((r, i) => el('li', { className: r.me ? 'me' : '' },
    el('b', { textContent: String(i + 4) }), avatarImg(r.id, 'runner-avatar'), el('span', { textContent: r.name }), el('em', { textContent: r.value })));
  return [
    el('div', { className: 'podium' }, el('div', { className: 'confetti' }, ...confetti), ...order.map(([r, place]) => column(r, place))),
    el('div', { className: 'runners-box' }, el('h4', { textContent: `Tüm Sıralama (${rows.length})` }), el('ol', { className: 'runners', start: 4 }, ...(runners.length ? runners : [el('li', { className: 'queue-empty', textContent: 'Listede başka üye yok.' })]))),
  ];
}

async function loadBoard() {
  try {
    const { rows } = await api(`/leaderboard/${boardType}`);
    $('board-list').replaceChildren(...(rows.length ? boardView(rows) : [empty('Henüz veri yok.')]));
  } catch (error) {
    say(error.message, 'lose');
  }
}
for (const b of document.querySelectorAll('[data-board]')) {
  b.addEventListener('click', () => {
    boardType = b.dataset.board;
    for (const x of document.querySelectorAll('[data-board]')) x.classList.toggle('active', x === b);
    loadBoard();
  });
}

const DASH = { home: loadHome,  leaderboard: loadBoard, overview: loadOverview, tickets: loadTickets, reports: loadReports, suggestions: loadSuggestions, cases: loadCases, modules: loadAdmin, settings: loadAdmin, commands: loadAdmin };

buildWheel();
buildRouletteBoard();
$('set-search').addEventListener('input', drawSettings);
$('cmd-search').addEventListener('input', drawCommandList);
$('cmd-select').addEventListener('change', drawCommandForm);
$('cmd-run').addEventListener('click', runCommand);

// ── Bot tarafındaki bakiye değişimleri de görünsün ──
setInterval(async () => {
  if (busy || $('app').hidden) return;
  try {
    const state = await api('/state');
    if (!busy) setBalance(state.balance);
  } catch {}
}, 8000);

// ── Açılış ──
async function login() {
  const config = await api('/config');
  limits = config;
  if (devId) {
    token = `dev:${devId}`;
    return;
  }
  const { DiscordSDK } = await import('./sdk.js');
  sdk = new DiscordSDK(config.clientId);
  await sdk.ready();
  const { code } = await sdk.commands.authorize({ client_id: config.clientId, response_type: 'code', prompt: 'none', scope: ['identify'] });
  const { access_token: accessToken } = await api('/token', { code });
  await sdk.commands.authenticate({ access_token: accessToken });
  token = accessToken;
}

async function start() {
  try {
    await login();
    const state = await api('/state');
    balance = state.balance;
    $('balance').textContent = fmt(state.balance);
    $('username').textContent = state.user.username;
    $('admin-nav').hidden = !state.isAdmin;
    $('avatar-letter').textContent = state.user.username.slice(0, 1).toLocaleUpperCase('tr');
    myId = state.user.id;
    const sideAvatar = new Image();
    sideAvatar.alt = '';
    sideAvatar.onload = () => $('avatar-letter').replaceChildren(sideAvatar);
    sideAvatar.src = `avatar/${myId}.png`;
    $('role-badge').textContent = state.isAdmin ? 'Yönetici' : 'Üye';
    $('role-badge').classList.toggle('admin', state.isAdmin);
    if (state.isAdmin) { // menü kapalıyken de bekleyen işler görünsün
      api('/admin/dashboard/1').then((d) => { setBadge('badge-tickets', d.open.tickets); setBadge('badge-reports', d.open.reports); }).catch(() => {});
    }
    if (state.blackjack) drawBlackjack({ ...state.blackjack, balance: state.balance });
    if (state.music) drawMusic(state.music);
    $('boot').hidden = true;
    $('app').hidden = false;
    openTab(state.blackjack ? 'blackjack' : 'home'); // yarım kalan el varsa oraya döner
  } catch (error) {
    $('boot-text').textContent = error.message || 'Etkinlik açılamadı.';
  }
}

start();
