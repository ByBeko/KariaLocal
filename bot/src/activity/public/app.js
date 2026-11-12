// Karia Etkinliği arayüzü. Tüm sonuçlar sunucudan gelir, burada yalnızca gösterilir.
import { sfx } from './sfx.js';

const ON_SITE = location.hostname === 'activity.karia.live'; // Tarayıcıda açıldı: oturum karia.live Discord girişinden gelir
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
let adminUser = false;
let openThread = null;

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
  document.querySelector('.content').classList.toggle('fill', isGame || ['home', 'music', 'leaderboard', 'tickets'].includes(name));
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

// ── Ses açma/kapama ──
function drawSfxToggle() {
  const off = sfx.isMuted();
  $('sfx-toggle').textContent = off ? '🔇' : '🔊';
  $('sfx-toggle').title = off ? 'Oyun seslerini aç' : 'Oyun seslerini kapat';
  $('sfx-toggle').setAttribute('aria-label', $('sfx-toggle').title);
}
$('sfx-toggle').addEventListener('click', () => {
  sfx.setMuted(!sfx.isMuted());
  drawSfxToggle();
  sfx.chip();
});
drawSfxToggle();

// ── Bahis ──
const betValue = () => Math.floor(Number($('bet').value.replace(/\D/g, '')) || 0);
for (const b of document.querySelectorAll('[data-bet]')) {
  b.addEventListener('click', () => {
    const now = betValue();
    const next = { half: Math.floor(now / 2), double: now * 2, min: limits.minBet, all: balance }[b.dataset.bet];
    $('bet').value = Math.max(limits.minBet, Math.min(next, limits.maxBet));
    sfx.chip();
  });
}

for (const chip of document.querySelectorAll('[data-add]')) {
  chip.addEventListener('click', () => {
    $('bet').value = Math.min(betValue() + Number(chip.dataset.add), limits.maxBet);
    sfx.chip();
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

let cardsOnTable = 0;
function drawBlackjack(g, fresh = false) {
  const dealt = g.hands.reduce((sum, h) => sum + h.cards.length, 0) + g.dealer.length + (g.hidden ? 1 : 0);
  sfx.card(Math.max(1, dealt - (fresh ? 0 : cardsOnTable)));
  cardsOnTable = dealt;
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
    setTimeout(() => sfx.result(g.net), 420);
  }
}

$('bj-start').addEventListener('click', () => guarded(async () => drawBlackjack(await api('/blackjack/start', { bet: String(betValue()) }), true)));
for (const [id, move] of [['bj-hit', 'hit'], ['bj-stand', 'stand'], ['bj-double', 'double'], ['bj-split', 'split']]) {
  $(id).addEventListener('click', () => guarded(async () => drawBlackjack(await api(`/blackjack/${move}`, {}))));
}

// ── Slot ──
$('slot-spin').addEventListener('click', () => guarded(async () => {
  const reels = [0, 1, 2].map((i) => $(`reel${i}`));
  const boxes = reels.map((r) => r.parentElement);
  boxes.forEach((b) => { b.classList.remove('hit'); b.classList.add('spin'); });
  say('');
  const stopSpin = sfx.spinLoop();
  try {
    const result = await api('/slot', { bet: String(betValue()) });
    setBalance(result.balance - Math.max(result.net, 0)); // kazanç, makara durunca görünür
    for (let i = 0; i < 3; i++) {
      await sleep(320);
      reels[i].src = `emojis/${result.reels[i]}.png`;
      boxes[i].classList.remove('spin');
      sfx.reelStop();
    }
    stopSpin();
    if (result.matches === 3 && result.net > 0) sfx.jackpot();
    else sfx.result(result.net);
    if (result.matches >= 2) {
      const top = result.reels.find((k, i, a) => a.indexOf(k) !== a.lastIndexOf(k));
      boxes.forEach((b, i) => b.classList.toggle('hit', result.reels[i] === top));
    }
    setBalance(result.balance);
    if (result.net > 0) say(`${result.matches === 3 ? 'ÜÇLÜ' : 'İkili'}! ${result.multiplier}× ${netText(result.net)}`, 'win');
    else say(`Olmadı. ${netText(result.net)}`, 'lose');
  } finally {
    stopSpin();
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
    sfx.coinFlip();
    say('');
    await sleep(900);
    coin.firstElementChild.textContent = result.result === 'yazi' ? 'Y' : 'T';
    setBalance(result.balance);
    sfx.coinLand();
    setTimeout(() => sfx.result(result.net), 180);
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
  sfx.chip();
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
    sfx.wheel(4);
    await sleep(4200);
    $('roulette-result').textContent = r.result;
    $('roulette-result').className = `roulette-result ${r.color}`;
    setBalance(r.balance);
    sfx.result(r.net, Object.values(bets).reduce((sum, amount) => sum + Number(amount), 0));
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
const SAY_COMMAND = { name: '__say__', category: 'yonetim', description: 'Botun ağzından bir kanala mesaj yazdır: normal ya da embed', pseudo: true, title: 'Bota Mesaj Yazdır', keywords: 'bota mesaj yazdır embed' };
const BUTTON_ROLE_COMMAND = { name: '__brole__', category: 'yonetim', description: 'Üyelerin butona basarak rol aldığı mesaj gönder', pseudo: true, title: 'Buton Rol', keywords: 'buton rol' };

function markCommand() {
  for (const b of document.querySelectorAll('.cmd-item')) b.classList.toggle('active', b.dataset.name === $('cmd-select').value);
}

function drawCommandForm() {
  resetConfirm();
  const isSay = $('cmd-select').value === '__say__';
  const isButtonRole = $('cmd-select').value === '__brole__';
  $('say-card').hidden = !isSay;
  $('brole-card').hidden = !isButtonRole;
  $('cmd-card').hidden = isSay || isButtonRole;
  markCommand();
  if (isSay || isButtonRole) return;
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
  for (const c of [...admin.commands, SAY_COMMAND, BUTTON_ROLE_COMMAND]) {
    if (!`${c.name} ${c.description} ${c.keywords ?? ''}`.toLocaleLowerCase('tr').includes(query)) continue;
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
          el('strong', { textContent: c.pseudo ? c.title : `/${c.name}` }),
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

// ── Buton rol ──
const BUTTON_STYLES = [['gray', 'Gri'], ['blue', 'Mavi'], ['green', 'Yeşil'], ['red', 'Kırmızı']];

function addButtonRoleRow() {
  if ($('brole-rows').children.length >= 25) return say('En fazla 25 buton eklenebilir.', 'lose');
  const role = selectFrom(admin.roles.filter((r) => r.buttonable).map((r) => ({ value: r.id, label: `@${r.name}` })), '', 'Rol seç');
  const label = el('input', { className: 'field', placeholder: 'Buton yazısı', maxLength: 80, autocomplete: 'off', ariaLabel: 'Buton yazısı' });
  const style = el('select', { className: 'field', ariaLabel: 'Buton rengi' }, ...BUTTON_STYLES.map(([value, textContent]) => el('option', { value, textContent })));
  const emoji = selectFrom((admin.emojis ?? []).map((item) => ({ value: item.value, label: item.name })), '', 'Emojisiz');
  emoji.ariaLabel = 'Buton emojisi';
  role.ariaLabel = 'Rol';
  role.dataset.field = 'roleId';
  label.dataset.field = 'label';
  style.dataset.field = 'style';
  emoji.dataset.field = 'emoji';
  // Yazı elle değiştirilmediyse rolün adını izler
  let suggested = '';
  role.addEventListener('change', () => {
    const name = admin.roles.find((r) => r.id === role.value)?.name ?? '';
    if (label.value === suggested) label.value = name.slice(0, 80);
    suggested = name.slice(0, 80);
  });
  const remove = el('button', { type: 'button', textContent: 'Sil', ariaLabel: 'Satırı sil' });
  const row = el('div', { className: 'brole-row' }, role, label, style, emoji, remove);
  remove.addEventListener('click', () => { row.remove(); });
  $('brole-rows').append(row);
}

function drawButtonRole() {
  const select = $('brole-channel');
  select.replaceChildren(el('option', { value: '', textContent: 'Kanal seç' }), ...channelItems([0, 5]).map((c) => el('option', { value: c.value, textContent: c.label })));
  if (!$('brole-rows').children.length) addButtonRoleRow();
}

$('brole-add').addEventListener('click', () => addButtonRoleRow());
$('brole-send').addEventListener('click', () => guarded(async () => {
  const roles = [...$('brole-rows').children].map((row) => Object.fromEntries([...row.querySelectorAll('[data-field]')].map((control) => [control.dataset.field, control.value])));
  await api('/admin/button-roles', { channelId: $('brole-channel').value, title: $('brole-title').value, text: $('brole-text').value, roles });
  $('brole-title').value = '';
  $('brole-text').value = '';
  $('brole-rows').replaceChildren();
  addButtonRoleRow();
  say('Buton rol mesajı gönderildi.', 'win');
}));

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
    drawButtonRole();
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
  const total = ['badge-tickets', 'badge-reports', 'badge-mail'].reduce((sum, key) => sum + (Number($(key).textContent) || 0), 0);
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

let ticketFilter = 'all';
let lastTickets = [];

function closeTicketView() {
  $('ticket-view').hidden = true;
  $('ticket-empty').hidden = false;
  openThread = null;
}

function markActiveTicket() {
  for (const row of $('ticket-list').children) row.classList.toggle('active', row.dataset.id === openThread?.id);
}

function drawTicketList(tickets, { keepView = false } = {}) {
  lastTickets = tickets;
  setBadge('badge-tickets', tickets.length);
  if (!keepView) closeTicketView();
  const shown = tickets.filter((t) => ticketFilter === 'all' || t.source === ticketFilter);
  $('ticket-list').replaceChildren(...(shown.length ? shown.map((t) => {
    const row = el('button', { type: 'button', className: 'ticket-row' },
      el('span', { className: 'ticket-top' },
        el('strong', { textContent: `#${t.number}` }),
        el('span', { className: `ticket-src ${t.source}`, textContent: t.source === 'mail' ? 'E-posta' : 'Discord' }),
        el('small', { textContent: when(t.createdAt) })),
      el('span', { className: 'ticket-title', textContent: t.subject || t.category }),
      el('small', { className: 'ticket-who', textContent: `${t.source === 'mail' ? t.email : t.user} • ${t.claimedBy ? `Üstlenen: ${t.claimedBy}` : 'Bekliyor'}` }));
    row.dataset.id = t.id;
    row.addEventListener('click', () => guarded(() => openTicket(t)));
    return row;
  }) : [empty(tickets.length ? 'Bu türde açık talep yok.' : 'Açık destek talebi yok.')]));
  markActiveTicket();
}

for (const button of document.querySelectorAll('[data-ticket-filter]')) {
  button.addEventListener('click', () => {
    ticketFilter = button.dataset.ticketFilter;
    for (const other of document.querySelectorAll('[data-ticket-filter]')) other.classList.toggle('active', other === button);
    drawTicketList(lastTickets, { keepView: true });
  });
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
  openThread = { id: t.id, log };
  const isMail = t.source === 'mail';
  const input = el('input', { className: 'field', placeholder: isMail ? 'Ekibe not ekle (göndericiye mail gitmez)' : 'Talebe yanıt yaz', maxLength: 1500, autocomplete: 'off' });
  const form = el('form', { className: 'inline desk-reply' }, input, el('button', { textContent: isMail ? 'Not Ekle' : 'Gönder', className: 'primary' }));
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
  const approve = t.approveRole ? confirmButton(`Onayla: ${t.approveRole}`, async () => { const data = await api(`/admin/tickets/${t.id}/approve`, {}); drawTicketList(data.tickets); say(`Talep onaylandı, ${t.approveRole} rolü verildi.`, 'win'); }) : null;
  const view = $('ticket-view');
  view.replaceChildren(
    el('div', { className: 'desk-head' }, el('div', {}, el('strong', { textContent: isMail ? t.subject : `Talep #${t.number} • ${t.category}` }), el('small', { textContent: isMail ? `#${t.number} • ${t.email}` : `#${t.number} • ${t.user}` })), el('div', { className: 'item-actions' }, claim, linkButton(t.url), ...(approve ? [approve] : []), close)),
    log, form);
  view.hidden = false;
  $('ticket-empty').hidden = true;
  markActiveTicket();
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
const MD_INLINE = /(<a?:\w+:\d+>|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+|discord\.gg\/[\w-]+|\|\|[^|\n]+\|\||<@&\d+>|<@!?\d+>|<#\d+>|\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|:[A-Za-z0-9_]+:|(?<![\w<])[@#][\p{L}\p{N}_-]+)/gu;
const mention = (text) => el('span', { className: 'mention', textContent: text });
const plainChannel = (name) => name.replace(/^[^\p{L}\p{N}]+/u, '');

function mdLink(label, url) {
  const link = el('a', { href: url, textContent: label, target: '_blank', rel: 'noopener' });
  link.addEventListener('click', (event) => { event.preventDefault(); openLink(url); });
  return link;
}

function mdInline(text) {
  const nodes = [];
  let last = 0;
  for (const m of text.matchAll(MD_INLINE)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const t = m[0];
    const custom = t.match(/^<(a?):(\w+):(\d+)>$/);
    const masked = t.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (custom) {
      const img = el('img', { className: 'emo', src: `emoji/${custom[3]}.${custom[1] ? 'gif' : 'png'}`, alt: `:${custom[2]}:`, title: `:${custom[2]}:` });
      nodes.push(img);
    } else if (masked) nodes.push(mdLink(masked[1], masked[2]));
    else if (/^https?:\/\//.test(t)) nodes.push(mdLink(t, t));
    else if (t.startsWith('discord.gg/')) nodes.push(mdLink(t, `https://${t}`));
    else if (t.startsWith('||')) {
      const spoiler = el('span', { className: 'md-spoiler' }, ...mdInline(t.slice(2, -2)));
      spoiler.addEventListener('click', () => spoiler.classList.add('open'));
      nodes.push(spoiler);
    } else if (t.startsWith('***')) nodes.push(el('strong', {}, el('em', {}, ...mdInline(t.slice(3, -3)))));
    else if (t.startsWith('<@&')) nodes.push(mention(`@${admin?.roles.find((r) => r.id === t.slice(3, -1))?.name ?? 'rol'}`));
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
  const lines = String(text).split('\n');
  const out = [];
  let quoteRest = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.startsWith('```')) { // Çok satırlı kod bloğu
      const body = [];
      for (i += 1; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      out.push(el('pre', { textContent: body.join('\n') }));
      continue;
    }
    if (line.startsWith('>>> ')) { quoteRest = true; line = line.slice(4); }
    if (quoteRest) { out.push(el('div', { className: 'md-q' }, ...mdInline(line))); continue; }
    const heading = line.match(/^(#{1,3}) (.*)/);
    if (heading) {
      out.push(el('div', { className: `md-h md-h${heading[1].length}` }, ...mdInline(heading[2])));
      if (lines[i + 1] === '') i += 1; // Discord başlıktan sonraki ilk boş satırı göstermez
      continue;
    }
    const small = line.match(/^-# (.*)/);
    const quote = line.match(/^> ?(.*)/);
    const item = line.match(/^\s*[-*] (.*)/);
    if (small) out.push(el('div', { className: 'md-sub' }, ...mdInline(small[1])));
    else if (quote) out.push(el('div', { className: 'md-q' }, ...mdInline(quote[1])));
    else if (item) out.push(el('div', { className: 'md-li' }, el('span', { textContent: '•' }), el('span', {}, ...mdInline(item[1]))));
    else out.push(line.trim() ? el('div', { className: 'md-p' }, ...mdInline(line)) : el('div', { className: 'md-gap' }));
  }
  return out;
}

// ── Duyurular: en yeni ya da sabit duyuru başta, diğerleri sağa kaydırılır ──
function annPinButton(a, holder) {
  const button = el('button', { type: 'button', className: 'ann-pin', textContent: a.pinned ? 'Sabiti kaldır' : 'Sabitle' });
  button.addEventListener('click', () => guarded(async () => {
    const r = await api(`/admin/announcements/${a.id}/pin`, { pinned: !a.pinned });
    drawAnnouncements(holder, r.announcements);
    say(a.pinned ? 'Duyurunun sabiti kaldırıldı.' : 'Duyuru sabitlendi.', 'win');
  }));
  return button;
}

function drawAnnouncements(holder, list) {
  if (!list.length) return holder.replaceChildren(empty('Henüz duyuru yok.'));
  const track = el('div', { className: 'ann-track' }, ...list.map((a) => el('article', { className: 'ann' },
    el('div', { className: 'ann-head' },
      ...(a.pinned ? [el('span', { className: 'ann-badge', textContent: 'Sabit' })] : []),
      el('strong', { textContent: a.author }),
      el('small', { textContent: when(a.at) }),
      ...(adminUser ? [annPinButton(a, holder)] : [])),
    el('div', { className: 'ann-body' }, ...renderMarkdown(a.text)))));
  const prev = el('button', { type: 'button', className: 'ann-arrow', textContent: '‹', ariaLabel: 'Önceki duyuru' });
  const next = el('button', { type: 'button', className: 'ann-arrow', textContent: '›', ariaLabel: 'Sonraki duyuru' });
  const count = el('span', { className: 'ann-count' });
  const sync = () => {
    const index = Math.round(track.scrollLeft / (track.clientWidth || 1));
    count.textContent = `${index + 1} / ${list.length}`;
    prev.disabled = index <= 0;
    next.disabled = index >= list.length - 1;
  };
  prev.addEventListener('click', () => track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' }));
  next.addEventListener('click', () => track.scrollBy({ left: track.clientWidth, behavior: 'smooth' }));
  track.addEventListener('scroll', sync, { passive: true });
  holder.replaceChildren(el('div', { className: 'ann-nav', hidden: list.length < 2 }, prev, count, next), el('div', { className: 'ann-list' }, track));
  sync();
}

function announcementBox(list) {
  const holder = el('div', { className: 'ann-holder' });
  drawAnnouncements(holder, list);
  return el('div', { className: 'box ann-box' }, el('h4', { textContent: 'Duyurular' }), holder);
}

// ── Profil fotoğraflı ve aramalı üye seçici ──
function memberPicker(members, placeholder) {
  const label = el('span', { className: 'picker-label', textContent: placeholder });
  const face = el('span', { className: 'picker-face', hidden: true });
  const toggle = el('button', { type: 'button', className: 'picker-toggle', ariaExpanded: 'false', ariaHasPopup: 'listbox' }, face, label, el('i', { className: 'chev-down', ariaHidden: 'true' }));
  const search = el('input', { className: 'picker-search', placeholder: 'Üye ara', autocomplete: 'off', ariaLabel: 'Üye ara' });
  const list = el('div', { className: 'picker-list' });
  list.setAttribute('role', 'listbox');
  const pop = el('div', { className: 'picker-pop', hidden: true }, search, list);
  const root = el('div', { className: 'picker' }, toggle, pop);
  let value = '';
  let active = 0;
  let shown = [];

  const outside = (event) => { if (!root.contains(event.target)) close(); };
  function close() {
    pop.hidden = true;
    toggle.ariaExpanded = 'false';
    document.removeEventListener('pointerdown', outside);
  }
  function pick(member) {
    value = member?.id ?? '';
    label.textContent = member?.name ?? placeholder;
    root.classList.toggle('chosen', Boolean(member));
    face.hidden = !member;
    face.replaceChildren(...(member ? [avatarImg(member.id, 'picker-avatar')] : []));
    close();
  }
  function mark() {
    [...list.children].forEach((row, index) => row.classList.toggle('active', index === active));
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  }
  function draw() {
    const query = search.value.trim().toLocaleLowerCase('tr');
    shown = members.filter((m) => m.name.toLocaleLowerCase('tr').includes(query));
    active = 0;
    list.replaceChildren(...(shown.length ? shown.map((m, index) => {
      const row = el('div', { className: 'picker-row' }, avatarImg(m.id, 'picker-avatar'), el('span', { textContent: m.name }));
      row.setAttribute('role', 'option');
      row.addEventListener('pointerenter', () => { active = index; mark(); });
      row.addEventListener('click', () => pick(m));
      return row;
    }) : [el('p', { className: 'picker-empty', textContent: 'Üye bulunamadı.' })]));
    mark();
  }
  toggle.addEventListener('click', () => {
    if (!pop.hidden) return close();
    pop.hidden = false;
    toggle.ariaExpanded = 'true';
    search.value = '';
    draw();
    search.focus();
    document.addEventListener('pointerdown', outside);
  });
  search.addEventListener('input', draw);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); toggle.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); if (shown[active]) { pick(shown[active]); toggle.focus(); } }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (shown.length) { active = (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; mark(); }
    }
  });
  return { root, get value() { return value; }, set value(id) { pick(members.find((m) => m.id === id)); } };
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
    sfx.coins();
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
    const reportWho = memberPicker(h.members ?? [], 'Kimi bildiriyorsun?');
    const reportText = el('textarea', { className: 'field', maxLength: 500, placeholder: 'Ne oldu? (en az 5 karakter)' });
    const report = el('form', { className: 'report' }, reportWho.root, reportText, el('button', { textContent: 'Yetkililere Bildir', className: 'primary' }));
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
        announcementBox(h.announcements),
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

// ── Prime üyelikleri ──
function drawPrime(data) {
  const picker = memberPicker(data.members, 'Prime verilecek üye');
  const days = el('select', { className: 'field prime-days', ariaLabel: 'Süre' }, ...data.days.map((d) => el('option', { value: String(d), textContent: `${d} gün`, selected: d === 30 })));
  const add = el('button', { type: 'button', className: 'primary', textContent: 'Prime Ver' });
  add.addEventListener('click', () => guarded(async () => {
    if (!picker.value) throw new Error('Önce üye seç.');
    drawPrime(await api('/admin/prime', { userId: picker.value, days: Number(days.value) }));
    say('Prime verildi.', 'win');
  }));
  $('prime-form').replaceChildren(
    el('div', { className: 'prime-row' }, picker.root, days, add),
    el('p', { className: 'hint left', textContent: `Rol seçilen süre kadar verilir ve süre bitince kendiliğinden alınır. Üyenin ilk Prime'ında ${fmt(data.coin)} coin hediye edilir, üyeye Discord'dan bilgi gider.` }));
  $('prime-list').replaceChildren(...(data.prime.length ? data.prime.map((p) => {
    const extend = el('button', { type: 'button', textContent: '+30 gün' });
    extend.addEventListener('click', () => guarded(async () => { drawPrime(await api('/admin/prime', { userId: p.id, days: 30 })); say('Süre uzatıldı.', 'win'); }));
    return el('article', { className: 'item prime-item' },
      avatarImg(p.id, 'picker-avatar'),
      el('div', {}, el('strong', { textContent: p.name }), el('small', { textContent: p.until ? `Bitiş: ${when(p.until)}` : 'Süresiz' })),
      el('div', { className: 'item-actions' }, extend, confirmButton('Kaldır', async () => { drawPrime(await api('/admin/prime/remove', { userId: p.id })); say('Prime kaldırıldı.', 'win'); })));
  }) : [empty('Henüz Prime üye yok.')]));
}
const loadPrime = () => guarded(async () => drawPrime(await api('/admin/prime')));

// ── Sosyal paylaşım ──
const SOCIAL_STATUS = { pending: 'Sırada', running: 'Paylaşılıyor', done: 'Paylaşıldı', failed: 'Başarısız' };
const socialOff = new Set(); // Kullanıcının işaretini kaldırdığı platformlar yenilemede geri gelmesin
let socialAccounts = [];
let socialSending = false;

function socialAccountCard(a) {
  const action = el('button', { type: 'button', className: 'primary', textContent: a.broken ? 'Yeniden Bağla' : 'Bağla' });
  action.addEventListener('click', async () => {
    const tab = sdk ? null : window.open('', '_blank'); // Tarayıcı, beklemeden sonra açılan pencereyi engeller
    try {
      const { url } = await api('/admin/social/connect', { platform: a.platform });
      if (tab) tab.location = url;
      else openLink(url);
    } catch (error) {
      tab?.close();
      say(error.message, 'lose');
    }
  });
  const status = !a.ready && !a.name ? 'Kurulum bekliyor' : a.broken ? 'Oturum geçersiz' : a.name ?? 'Bağlı değil';
  const actions = el('div', { className: 'item-actions' });
  if (a.ready && (!a.name || a.broken)) actions.append(action);
  if (a.name) actions.append(confirmButton('Kaldır', async () => drawSocial(await api('/admin/social/disconnect', { platform: a.platform }))));
  return el('article', { className: 'item social-account' },
    el('div', {}, el('strong', { textContent: a.label }), el('small', { textContent: status }), a.limit ? el('small', { className: 'social-limit', textContent: a.limit }) : ''),
    actions);
}

function socialResult(r) {
  const row = el('div', { className: `social-result ${r.status}` }, el('b', { textContent: r.label }), el('span', { textContent: SOCIAL_STATUS[r.status] ?? r.status }));
  if (r.url) {
    const open = el('button', { type: 'button', textContent: 'Aç' });
    open.addEventListener('click', () => openLink(r.url));
    row.append(open);
  }
  const detail = r.error ?? r.note;
  if (detail) row.append(el('small', { textContent: detail }));
  return row;
}

// TikTok paylaşım kuralları: gizlilik varsayılansız elle seçilir, etkileşimler kapalı başlar, ticari içerik beyan edilir
const TT_PRIVACY = { PUBLIC_TO_EVERYONE: 'Herkes', FOLLOWER_OF_CREATOR: 'Takipçiler', MUTUAL_FOLLOW_FRIENDS: 'Arkadaşlar (karşılıklı takip)', SELF_ONLY: 'Yalnızca ben' };
let tiktokCreatorInfo = null;
let tiktokLoading = false;
let socialDuration = null;
const tiktokChosen = () => socialAccounts.some((a) => a.platform === 'tiktok') && !socialOff.has('tiktok');

function legalLink(text, url) {
  const link = el('a', { href: url, textContent: text });
  link.addEventListener('click', (event) => { event.preventDefault(); openLink(url); });
  return link;
}

function drawTikTokConsent() {
  const parts = ['Paylaşarak TikTok ', legalLink('Müzik Kullanım Onayı', 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en')];
  if ($('tt-branded').checked) parts.push(' ve ', legalLink('Markalı İçerik Politikası', 'https://www.tiktok.com/legal/page/global/bc-policy/en'));
  parts.push(' koşullarını kabul etmiş olursun. Paylaşımdan sonra videonun profilde görünmesi birkaç dakika sürebilir.');
  $('tt-consent').replaceChildren(...parts);
}

function drawTikTokDuration() {
  const max = tiktokCreatorInfo?.maxDuration;
  const tooLong = max && socialDuration && socialDuration > max;
  $('tt-duration').hidden = !tooLong;
  if (tooLong) $('tt-duration').textContent = `Bu TikTok hesabı en çok ${max} saniyelik video kabul ediyor; seçilen video ${Math.ceil(socialDuration)} saniye.`;
}

function drawTikTokOptions() {
  const info = tiktokCreatorInfo;
  if (!info) return;
  $('tt-account').textContent = `Paylaşılacak hesap: ${info.nickname}${info.username ? ` (@${info.username})` : ''}`
    + (info.audited ? '' : '. TikTok denetimi bitene kadar yalnızca "Yalnızca ben" paylaşılabilir ve TikTok hesabının gizli olması gerekir.');
  const select = $('tt-privacy');
  const current = select.value;
  select.replaceChildren(el('option', { value: '', disabled: true, selected: !current, textContent: 'Seç' }),
    ...info.privacyOptions.map((p) => el('option', { value: p, textContent: TT_PRIVACY[p] ?? p, selected: p === current })));
  for (const [id, off] of [['tt-comment', info.commentDisabled], ['tt-duet', info.duetDisabled], ['tt-stitch', info.stitchDisabled]]) {
    $(id).disabled = off;
    if (off) $(id).checked = false;
    $(id).parentElement.title = off ? 'Bu hesabın TikTok ayarlarında kapalı' : '';
  }
  syncBranded();
  drawTikTokDuration();
}

// Markalı içerik "Yalnızca ben" olarak paylaşılamaz
function syncBranded() {
  const branded = $('tt-branded').checked;
  const self = [...$('tt-privacy').options].find((o) => o.value === 'SELF_ONLY');
  if (self) {
    self.disabled = branded;
    self.textContent = branded ? 'Yalnızca ben (markalı içerikte kullanılamaz)' : TT_PRIVACY.SELF_ONLY;
  }
  if (branded && $('tt-privacy').value === 'SELF_ONLY') {
    $('tt-privacy').value = '';
    say('Markalı içerik "Yalnızca ben" olarak paylaşılamaz, gizliliği yeniden seç.', 'lose');
  }
  drawTikTokConsent();
}

async function updateTikTokBox() {
  const show = tiktokChosen();
  $('social-tiktok').hidden = !show;
  if (!show || tiktokCreatorInfo || tiktokLoading) return;
  tiktokLoading = true;
  try {
    tiktokCreatorInfo = await api('/admin/social/tiktok');
    drawTikTokOptions();
  } catch (error) {
    $('tt-account').textContent = `TikTok hesap bilgisi alınamadı: ${error.message}`;
  } finally {
    tiktokLoading = false;
  }
}

$('tt-commercial').addEventListener('change', () => {
  $('tt-commercial-box').hidden = !$('tt-commercial').checked;
  if (!$('tt-commercial').checked) { $('tt-yourbrand').checked = false; $('tt-branded').checked = false; }
  syncBranded();
});
$('tt-branded').addEventListener('change', syncBranded);
drawTikTokConsent();

function tiktokPayload() {
  if (!tiktokCreatorInfo) throw new Error('TikTok hesap bilgisi henüz alınmadı, biraz bekleyip yeniden dene.');
  const privacy = $('tt-privacy').value;
  if (!privacy) throw new Error('TikTok için kimlerin görebileceğini seç.');
  const commercial = $('tt-commercial').checked;
  if (commercial && !$('tt-yourbrand').checked && !$('tt-branded').checked) throw new Error('Ticari içerikte "Kendi markan" ya da "Markalı içerik" seçeneklerinden en az birini işaretle.');
  const max = tiktokCreatorInfo.maxDuration;
  if (max && socialDuration && socialDuration > max) throw new Error(`TikTok bu hesapta en çok ${max} saniyelik video kabul ediyor.`);
  return { privacy, comment: $('tt-comment').checked, duet: $('tt-duet').checked, stitch: $('tt-stitch').checked, commercial, yourBrand: $('tt-yourbrand').checked, branded: $('tt-branded').checked };
}

function drawSocial(data) {
  socialAccounts = data.accounts.filter((a) => a.name && !a.broken);
  if (!socialAccounts.some((a) => a.platform === 'tiktok')) tiktokCreatorInfo = null; // Hesap değişirse bilgi yeniden alınır
  $('social-accounts').replaceChildren(...data.accounts.map(socialAccountCard));
  updateTikTokBox();
  $('social-targets').replaceChildren(...(socialAccounts.length ? socialAccounts.map((a) => {
    const box = el('input', { type: 'checkbox', checked: !socialOff.has(a.platform) });
    box.addEventListener('change', () => { if (box.checked) socialOff.delete(a.platform); else socialOff.add(a.platform); updateTikTokBox(); });
    return el('label', { className: 'social-target' }, box, el('span', { textContent: `${a.label} · ${a.name}` }));
  }) : [el('p', { className: 'hint left', textContent: 'Paylaşım için önce yukarıdan hesap bağla.' })]));
  // "Emin misin?" onayı beklenirken otomatik yenileme listeyi yeniden çizip onayı silmesin
  const confirming = [...$('social-list').querySelectorAll('button.danger')].some((b) => b.textContent === 'Emin misin?');
  if (!confirming) $('social-list').replaceChildren(...(data.posts.length ? data.posts.map((p) => {
    const actions = el('div', { className: 'item-actions' });
    if (p.canRetry) {
      const retry = el('button', { type: 'button', textContent: 'Başarısızları Yeniden Dene' });
      retry.addEventListener('click', () => guarded(async () => drawSocial(await api('/admin/social/retry', { id: p.id }))));
      actions.append(retry);
    }
    // Yalnızca paneldeki kayıt ve sunucudaki dosya silinir; platformlardaki video kalır
    if (!p.results.some((r) => r.status === 'pending' || r.status === 'running')) {
      actions.append(confirmButton('Sil', async () => {
        drawSocial(await api('/admin/social/delete', { id: p.id }));
        say('Kayıt silindi. Platformlarda yayınlanan video yerinde duruyor.', 'win');
      }));
    }
    return el('article', { className: 'item social-post' },
      el('div', {}, el('strong', { textContent: p.title }), el('small', { textContent: when(p.at) }), el('div', { className: 'social-results' }, ...p.results.map(socialResult))),
      actions);
  }) : [empty('Henüz paylaşım yok.')]));
}

// Maillerin görüneceği kutu: mail özgün görünümüyle ayrı bir çerçevede açılır, HTML'i olmayan mail düz yazı gösterilir
let mailData = { mails: [], unread: 0, addresses: [] };
let mailSignature = '';
let mailOpenId = null;
let mailOpenBody = null;

function setMailCount(count) {
  mailData.unread = count;
  setBadge('badge-mail', count);
}

function mailContent(m) {
  if (!mailOpenBody.viewToken) return el('p', { className: 'mail-body', textContent: mailOpenBody.body || '(Boş mesaj)' });
  // Yalıtım sunucunun gönderdiği sandbox kuralıyla yapılır: betikler çalışmaz, panel oturumuna erişilemez
  return el('iframe', { className: 'mail-frame', title: m.subject, referrerPolicy: 'no-referrer', src: `${API.replace(/\/api$/, '')}/social/mailview/${mailOpenBody.viewToken}` });
}

function mailRow(m) {
  const head = el('button', { type: 'button', className: 'mail-head', ariaExpanded: String(mailOpenId === m.id) },
    el('strong', { textContent: m.subject }),
    el('small', { textContent: `${m.fromName ? `${m.fromName} · ` : ''}${m.from} → ${m.to} · ${when(m.at)}` }),
    mailOpenId === m.id ? '' : el('span', { textContent: m.preview }));
  head.addEventListener('click', () => toggleMail(m));
  const row = el('article', { className: `item mail-item${m.read ? '' : ' unread'}` }, head);
  if (mailOpenId === m.id && mailOpenBody) {
    row.append(el('div', { className: 'mail-open' },
      mailContent(m),
      mailOpenBody.attachments ? el('p', { className: 'hint left', textContent: `${mailOpenBody.attachments} ek dosya panele aktarılmaz.` }) : '',
      el('div', { className: 'item-actions' }, confirmButton('Sil', async () => {
        mailOpenId = null;
        mailOpenBody = null;
        drawMails(await api(`/admin/social/mails/${m.id}/delete`, {}));
      }))));
  }
  return row;
}

function paintMails() {
  const filter = $('mail-filter').value;
  const shown = mailData.mails.filter((m) => !filter || m.to === filter);
  $('mail-list').replaceChildren(...(shown.length ? shown.map(mailRow) : [empty('Henüz mail yok.')]));
}

function drawMails(data) {
  const signature = JSON.stringify(data.mails.map((m) => [m.id, m.read]));
  mailData = data;
  setMailCount(data.unread);
  if (signature === mailSignature) return; // Yenileme açık maili ve kaydırmayı bozmasın
  mailSignature = signature;
  const select = $('mail-filter');
  const keep = select.value;
  select.replaceChildren(el('option', { value: '', textContent: 'Tüm adresler' }), ...data.addresses.map((a) => el('option', { value: a, textContent: a })));
  select.value = data.addresses.includes(keep) ? keep : '';
  paintMails();
}

async function toggleMail(m) {
  if (mailOpenId === m.id) {
    mailOpenId = null;
    mailOpenBody = null;
    return paintMails();
  }
  try {
    const opened = await api(`/admin/social/mails/${m.id}`);
    mailOpenId = m.id;
    mailOpenBody = opened;
    m.read = true;
    setMailCount(opened.unread);
    mailSignature = JSON.stringify(mailData.mails.map((x) => [x.id, x.read]));
    paintMails();
  } catch (error) {
    say(error.message, 'lose');
  }
}

$('mail-filter').addEventListener('change', paintMails);
const loadMails = () => api('/admin/social/mails').then(drawMails).catch((error) => say(error.message, 'lose'));

const refreshSocial = () => api('/admin/social').then(drawSocial).catch((error) => say(error.message, 'lose'));

async function uploadSocialVideo(file) {
  const { id, token: uploadToken, chunkSize } = await api('/admin/social/upload', { name: file.name, size: file.size });
  const base = `${API.replace(/\/api$/, '')}/social/upload/${uploadToken}`;
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    try {
      const res = await fetch(`${base}?offset=${offset}`, { method: 'POST', body: file.slice(offset, offset + chunkSize) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && Number.isInteger(data.received)) offset = data.received;
      else if (!res.ok) throw new Error(data.error || 'Video yüklenemedi.');
      else offset = data.received;
      failures = 0;
      $('social-progress').value = Math.floor((offset / file.size) * 100);
    } catch (error) {
      failures += 1;
      if (failures >= 4) throw error;
      await sleep(failures * 1500);
    }
  }
  return id;
}

$('social-file').addEventListener('change', () => {
  const file = $('social-file').files[0];
  $('social-file-name').textContent = file?.name ?? 'Video seç (MP4 veya MOV, en çok 1 GB)';
  socialDuration = null;
  drawTikTokDuration();
  if (!file) return;
  // TikTok süre sınırı için videonun süresi tarayıcıda okunur; dosya sunucuya gitmeden önce uyarılır
  const probe = document.createElement('video');
  const url = URL.createObjectURL(file);
  probe.preload = 'metadata';
  probe.onloadedmetadata = () => { socialDuration = Number.isFinite(probe.duration) ? probe.duration : null; URL.revokeObjectURL(url); drawTikTokDuration(); };
  probe.onerror = () => URL.revokeObjectURL(url);
  probe.src = url;
});

// Yükleme uzun sürebilir: genel kilit kullanılmaz, panelin kalanı çalışmaya devam eder
$('social-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (socialSending) return;
  const file = $('social-file').files[0];
  const title = $('social-title').value.trim();
  const platforms = socialAccounts.map((a) => a.platform).filter((p) => !socialOff.has(p));
  if (!file) return say('Önce video seç.', 'lose');
  if (!title) return say('Başlık yaz.', 'lose');
  if (!platforms.length) return say('En az bir hesap seç.', 'lose');
  let tiktok;
  if (platforms.includes('tiktok')) {
    try { tiktok = tiktokPayload(); } catch (error) { return say(error.message, 'lose'); }
  }
  socialSending = true;
  $('social-send').disabled = true;
  $('social-send').textContent = 'Yükleniyor';
  $('social-progress').value = 0;
  $('social-progress').hidden = false;
  try {
    const id = await uploadSocialVideo(file);
    drawSocial(await api('/admin/social/publish', { id, title, description: $('social-description').value, platforms, tiktok }));
    $('social-form').reset();
    $('social-file-name').textContent = 'Video seç (MP4 veya MOV, en çok 1 GB)';
    $('tt-commercial-box').hidden = true;
    socialDuration = null;
    $('tt-privacy').value = ''; // Sıfırlamada tarayıcı ilk seçeneği seçebilir; TikTok varsayılan gizlilik istemez
    drawTikTokOptions();
    syncBranded();
    say(tiktok ? 'Video gönderildi. TikTok\'ta profilde görünmesi birkaç dakika sürebilir.' : 'Video gönderildi, paylaşım durumu aşağıda.', 'win');
  } catch (error) {
    say(error.message, 'lose');
  } finally {
    socialSending = false;
    $('social-send').disabled = false;
    $('social-send').textContent = 'Hepsinde Paylaş';
    $('social-progress').hidden = true;
  }
});

setInterval(() => {
  if (!document.hidden && !document.querySelector('[data-panel="social"]').hidden) refreshSocial();
}, 5000);

const DASH = { mail: loadMails, social: refreshSocial, prime: loadPrime, home: loadHome,  leaderboard: loadBoard, overview: loadOverview, tickets: loadTickets, reports: loadReports, suggestions: loadSuggestions, cases: loadCases, modules: loadAdmin, settings: loadAdmin, commands: loadAdmin };

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

// ── Yönetim listeleri kendiliğinden güncellenir: yalnızca değişen liste çizilir, yazılan yanıt silinmez ──
const LIVE_INTERVAL = 5000;
const liveSeen = new Map();
let liveTick = 0;
let liveRunning = false;

function liveChanged(key, data) {
  const signature = JSON.stringify(data);
  if (liveSeen.get(key) === signature) return false;
  liveSeen.set(key, signature);
  return true;
}

async function refreshThread() {
  if (!openThread || $('ticket-view').hidden) return;
  const { id, log } = openThread;
  try {
    const { messages } = await api(`/admin/tickets/${id}`);
    if (openThread?.id === id && liveChanged(`thread:${id}`, messages)) drawMessages(log, messages);
  } catch (error) {
    if (error.message !== 'Bu talep artık açık değil.') return;
    closeTicketView();
    say('Bu talep kapatıldı.');
  }
}

async function refreshAdminLists() {
  if (!adminUser || liveRunning || document.hidden || $('app').hidden) return;
  liveRunning = true;
  liveTick += 1;
  try {
    const panel = document.querySelector('.panel:not([hidden])')?.dataset.panel;
    const [{ tickets }, { reports }, mails] = await Promise.all([api('/admin/tickets'), api('/admin/reports'), api('/admin/social/mails')]);
    setBadge('badge-tickets', tickets.length);
    setBadge('badge-reports', reports.filter((r) => !r.resolved).length);
    drawMails(mails);
    if (liveChanged('tickets', tickets) && panel === 'tickets') drawTicketList(tickets, { keepView: true });
    if (panel === 'tickets') await refreshThread();
    if (liveChanged('reports', reports) && panel === 'reports') drawReports(reports);
    // Öneriler Discord kanalından okunduğu için daha seyrek sorulur
    if (panel === 'suggestions' && liveTick % 2 === 0) {
      const data = await api('/admin/suggestions');
      if (liveChanged('suggestions', data)) drawSuggestions(data);
    }
  } catch { /* geçici bağlantı hatası bir sonraki denemede düzelir */ }
  liveRunning = false;
}
setInterval(refreshAdminLists, LIVE_INTERVAL);

// ── Açılış ──
async function login() {
  const config = await api('/config');
  limits = config;
  if (ON_SITE) return;
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
    adminUser = state.isAdmin;
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
      api('/admin/social/mails').then(drawMails).catch(() => {});
    }
    if (state.blackjack) drawBlackjack({ ...state.blackjack, balance: state.balance });
    if (state.music) drawMusic(state.music);
    $('boot').hidden = true;
    $('app').hidden = false;
    $('site-back').hidden = false;
    if (!ON_SITE) { // Discord içinde dış bağlantı SDK ile açılır
      $('site-back').addEventListener('click', (event) => { event.preventDefault(); openLink('https://karia.live'); });
    }
    const linked = ON_SITE && ['blackjack', 'music', 'leaderboard'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
    openTab(state.blackjack ? 'blackjack' : linked); // yarım kalan el varsa oraya döner
  } catch (error) {
    $('boot-text').textContent = error.message || 'Etkinlik açılamadı.';
  }
}

start();
