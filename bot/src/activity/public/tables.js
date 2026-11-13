import { initBoards } from './boards.js';

// Çok oyunculu masalar: lobi, canlı izleme ve oyun çizimleri (poker, Süper Tayyare, rulet, blackjack masası, zar).
// Bütün kararlar sunucudadır; burası yalnızca gösterir ve hamleyi iletir.
export function initTables(ctx) {
  const { api, $, el, fmt, say, setBalance, sfx, cardEl, avatarImg, betValue, guarded, limits, myId } = ctx;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let offset = 0; // sunucu saati - yerel saat
  const now = () => Date.now() + offset;
  const secs = (at) => Math.max(0, Math.ceil((at - now()) / 1000));
  const btn = (text, onClick, className = '') => {
    const b = el('button', { type: 'button', className, textContent: text });
    b.addEventListener('click', onClick);
    return b;
  };
  const short = (n) => (n >= 100_000 ? `${+(n / 1000).toFixed(0)}K` : n >= 10_000 ? `${+(n / 1000).toFixed(1)}K` : fmt(n));

  // ── Canlı izleme: sunucu değişiklik olana kadar isteği bekletir ──
  let watching = null;

  function stop() {
    if (!watching) return;
    watching.alive = false;
    if (/rulet|tayyare/.test(watching.id)) api(`/tables/${watching.id}/away`, {}).catch(() => {});
    watching = null;
  }

  function apply(w, data, t0) {
    if (!w.alive || data.v <= w.v) return;
    w.v = data.v;
    // Uzun bekleyen istekte cevap sunucudan hemen önce çıkmıştır; kısa istekte gidiş-dönüşün ortası alınır
    if (data.now && t0) offset = Date.now() - t0 > 1500 ? data.now - Date.now() + 40 : data.now - (t0 + Date.now()) / 2;
    w.last = data;
    w.render(data.room, data);
  }

  async function watch(id, render, onClosed) {
    stop();
    const w = { id, v: -1, render, alive: true };
    watching = w;
    while (w.alive) {
      try {
        const t0 = Date.now();
        const data = await api(`/tables/${id}?v=${w.v}`);
        apply(w, data, t0);
      } catch (error) {
        if (!w.alive) break;
        if (/kapandı/.test(error.message)) {
          w.alive = false;
          onClosed?.();
          break;
        }
        await sleep(2500);
      }
    }
  }

  /** Hamle: sonuç hemen çizilir, uzun bekleyen istek de aynı sürümü getirir */
  async function send(id, action, body = {}) {
    const t0 = Date.now();
    const data = await api(`/tables/${id}/${action}`, body);
    // Solo masadan kalkınca masa kapanır: tanıtım ekranına dönülür
    if (data.closed) {
      if (data.balance !== undefined) setBalance(data.balance);
      if (watching?.id === id) stop();
      if (current?.table === id) soloIntro(current.game, current.root);
      return data;
    }
    if (watching?.id === id) apply(watching, data, t0);
    else if (data.balance !== undefined) setBalance(data.balance);
    return data;
  }
  const act = (id, action, body) => guarded(() => send(id, action, body));

  // Süre çubukları ve geri sayımlar
  setInterval(() => {
    for (const node of document.querySelectorAll('[data-deadline]')) {
      const end = Number(node.dataset.deadline);
      const total = Number(node.dataset.total) || 1;
      const left = Math.max(0, end - now());
      node.style.setProperty('--p', String(Math.min(1, left / total)));
      if (node.dataset.count !== undefined) node.dataset.count = String(Math.ceil(left / 1000));
    }
    for (const node of document.querySelectorAll('[data-countdown]')) {
      node.textContent = node.dataset.countdown.replace('{s}', String(secs(Number(node.dataset.at))));
    }
  }, 200);

  const countdown = (template, at) => {
    const span = el('span', { textContent: template.replace('{s}', String(secs(at))) });
    span.dataset.countdown = template;
    span.dataset.at = String(at);
    return span;
  };

  // Kart animasyonu yalnızca yeni gelen kartta oynar
  const seenCards = new Set();
  function card(c, key) {
    const node = cardEl(c);
    const k = `${key}:${c ? c.r + c.s : 'x'}`;
    if (seenCards.has(k)) node.classList.add('still');
    else {
      seenCards.add(k);
      if (seenCards.size > 400) seenCards.clear();
    }
    return node;
  }

  const isBot = (id) => String(id).startsWith('bot-');
  const face = (id) => (isBot(id) ? el('img', { src: 'emojis/bot.png', alt: '', className: 'bot-face' }) : avatarImg(id, ''));
  function avatar(id, extra = '') {
    const box = el('div', { className: `seat-avatar ${extra}${isBot(id) ? ' bot' : ''}` });
    box.append(face(id));
    return box;
  }

  /** Masanın son elleri: kim kazandı, ne kadar */
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '±0');
  function pastBox(game, past = []) {
    if (!past.length) return el('div', { className: 'past empty' });
    const items = past.map((p) => {
      if (game === 'poker') return el('div', { className: 'past-item' }, el('b', { textContent: p.winners.map((w) => w.name).join(', ') }), el('span', { textContent: `+${fmt(p.winners.reduce((a, w) => a + w.amount, 0))}${p.winners[0]?.hand ? ` • ${p.winners[0].hand}` : ''}` }));
      if (game === 'zar') return el('div', { className: 'past-item' }, el('b', { textContent: p.winners.join(', ') }), el('span', { textContent: `Pot ${fmt(p.pot)} • ${p.best} attı` }));
      if (game === 'turn') return el('div', { className: 'past-item' }, el('b', { textContent: p.winners.length ? p.winners.join(', ') : 'Berabere' }), el('span', { textContent: `${p.reason} • Pot ${fmt(p.pot)}` }));
      return el('div', { className: 'past-item' }, el('b', { textContent: `Krupiye ${p.dealer}` }), el('span', { textContent: p.players.map((x) => `${x.name.replace(' (Bot)', '')} ${signed(x.net)}`).join(' • ') }));
    });
    return el('div', { className: 'past' }, el('h5', { textContent: game === 'zar' ? 'Son turlar' : 'Son eller' }), el('div', { className: 'past-list' }, ...items));
  }

  // ── Lobi (poker, blackjack masası, zar) ──
  const LOBBY = {
    poker: { title: 'Poker', sub: "Texas Hold'em • Arkadaşlarınla online ya da masaya oturup + Bot ile botlara karşı • Kalkınca kalan fiş cüzdana döner", stake: 'Kör' },
    blackjack: { title: 'Blackjack Masası', sub: 'Aynı krupiyeye karşı 6 kişiye kadar online • İstersen + Bot ile masayı doldur', stake: 'Bahis' },
    zar: { title: 'Zar Düellosu', sub: 'En yüksek atan potun hepsini alır • Online ya da + Bot ile botlara karşı', stake: 'Giriş' },
    satranc: { title: 'Satranç', sub: 'İki kişilik, kazanan iki girişi alır • Berabere biterse giriş geri döner', stake: 'Giriş' },
    okey: { title: 'Okey 101', sub: '4 kişilik • 101 ya da 5 çiftle aç, elini ilk bitiren potu alır • Eksik koltuklara + Bot', stake: 'Giriş' },
    labirent: { title: 'Karia Labirent', sub: 'Karşı kenara ilk varan kazanır • Yürü ya da karelerin arasına engel koy (10 engel)', stake: 'Giriş' },
  };
  let lobbyTimer = 0;
  let current = null; // açık oyun kökü: { game, root }

  async function showLobby(game, root) {
    stop();
    clearTimeout(lobbyTimer);
    current = { game, root, table: null };
    let data;
    try {
      data = await api(`/tables?game=${game}`);
    } catch (error) {
      root.replaceChildren(el('p', { className: 'room-empty', textContent: error.message }));
      return;
    }
    if (current?.root !== root || current.table) return;
    if (data.seatedAt?.startsWith(`${game}-`)) return openTable(game, data.seatedAt, root);
    const info = LOBBY[game];
    const stakes = game === 'poker' ? data.blinds.map((b) => [b, `${fmt(b)}/${fmt(b * 2)}`]) : game === 'zar' ? data.antes.map((a) => [a, fmt(a)]) : data.stakes?.length ? data.stakes.map((a) => [a, fmt(a)]) : null;
    const select = stakes ? el('select', { className: 'stake-select' }, ...stakes.map(([v, label]) => el('option', { value: String(v), textContent: `${info.stake} ${label}` }))) : null;
    const create = btn('Yeni Masa Aç', () => guarded(async () => {
      const made = await api('/tables', { game, stake: select ? Number(select.value) : null });
      openTable(game, made.id, root);
    }), 'primary');
    const cards = data.tables.map((t) => {
      const seats = el('div', { className: 'lobby-seats' }, ...Array.from({ length: t.max }, (_, i) => el('i', { className: i < t.players ? 'on' : '' })));
      const card = el('button', { type: 'button', className: 'lobby-card' },
        el('div', { className: 'lobby-felt' }, el('img', { src: 'logo.png', alt: '' })),
        el('div', { className: 'lobby-info' },
          el('strong', { textContent: t.name }),
          el('small', { textContent: `${info.stake} ${t.stake}${t.playing ? ' • Oyun sürüyor' : ''}` }),
          seats),
        el('span', { className: 'lobby-go', textContent: t.players >= t.max ? 'İzle' : 'Otur' }));
      card.addEventListener('click', () => openTable(game, t.id, root));
      return card;
    });
    root.replaceChildren(el('div', { className: 'lobby' },
      el('div', { className: 'lobby-head' },
        el('div', {}, el('h3', { textContent: info.title }), el('p', { textContent: info.sub })),
        el('div', { className: 'lobby-new' }, ...(select ? [select] : []), create)),
      el('div', { className: 'lobby-list' }, ...cards)));
    lobbyTimer = setTimeout(() => { if (current?.root === root && !current.table && root.isConnected && !root.closest('[hidden]')) showLobby(game, root); }, 5000);
  }

  function openTable(game, id, root) {
    clearTimeout(lobbyTimer);
    current = { game, root, table: id };
    root.replaceChildren(el('p', { className: 'room-empty', textContent: 'Masaya bağlanılıyor...' }));
    const draw = { poker: drawPoker, blackjack: drawBlackjackTable, zar: drawDice, satranc: boards.drawChess, okey: boards.drawOkey, labirent: boards.drawLabirent }[game];
    const solo = id.startsWith('solo-');
    watch(id, (room, data) => {
      // Solo masada artık oturmuyorsan (süre doldu, kalktın) masa yerine tanıtım ekranı gösterilir
      if (solo && room.mySeat < 0) {
        if (data.balance !== undefined) setBalance(data.balance);
        return soloIntro(game, root);
      }
      draw(room, data, root);
    }, () => {
      if (solo) return soloIntro(game, root);
      say('Masa kapandı.');
      showLobby(game, root);
    });
  }

  function roomHead(room, data, root, extra = []) {
    const seated = room.mySeat >= 0;
    const solo = room.id.startsWith('solo-');
    const back = btn('‹ Masalar', () => {
      if (seated) return say('Önce masadan kalk.', 'lose');
      showLobby(current.game, root);
    }, 'ghost');
    const leave = btn(solo ? 'Oyundan Çık' : 'Masadan Kalk', () => act(room.id, 'leave'), 'ghost danger');
    const bots = room.seats.filter((s) => s && isBot(s.id)).length;
    // Solo masada botlar kendiliğinden oturur; botları kaldırmak yalnızca online masada
    const tools = seated ? [
      ...(room.seats.some((s) => !s) ? [btn('+ Bot', () => act(room.id, 'bot'), 'ghost bot-add')] : []),
      ...(bots && !solo ? [btn('Botları Kaldır', () => act(room.id, 'kickbots'), 'ghost')] : []),
    ] : [];
    return el('div', { className: 'room-head' }, seated ? leave : back, el('strong', { textContent: room.name }), ...tools, ...extra);
  }

  const SPOTS = 6;
  /** Benim koltuğum hep altta ortada */
  const spot = (seat, mySeat) => (seat - (mySeat >= 0 ? mySeat : 0) + SPOTS) % SPOTS;

  // ── Poker ──
  let raiseTo = 0;
  let raiseTurn = '';
  let lastPokerTurn = '';
  let lastBoard = 0;

  function drawPoker(room, data, root) {
    setBalance(data.balance);
    if (room.id.startsWith('solo-') && room.mySeat < 0) return soloIntro('poker', root);
    const seated = room.mySeat >= 0;
    const table = el('div', { className: 'ptable' });
    const felt = el('div', { className: 'pfelt' },
      el('div', { className: 'felt-mark' }, el('img', { src: 'logo.png', alt: '' }), el('span', { textContent: 'KARIA' })),
      el('div', { className: 'pboard' }, ...room.board.map((c, i) => card(c, `${room.id}-b${i}`)), ...Array.from({ length: 5 - room.board.length }, () => el('div', { className: 'card slot' }))),
      el('div', { className: 'ppot' }, el('img', { src: 'emojis/coin.png', alt: '' }), el('span', { textContent: room.pot ? `Pot ${fmt(room.pot)}` : `Kör ${fmt(room.sb)}/${fmt(room.bb)}` })),
      el('div', { className: 'pstatus' }, pokerStatus(room)));
    table.append(felt);
    if (room.board.length > lastBoard) sfx.card(room.board.length - lastBoard);
    lastBoard = room.board.length;

    room.seats.forEach((s, i) => {
      const pos = spot(i, room.mySeat);
      if (!s) {
        if (seated) return table.append(el('div', { className: `pseat empty s${pos}` }));
        const sit = btn('Otur', () => drawBuyIn(room, i, root), 'sit');
        return table.append(el('div', { className: `pseat empty s${pos}` }, sit));
      }
      const turn = room.turn === i && room.phase !== 'showdown';
      const won = room.result?.winners.find((w) => w.seat === i);
      const ring = avatar(s.id, turn ? 'timer' : '');
      if (turn) {
        ring.dataset.deadline = String(room.deadline);
        ring.dataset.total = String(room.turnMs);
      }
      const tag = won ? `+${fmt(won.amount)}${won.hand ? ` • ${won.hand}` : ''}` : s.hand ?? (s.folded ? 'Çekildi' : s.allIn ? 'Hepsi' : s.sittingOut ? 'Ara verdi' : '');
      const node = el('div', { className: `pseat s${pos}${turn ? ' turn' : ''}${s.folded ? ' folded' : ''}${s.id === myId() ? ' me' : ''}${won ? ' winner' : ''}` },
        ring,
        el('div', { className: 'seat-plate' }, el('strong', { textContent: s.name }), el('span', { textContent: fmt(s.stack) })),
        ...(tag ? [el('em', { className: `seat-tag${won ? ' win' : ''}`, textContent: tag })] : []),
        el('div', { className: 'seat-cards' }, ...s.cards.map((c, k) => card(c, `${room.id}-s${i}-${k}`))),
        ...(s.bet ? [el('div', { className: 'seat-bet' }, el('img', { src: 'emojis/coin.png', alt: '' }), el('span', { textContent: short(s.bet) }))] : []),
        ...(room.button === i && room.phase !== 'waiting' ? [el('b', { className: 'dealer-btn', textContent: 'D' })] : []));
      table.append(node);
    });

    const myTurnKey = room.controls ? `${room.id}-${room.turn}-${room.deadline}` : '';
    if (myTurnKey && myTurnKey !== lastPokerTurn) sfx.chip();
    lastPokerTurn = myTurnKey;
    if (room.result && room.result.winners.some((w) => room.seats[w.seat]?.id === myId()) && !root.dataset.cheered) {
      root.dataset.cheered = '1';
      sfx.win();
      const mine = room.result.winners.find((w) => room.seats[w.seat]?.id === myId());
      say(`Potu aldın! +${fmt(mine.amount)}${mine.hand ? ` • ${mine.hand}` : ''}`, 'win');
    }
    if (!room.result) delete root.dataset.cheered;

    const controls = el('div', { className: 'pcontrols' });
    if (!seated) controls.append(el('p', { className: 'hint', textContent: room.seats.some((s) => !s) ? 'Boş bir koltuğa tıklayıp otur.' : 'Masa dolu, izliyorsun.' }));
    else if (room.controls) controls.append(...pokerControls(room));
    else {
      controls.append(el('p', { className: 'hint', textContent: room.myHand ? `Elin: ${room.myHand}` : room.phase === 'waiting' ? 'Oyuncu bekleniyor...' : 'Sıranı bekle.' }));
      controls.append(room.sittingOut ? btn('Oyuna Dön', () => act(room.id, 'back'), 'primary') : btn('Ara Ver', () => act(room.id, 'sitout'), 'ghost'));
    }
    const buyBox = root.querySelector('.buyin');
    root.replaceChildren(roomHead(room, data, root, [el('span', { className: 'room-stake', textContent: `Kör ${fmt(room.sb)}/${fmt(room.bb)}` })]), table, controls, ...(buyBox && !seated ? [buyBox] : []), roomLog(room.log), pastBox('poker', room.past));
  }

  function pokerStatus(room) {
    if (room.phase === 'waiting') return el('span', { textContent: room.seats.filter(Boolean).length < 2 ? 'En az 2 oyuncu gerekli' : 'Oyuncular hazırlanıyor' });
    if (room.phase === 'starting') return countdown('Yeni el {s} sn sonra', room.startsAt);
    if (room.result) return el('span', { textContent: room.result.winners.map((w) => `${w.name} kazandı${w.hand ? ` (${w.hand})` : ''}`).join(' • ') });
    const name = room.seats[room.turn]?.name;
    return el('span', { textContent: name ? `Sıra: ${name}` : '' });
  }

  function pokerControls(room) {
    const c = room.controls;
    const key = `${room.id}-${room.turn}-${room.deadline}`;
    if (raiseTurn !== key) {
      raiseTurn = key;
      raiseTo = c.minTo;
    }
    raiseTo = Math.min(Math.max(raiseTo, c.minTo), c.maxTo);
    const out = [];
    const timer = el('div', { className: 'turn-bar' });
    timer.dataset.deadline = String(room.deadline);
    timer.dataset.total = String(room.turnMs);
    out.push(timer, btn('Pas', () => act(room.id, 'fold'), 'pk fold'));
    out.push(c.canCheck ? btn('Kontrol', () => act(room.id, 'check'), 'pk check') : btn(`Gör ${fmt(c.toCall)}`, () => act(room.id, 'call'), 'pk call'));
    if (c.canRaise && c.maxTo > c.currentBet) {
      const range = el('input', { type: 'range', min: String(c.minTo), max: String(c.maxTo), step: String(room.sb), value: String(raiseTo) });
      const label = el('b', { textContent: fmt(raiseTo) });
      const raise = btn(`${c.currentBet ? 'Yükselt' : 'Bahis'}`, () => act(room.id, raiseTo >= c.maxTo ? 'allin' : 'raise', { amount: raiseTo }), 'pk raise');
      range.addEventListener('input', () => {
        raiseTo = Number(range.value);
        label.textContent = fmt(raiseTo);
      });
      const preset = (text, value) => btn(text, () => {
        raiseTo = Math.min(Math.max(Math.floor(value), c.minTo), c.maxTo);
        range.value = String(raiseTo);
        label.textContent = fmt(raiseTo);
      }, 'mini');
      out.push(el('div', { className: 'raise-box' },
        el('div', { className: 'raise-presets' }, preset('Min', c.minTo), preset('½ Pot', c.currentBet + c.pot / 2), preset('Pot', c.currentBet + c.pot), label),
        range), raise);
    }
    out.push(btn('Hepsi', () => act(room.id, 'allin'), 'pk allin'));
    return out;
  }

  function drawBuyIn(room, seat, root) {
    root.querySelector('.buyin')?.remove();
    const value = Math.min(room.maxBuy, Math.max(room.minBuy, Math.min(room.minBuy * 5, ctx.balance())));
    const input = el('input', { inputmode: 'numeric', value: String(value) });
    const box = el('div', { className: 'buyin' },
      el('span', { textContent: `Masaya kaç coinle oturacaksın? (${fmt(room.minBuy)} - ${fmt(room.maxBuy)})` }),
      input,
      btn('Otur', () => act(room.id, 'join', { seat, buyIn: Math.floor(Number(input.value.replace(/\D/g, '')) || 0) }), 'primary'),
      btn('Vazgeç', () => box.remove(), 'ghost'));
    root.append(box);
    input.focus();
  }

  function roomLog(lines = []) {
    return el('div', { className: 'room-log' }, ...lines.slice(-3).map((t) => el('span', { textContent: t })));
  }

  // ── Blackjack masası ──
  let lastBjPhase = '';
  function drawBlackjackTable(room, data, root) {
    setBalance(data.balance);
    const seated = room.mySeat >= 0;
    const me = seated ? room.seats[room.mySeat] : null;
    const table = el('div', { className: 'bjtable' });
    table.append(el('div', { className: 'bj-dealer' },
      el('h3', {}, 'Krupiye ', ...(room.dealerTotal != null ? [el('span', { className: 'total', textContent: String(room.dealerTotal) })] : [])),
      el('div', { className: 'cards' }, ...room.dealer.map((c, i) => card(c, `${room.id}-d${i}`)))));
    table.append(el('div', { className: 'bj-arc' },
      el('div', { className: 'felt-mark' }, el('img', { src: 'logo.png', alt: '' }), el('span', { textContent: 'KARIA BLACKJACK' })),
      el('small', { textContent: '3:2 ÖDER • KRUPİYE 17\'DE DURUR' })));
    const OUT = { blackjack: 'Blackjack!', win: 'Kazandı', push: 'Berabere', lose: 'Kaybetti', bust: 'Battı' };
    const row = el('div', { className: 'bj-seats' });
    room.seats.forEach((s, i) => {
      const pos = spot(i, room.mySeat);
      if (!s) {
        row.append(el('div', { className: `bseat empty b${pos}` }, ...(seated ? [] : [btn('Otur', () => act(room.id, 'join', { seat: i }), 'sit')])));
        return;
      }
      const turn = room.turn === i;
      const ring = avatar(s.id, turn ? 'timer' : '');
      if (turn) {
        ring.dataset.deadline = String(room.deadline);
        ring.dataset.total = String(room.turnMs);
      }
      row.append(el('div', { className: `bseat b${pos}${turn ? ' turn' : ''}${s.id === myId() ? ' me' : ''}${s.outcome ? ` o-${s.outcome}` : ''}` },
        el('div', { className: 'seat-cards' }, ...s.cards.map((c, k) => card(c, `${room.id}-s${i}-${k}`))),
        ...(s.total != null ? [el('span', { className: 'total', textContent: String(s.total) })] : []),
        ...(s.bet ? [el('div', { className: 'seat-bet' }, el('img', { src: 'emojis/coin.png', alt: '' }), el('span', { textContent: short(s.bet) }))] : []),
        ring,
        el('div', { className: 'seat-plate' }, el('strong', { textContent: s.name })),
        ...(s.outcome ? [el('em', { className: `seat-tag${s.payout > s.bet ? ' win' : ''}`, textContent: `${OUT[s.outcome]}${s.payout > s.bet ? ` +${fmt(s.payout - s.bet)}` : ''}` })] : [])));
    });
    table.append(row);

    if (room.phase === 'result' && lastBjPhase !== 'result' && me?.outcome) {
      sfx.result(me.payout - me.bet, me.bet);
      say(`${OUT[me.outcome]} ${me.payout - me.bet > 0 ? `+${fmt(me.payout - me.bet)}` : me.payout - me.bet < 0 ? fmt(me.payout - me.bet) : ''}`, me.payout > me.bet ? 'win' : me.payout < me.bet ? 'lose' : 'info');
    }
    if (room.phase === 'playing' && lastBjPhase !== 'playing') sfx.card(3);
    lastBjPhase = room.phase;

    const controls = el('div', { className: 'pcontrols' });
    if (!seated) controls.append(el('p', { className: 'hint', textContent: 'Boş bir koltuğa tıklayıp otur.' }));
    else if (room.controls) {
      const timer = el('div', { className: 'turn-bar' });
      timer.dataset.deadline = String(room.deadline);
      timer.dataset.total = String(room.turnMs);
      controls.append(timer,
        btn('Kart Çek', () => act(room.id, 'hit'), 'pk call'),
        btn('Dur', () => act(room.id, 'stand'), 'pk check'),
        ...(room.controls.canDouble ? [btn('İkiye Katla', () => act(room.id, 'double'), 'pk raise')] : []));
    } else if (room.phase === 'betting' && !me.bet) {
      controls.append(btn(`Bahis Koy • ${fmt(betValue())}`, () => act(room.id, 'bet', { bet: betValue() }), 'primary big'));
      if (room.endsAt) controls.append(el('p', { className: 'hint' }, countdown('Kartlar {s} sn sonra dağıtılıyor', room.endsAt)));
      else controls.append(el('p', { className: 'hint', textContent: 'Bahis tutarını sağdaki kutudan seç.' }));
    } else if (room.phase === 'betting') controls.append(el('p', { className: 'hint' }, room.endsAt ? countdown('Bahsin hazır • Kartlar {s} sn sonra', room.endsAt) : 'Bahsin hazır'));
    else controls.append(el('p', { className: 'hint', textContent: room.phase === 'result' ? 'Yeni el birazdan başlıyor.' : `Sıra: ${room.seats[room.turn]?.name ?? 'krupiye'}` }));
    root.replaceChildren(roomHead(room, data, root, [el('span', { className: 'room-stake', textContent: `Bahis ${fmt(room.minBet)} - ${fmt(room.maxBet)}` })]), table, controls, roomLog(room.log), pastBox('blackjack', room.past));
  }

  // ── Zar düellosu ──
  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const die = (n, rolling = false) => el('div', { className: `die${rolling ? ' rolling' : ''}` }, ...Array.from({ length: 9 }, (_, i) => el('i', { className: PIPS[n]?.includes(i + 1) ? 'on' : '' })));
  let diceAnim = 0;
  let diceShown = '';
  let diceRunning = false;
  let dieBoxes = new Map(); // son çizimdeki zar kutuları; animasyon yeniden çizimde de doğru kutuya yazar

  function drawDice(room, data, root) {
    if (room.id.startsWith('solo-') && room.mySeat < 0) return soloIntro('zar', root);
    const seated = room.mySeat >= 0;
    const table = el('div', { className: 'ztable' });
    const center = el('div', { className: 'zcenter' },
      el('div', { className: 'felt-mark' }, el('img', { src: 'logo.png', alt: '' }), el('span', { textContent: 'KARIA' })),
      el('div', { className: 'ppot' }, el('img', { src: 'emojis/coin.png', alt: '' }), el('span', { textContent: `Pot ${fmt(room.pot)}` })),
      el('div', { className: 'pstatus' }, room.phase === 'waiting' ? (room.endsAt ? countdown('Zarlar {s} sn sonra atılıyor', room.endsAt) : el('span', { textContent: room.id.startsWith('solo-') ? 'Hazırım’a basınca botlarla zarlar atılır' : 'Hazır olanlar en az 2 kişi olunca başlar' })) : el('span', { textContent: room.winner ? `${room.winner.names.join(', ')} kazandı! +${fmt(room.winner.amount)}` : 'Zarlar atılıyor...' })));
    table.append(center);
    dieBoxes = new Map();
    room.seats.forEach((s, i) => {
      const pos = spot(i, room.mySeat);
      if (!s) {
        table.append(el('div', { className: `pseat empty s${pos}` }, ...(seated ? [] : [btn('Otur', () => act(room.id, 'join', { seat: i }), 'sit')])));
        return;
      }
      const dice = el('div', { className: 'seat-dice' });
      dieBoxes.set(s.id, dice);
      const won = room.winner?.ids.includes(s.id);
      table.append(el('div', { className: `pseat s${pos}${s.id === myId() ? ' me' : ''}${won ? ' winner' : ''}` },
        avatar(s.id, s.ready ? 'ready' : ''),
        el('div', { className: 'seat-plate' }, el('strong', { textContent: s.name }), el('span', { textContent: s.ready ? 'Hazır' : room.phase === 'waiting' ? 'Bekliyor' : '' })),
        dice));
    });

    const controls = el('div', { className: 'pcontrols' });
    if (!seated) controls.append(el('p', { className: 'hint', textContent: `Giriş ${fmt(room.ante)} coin. Boş bir koltuğa tıklayıp otur.` }));
    else if (room.phase === 'waiting') controls.append(room.ready ? btn('Vazgeç', () => act(room.id, 'unready'), 'ghost') : btn(`Hazırım • ${fmt(room.ante)}`, () => act(room.id, 'ready'), 'primary big'));
    else controls.append(el('p', { className: 'hint', textContent: 'Zarlar atılıyor...' }));
    root.replaceChildren(roomHead(room, data, root, [el('span', { className: 'room-stake', textContent: `Giriş ${fmt(room.ante)}` })]), table, controls, roomLog(room.log), pastBox('zar', room.past));
    setBalance(data.balance);
    if (room.phase === 'result' && room.winner && root.dataset.diceWin !== JSON.stringify(room.winner)) {
      root.dataset.diceWin = JSON.stringify(room.winner);
      const played = room.players.some((p) => p.id === myId());
      if (played) {
        const won = room.winner.ids.includes(myId());
        sfx.result(won ? 1 : -1);
        say(won ? `Potu aldın! +${fmt(room.winner.amount - room.ante)}` : `${room.winner.names.join(', ')} kazandı. ${fmt(-room.ante)}`, won ? 'win' : 'lose');
      }
    }

    // Atış: her tur için zarlar döner, sonra durur; berabere kalanlar yeniden atar
    const key = JSON.stringify(room.rounds);
    if (room.rounds.length) {
      const final = () => room.rounds.forEach((r) => { for (const [id, d] of Object.entries(r)) dieBoxes.get(id)?.replaceChildren(die(d[0]), die(d[1])); });
      if (diceShown === key) {
        if (!diceRunning) final();
        return;
      }
      diceShown = key;
      const anim = ++diceAnim;
      diceRunning = true;
      (async () => {
        for (const r of room.rounds) {
          const ids = Object.keys(r);
          for (const [id, box] of dieBoxes) box.classList.toggle('out', !ids.includes(id));
          sfx.coinFlip();
          for (let t = 0; t < 14; t++) {
            if (anim !== diceAnim) return;
            for (const id of ids) dieBoxes.get(id)?.replaceChildren(die(1 + Math.floor(Math.random() * 6), true), die(1 + Math.floor(Math.random() * 6), true));
            await sleep(90);
          }
          for (const id of ids) dieBoxes.get(id)?.replaceChildren(die(r[id][0]), die(r[id][1]));
          sfx.reelStop();
          await sleep(Math.max(300, room.rollMs - 1300));
        }
        if (anim === diceAnim) diceRunning = false;
      })();
    } else diceShown = '';
  }

  // ── Süper Tayyare ──
  const tay = { room: null, frame: 0, canvas: null, lastPhase: '', trail: [] };

  function tayMult(room) {
    if (room.phase === 'crashed') return room.crashAt;
    if (room.phase !== 'flying') return 1;
    return Math.max(1, Math.floor(Math.exp(room.k * Math.max(0, now() - room.startAt)) * 100) / 100);
  }

  function drawTayyare(room, data) {
    const prev = tay.room;
    tay.room = room;
    const mine = room.me;
    // Kazanç uçuş bitince ya da çekince görünür
    setBalance(data.balance);
    if (room.phase !== tay.lastPhase) {
      if (room.phase === 'flying') sfx.wheel(1);
      if (room.phase === 'crashed') {
        sfx.lose();
        if (mine) say(mine.cashedAt ? `${mine.cashedAt.toFixed(2).replace('.', ',')}× ile çektin! +${fmt(mine.win - mine.bet)}` : `Tayyare ${room.crashAt.toFixed(2).replace('.', ',')}× ile düştü. ${fmt(-mine.bet)}`, mine.cashedAt ? 'win' : 'lose');
      }
      if (room.phase === 'betting') tay.trail = [];
      tay.lastPhase = room.phase;
    }
    if (mine?.cashedAt && !prev?.me?.cashedAt) sfx.coins();

    $('tay-history').replaceChildren(...room.history.map((x) => el('span', { className: x >= 10 ? 'hot' : x >= 2 ? 'good' : '', textContent: `${x.toFixed(2).replace('.', ',')}×` })));
    $('tay-bets').replaceChildren(
      el('h4', { textContent: `Bu uçuş • ${room.bets.length} oyuncu` }),
      ...(room.bets.length ? room.bets.map((b) => el('div', { className: `tay-bet${b.cashedAt ? ' won' : room.phase === 'crashed' ? ' lost' : ''}${b.id === myId() ? ' me' : ''}` },
        avatarImg(b.id, ''),
        el('span', { textContent: b.name }),
        el('b', { textContent: fmt(b.bet) }),
        el('em', { textContent: b.cashedAt ? `${b.cashedAt.toFixed(2).replace('.', ',')}× • +${fmt(b.win)}` : room.phase === 'crashed' ? 'Düştü' : '' }))) : [el('p', { className: 'hint', textContent: 'Henüz bahis yok.' })]));
    drawTayButton();
    if (!tay.frame) tay.frame = requestAnimationFrame(tayLoop);
  }

  function drawTayButton() {
    const room = tay.room;
    const b = $('tay-btn');
    const mine = room?.me;
    b.className = 'tay-btn';
    b.disabled = false;
    if (!room) return;
    if (room.phase === 'betting' || room.phase === 'idle') {
      if (mine) {
        b.textContent = `Geri Al • ${fmt(mine.bet)}`;
        b.classList.add('cancel');
        b.dataset.do = 'cancel';
      } else {
        b.textContent = `Bahis Koy • ${fmt(betValue())}`;
        b.dataset.do = 'bet';
      }
    } else if (room.phase === 'flying' && mine && !mine.cashedAt) {
      b.textContent = `ÇEK • ${fmt(Math.floor(mine.bet * tayMult(room)))}`;
      b.classList.add('cash');
      b.dataset.do = 'cashout';
    } else {
      b.textContent = mine?.cashedAt ? `Çektin • +${fmt(mine.win - mine.bet)}` : 'Sonraki uçuşu bekle';
      b.disabled = true;
      b.dataset.do = '';
    }
  }

  $('tay-btn').addEventListener('click', () => {
    const what = $('tay-btn').dataset.do;
    if (!what) return;
    const id = tay.room?.id ?? 'tayyare';
    if (what === 'bet') act(id, 'bet', { bet: betValue(), auto: $('tay-auto').value.trim() || null });
    else act(id, what);
  });

  function tayLoop() {
    tay.frame = 0;
    const panel = document.querySelector('[data-panel="tayyare"]');
    if (!tay.room || panel.hidden) return;
    const room = tay.room;
    const canvas = $('tay-canvas');
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const m = tayMult(room);
    const multEl = $('tay-mult');
    const status = $('tay-status');
    multEl.className = `tay-mult ${room.phase}`;
    if (room.phase === 'betting' || room.phase === 'idle') {
      multEl.textContent = '';
      const left = Math.max(0, (room.endsAt ?? 0) - now());
      status.replaceChildren(el('strong', { textContent: 'Kalkışa hazırlanıyor' }), el('span', { textContent: `${(left / 1000).toFixed(1).replace('.', ',')} sn` }), el('i', { style: `--p:${Math.min(1, left / (room.betMs || 8000))}` }));
    } else {
      multEl.textContent = `${m.toFixed(2).replace('.', ',')}×`;
      status.replaceChildren(...(room.phase === 'crashed' ? [el('strong', { textContent: 'TAYYARE DÜŞTÜ!' })] : []));
    }

    // Eğri: zaman sağa, çarpan yukarı. Ölçek uçuş uzadıkça genişler.
    const pad = 34;
    const elapsed = room.phase === 'flying' ? Math.max(0, now() - room.startAt) : room.phase === 'crashed' ? Math.log(room.crashAt) / room.k : 0;
    const spanT = Math.max(9000, elapsed * 1.15);
    const spanM = Math.max(2, m * 1.25);
    const X = (t) => pad + (t / spanT) * (w - pad * 2);
    const Y = (mult) => h - pad - ((mult - 1) / (spanM - 1)) * (h - pad * 2);
    g.strokeStyle = 'rgba(191,247,236,.12)';
    g.lineWidth = 1;
    g.font = '11px system-ui';
    g.fillStyle = 'rgba(191,247,236,.45)';
    for (let i = 1; i <= 4; i++) {
      const mult = 1 + ((spanM - 1) * i) / 4;
      g.beginPath();
      g.moveTo(pad, Y(mult));
      g.lineTo(w - pad, Y(mult));
      g.stroke();
      g.fillText(`${mult.toFixed(1)}×`, 4, Y(mult) + 4);
    }
    if (room.phase === 'flying' || room.phase === 'crashed') {
      const grad = g.createLinearGradient(0, h, w, 0);
      grad.addColorStop(0, '#2f9e87');
      grad.addColorStop(1, room.phase === 'crashed' ? '#ef7a7f' : '#bff7ec');
      g.beginPath();
      g.moveTo(X(0), Y(1));
      const steps = 60;
      for (let i = 1; i <= steps; i++) {
        const t = (elapsed * i) / steps;
        g.lineTo(X(t), Y(Math.exp(room.k * t)));
      }
      const endX = X(elapsed);
      const endY = Y(Math.min(m, Math.exp(room.k * elapsed)));
      g.lineTo(endX, h - pad);
      g.lineTo(X(0), h - pad);
      g.closePath();
      const fill = g.createLinearGradient(0, 0, 0, h);
      fill.addColorStop(0, room.phase === 'crashed' ? 'rgba(239,122,127,.28)' : 'rgba(79,207,180,.32)');
      fill.addColorStop(1, 'rgba(79,207,180,0)');
      g.fillStyle = fill;
      g.fill();
      g.beginPath();
      g.moveTo(X(0), Y(1));
      for (let i = 1; i <= steps; i++) {
        const t = (elapsed * i) / steps;
        g.lineTo(X(t), Y(Math.exp(room.k * t)));
      }
      g.strokeStyle = grad;
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.stroke();
      // Tayyare eğrinin ucunda, eğim yönünde
      const dt = Math.max(1, elapsed * 0.04);
      const angle = Math.atan2(endY - Y(Math.exp(room.k * Math.max(0, elapsed - dt))), endX - X(Math.max(0, elapsed - dt)));
      plane(g, endX, endY, room.phase === 'crashed' ? angle + 0.9 : angle, room.phase === 'crashed');
    } else {
      plane(g, X(0) + 14, Y(1) - 8, -0.1, false);
    }
    if (room.phase === 'flying') drawTayButton();
    tay.frame = requestAnimationFrame(tayLoop);
  }

  function plane(g, x, y, angle, broken) {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.shadowColor = broken ? 'rgba(239,122,127,.8)' : 'rgba(127,240,218,.8)';
    g.shadowBlur = 16;
    g.fillStyle = broken ? '#ef7a7f' : '#4fcfb4';
    // gövde
    g.beginPath();
    g.moveTo(22, 0);
    g.quadraticCurveTo(14, -6, -14, -4);
    g.lineTo(-20, -11);
    g.lineTo(-24, -11);
    g.lineTo(-20, 0);
    g.lineTo(-24, 6);
    g.lineTo(-14, 5);
    g.quadraticCurveTo(14, 6, 22, 0);
    g.fill();
    // kanat
    g.fillStyle = broken ? '#c8323f' : '#bff7ec';
    g.beginPath();
    g.moveTo(6, 1);
    g.lineTo(-6, 16);
    g.lineTo(-11, 16);
    g.lineTo(-4, 1);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(4, -2);
    g.lineTo(-4, -12);
    g.lineTo(-8, -12);
    g.lineTo(-3, -2);
    g.closePath();
    g.fill();
    // pervane
    g.fillStyle = '#ffd479';
    g.fillRect(21, -6, 2.5, 12);
    g.restore();
  }

  // ── Ortak rulet ──
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const numColor = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
  const COLOR_TR = { green: 'yeşil', red: 'kırmızı', black: 'siyah' };
  const rl = { room: null, pending: new Map(), order: [], last: null, wheelDeg: 0, spunAt: 0, settledAt: 0 };

  function buildWheel() {
    const slice = 360 / WHEEL.length;
    const colors = { green: '#1f9a6a', red: '#b3262f', black: '#121619' };
    const wheel = $('wheel');
    wheel.style.background = `conic-gradient(${WHEEL.map((n, i) => `${colors[numColor(n)]} ${(i * slice).toFixed(3)}deg ${((i + 1) * slice).toFixed(3)}deg`).join(',')})`;
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

  const pendingTotal = () => [...rl.pending.values()].reduce((a, b) => a + b, 0);
  const locked = () => ['spinning', 'result'].includes(rl.room?.phase);

  function renderRouletteBets() {
    const mine = rl.room?.mine ?? {};
    const others = rl.room?.table ?? {};
    for (const b of $('roulette-board').children) {
      const key = b.dataset.key;
      const amount = (rl.pending.get(key) ?? 0) + (mine[key] ?? 0);
      if (amount) b.dataset.bet = short(amount);
      else delete b.dataset.bet;
      b.classList.toggle('placed', Boolean(mine[key]));
      b.classList.toggle('others', (others[key] ?? 0) > (mine[key] ?? 0));
      b.classList.toggle('hit', rl.room?.phase === 'result' && rl.room.result && winsOn(key, rl.room.result.result));
    }
    const pend = pendingTotal();
    const placed = rl.room?.myTotal ?? 0;
    $('roulette-total').textContent = pend || placed ? `${placed ? `Masada ${fmt(placed)}` : ''}${pend && placed ? ' • ' : ''}${pend ? `Yeni ${fmt(pend)}` : ''}` : 'Masa boş';
    $('roulette-spin').disabled = locked() || !pend;
    $('roulette-undo').disabled = locked() || !rl.order.length;
    $('roulette-clear').disabled = locked() || !rl.pending.size;
    $('roulette-repeat').disabled = locked() || !rl.last;
  }

  function winsOn(key, n) {
    if (key[0] === 'n') return Number(key.slice(1)) === n;
    if (n === 0) return false;
    return { red: REDS.has(n), black: !REDS.has(n), even: n % 2 === 0, odd: n % 2 === 1, low: n <= 18, high: n >= 19, d1: n <= 12, d2: n > 12 && n <= 24, d3: n > 24, c1: n % 3 === 1, c2: n % 3 === 2, c3: n % 3 === 0 }[key] ?? false;
  }

  function placeRouletteBet(key) {
    if (locked()) throw new Error('Çark dönüyor, bir sonraki tura bahis koy.');
    const amount = betValue();
    const { minBet, maxBet } = limits();
    if (amount < minBet) throw new Error(`Her bahis en az ${fmt(minBet)} coin olmalı.`);
    const total = pendingTotal() + (rl.room?.myTotal ?? 0) + amount;
    if (total > maxBet) throw new Error(`Bir turda toplam bahis en fazla ${fmt(maxBet)} coin olabilir.`);
    if (pendingTotal() + amount > ctx.balance()) throw new Error('Bakiyen yetmiyor.');
    rl.pending.set(key, (rl.pending.get(key) ?? 0) + amount);
    rl.order.push([key, amount]);
    renderRouletteBets();
    sfx.chip();
  }

  function removeRouletteBet(key) {
    if (!rl.pending.has(key)) return;
    rl.pending.delete(key);
    for (let i = rl.order.length - 1; i >= 0; i--) if (rl.order[i][0] === key) rl.order.splice(i, 1);
    renderRouletteBets();
  }

  $('roulette-board').addEventListener('click', (event) => {
    const cell = event.target.closest('.rc');
    if (!cell) return;
    try { placeRouletteBet(cell.dataset.key); } catch (error) { say(error.message, 'lose'); }
  });
  $('roulette-board').addEventListener('contextmenu', (event) => {
    const cell = event.target.closest('.rc');
    if (!cell) return;
    event.preventDefault();
    removeRouletteBet(cell.dataset.key);
  });
  $('roulette-undo').addEventListener('click', () => {
    const last = rl.order.pop();
    if (!last) return;
    const [key, amount] = last;
    const left = (rl.pending.get(key) ?? 0) - amount;
    if (left > 0) rl.pending.set(key, left);
    else rl.pending.delete(key);
    renderRouletteBets();
  });
  $('roulette-clear').addEventListener('click', () => {
    rl.pending.clear();
    rl.order.length = 0;
    renderRouletteBets();
  });
  $('roulette-repeat').addEventListener('click', () => {
    if (!rl.last || locked()) return;
    rl.pending = new Map(rl.last);
    rl.order = [...rl.last];
    renderRouletteBets();
    sfx.chip();
  });
  $('roulette-spin').addEventListener('click', () => guarded(async () => {
    if (!rl.pending.size) throw new Error('Önce masaya bahis koy.');
    const bets = Object.fromEntries(rl.pending);
    await send(rl.room?.id ?? 'rulet', 'bet', { bets });
    rl.last = new Map(rl.pending);
    rl.pending.clear();
    rl.order.length = 0;
    renderRouletteBets();
  }));

  function drawRoulette(room, data) {
    const prev = rl.room;
    rl.room = room;
    const status = $('roulette-status');
    if (room.phase === 'open') status.replaceChildren(el('span', { textContent: room.id.startsWith('solo-') ? 'Solo: bahsini koy ve Çevir’e bas.' : 'Online: bahsini koy ve Çevir’e bas. Odada başkaları varsa çark herkes için birlikte döner.' }));
    else if (room.phase === 'betting') status.replaceChildren(countdown(`Çark {s} sn sonra dönüyor • ${room.players.length} oyuncu`, room.endsAt));
    else if (room.phase === 'spinning') status.replaceChildren(el('span', { textContent: 'Çark dönüyor...' }));
    else if (room.result) status.replaceChildren(el('span', { textContent: `${room.result.result} ${COLOR_TR[room.result.color]} geldi.` }));

    $('roulette-players').replaceChildren(...room.players.map((p) => el('span', { className: `rp${p.id === myId() ? ' me' : ''}${p.payout ? ' won' : p.payout === 0 ? ' lost' : ''}` },
      avatarImg(p.id, ''), el('b', { textContent: p.name }), el('em', { textContent: p.payout != null ? (p.payout ? `+${fmt(p.payout)}` : fmt(-p.total)) : fmt(p.total) }))));
    $('roulette-history').replaceChildren(...room.history.map((h) => el('span', { className: `rh ${h.color}`, textContent: String(h.result) })));

    if ((room.phase === 'spinning' || room.phase === 'result') && room.spinAt && rl.spunAt !== room.spinAt) {
      rl.spunAt = room.spinAt;
      spinWheel(room, data);
    } else if (room.phase !== 'spinning') {
      if (!(prev?.phase === 'spinning' && room.phase === 'result' && rl.spinning)) setBalance(data.balance);
      if (room.phase === 'result' && !rl.spinning) showRouletteResult(room);
      if (room.phase === 'open') {
        $('roulette-result').textContent = '';
        $('roulette-result').className = 'roulette-result';
      }
    }
    renderRouletteBets();
  }

  async function spinWheel(room, data) {
    rl.spinning = true;
    const left = Math.max(800, room.spinMs - (now() - room.spinAt) - 200);
    const slice = 360 / WHEEL.length;
    const target = 360 - (WHEEL.indexOf(room.result.result) + 0.5) * slice;
    const base = Math.ceil(rl.wheelDeg / 360) * 360;
    rl.wheelDeg = base + 360 * Math.max(2, Math.round(left / 900)) + target;
    const wheel = $('wheel');
    wheel.style.transition = `transform ${left}ms cubic-bezier(.15,.6,.1,1)`;
    wheel.style.transform = `rotate(${rl.wheelDeg}deg)`;
    $('roulette-result').textContent = '';
    sfx.wheel(left / 1000);
    const spinAt = room.spinAt;
    await sleep(left + 100);
    rl.spinning = false;
    if (rl.spunAt !== spinAt) return;
    setBalance(watching?.last?.balance ?? data.balance);
    showRouletteResult(rl.room?.spinAt === spinAt ? { ...rl.room, phase: 'result' } : room);
  }

  function showRouletteResult(room) {
    if (!room.result || rl.settledAt === room.spinAt) return;
    rl.settledAt = room.spinAt;
    $('roulette-result').textContent = String(room.result.result);
    $('roulette-result').className = `roulette-result ${room.result.color}`;
    const me = room.players?.find((p) => p.id === myId());
    if (me) {
      const n = room.result.result;
      const rate = (key) => (key[0] === 'n' ? 36 : /^[dc]/.test(key) ? 3 : 2);
      const payout = Object.entries(room.mine ?? {}).reduce((sum, [key, amount]) => sum + (winsOn(key, n) ? amount * rate(key) : 0), 0);
      const net = payout - me.total;
      sfx.result(net, me.total);
      say(`${room.result.result} ${COLOR_TR[room.result.color]} geldi. ${net > 0 ? `+${fmt(net)}` : fmt(net)}`, net > 0 ? 'win' : net < 0 ? 'lose' : 'info');
    } else sfx.reelStop();
  }

  buildWheel();
  buildRouletteBoard();
  renderRouletteBets();

  // ── Sekme geçişleri ──
  const ROOTS = { poker: 'poker-root', zar: 'zar-root', satranc: 'satranc-root', okey: 'okey-root', labirent: 'labirent-root' };
  const boards = initBoards({ el, fmt, say, sfx, act, avatar, btn, roomHead, roomLog, pastBox, countdown, myId });

  // Slot salonu: sunucudaki son kazançlar
  let slotTimer = 0;
  async function slotFeed() {
    clearTimeout(slotTimer);
    if (document.querySelector('[data-panel="slot"]').hidden) return;
    try {
      const { wins } = await api('/slot/feed');
      $('slot-feed').replaceChildren(el('h5', { textContent: 'Canlı kazananlar' }), ...(wins.length ? wins.map((w) => el('span', { className: `sf${w.multiplier >= 10 ? ' big' : ''}${w.id === myId() ? ' me' : ''}` }, face(w.id), el('b', { textContent: w.name }), el('em', { textContent: `${String(w.multiplier).replace('.', ',')}× • +${fmt(w.win)}` }))) : [el('small', { textContent: 'Henüz kazanan yok, ilk sen ol!' })]));
    } catch {}
    slotTimer = setTimeout(slotFeed, 4000);
  }

  // ── Solo / Online ──
  // Solo: yalnız sana açılan oda (poker ve zarda botlarla); Online: sunucudaki herkesle aynı masa
  const DEFAULT_MODE = { blackjack: 'solo', slot: 'solo', poker: 'online', zar: 'online', roulette: 'online', tayyare: 'online', satranc: 'solo', okey: 'solo', labirent: 'solo' };
  const modeOf = (game) => {
    try {
      return localStorage.getItem(`karia-mode-${game}`) || DEFAULT_MODE[game];
    } catch {
      return DEFAULT_MODE[game];
    }
  };
  let activeGame = null;

  function placeMode(name) {
    const sw = $('mode-switch');
    const panel = document.querySelector(`[data-panel="${name}"]`);
    if (!DEFAULT_MODE[name] || !panel) {
      sw.hidden = true;
      return;
    }
    sw.hidden = false;
    if (panel.firstElementChild !== sw) panel.prepend(sw);
    for (const b of sw.querySelectorAll('[data-mode]')) b.classList.toggle('active', b.dataset.mode === modeOf(name));
  }
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.addEventListener('click', () => {
      if (!activeGame || modeOf(activeGame) === b.dataset.mode) return;
      try { localStorage.setItem(`karia-mode-${activeGame}`, b.dataset.mode); } catch {}
      sfx.chip();
      open(activeGame);
    });
  }

  const SOLO_TEXT = {
    poker: ['Solo Poker', "3 bota karşı Texas Hold'em. Kör 10/20, masaya 2.000 coin fişle oturursun; kalkınca kalan fiş cüzdana döner."],
    zar: ['Solo Zar Düellosu', '2 bota karşı zar at, en yüksek atan 300 coinlik potu alır. Giriş 100 coin.'],
    satranc: ['Solo Satranç', 'Bota karşı satranç. Giriş 100 coin: kazanırsan 200 alırsın, berabere biterse girişin döner. Masada Hazırım’a bas.'],
    okey: ['Solo Okey 101', '3 bota karşı Okey 101. Giriş 100 coin, elini ilk bitiren 400 coinlik potu alır. Masada Hazırım’a bas.'],
    labirent: ['Solo Karia Labirent', 'Bota karşı koridor yarışı: karşı kenara ilk varan kazanır, sıranda yürür ya da rakibin önüne engel koyarsın. Giriş 100 coin, kazanan 200 alır. Masada Hazırım’a bas.'],
  };

  async function soloIntro(game, root) {
    stop();
    clearTimeout(lobbyTimer);
    current = { game, root, table: null, solo: true };
    try {
      const data = await api(`/tables?game=${game}`);
      if (data.seatedAt === `solo-${game}-${myId()}`) return openTable(game, data.seatedAt, root);
    } catch {}
    if (current?.root !== root) return;
    const [title, text] = SOLO_TEXT[game];
    root.replaceChildren(el('div', { className: 'solo-intro' },
      el('img', { src: 'emojis/bot.png', alt: '' }),
      el('h3', { textContent: title }),
      el('p', { textContent: text }),
      btn('Başla', () => guarded(async () => {
        const made = await api('/tables/solo', { game });
        openTable(game, made.id, root);
      }), 'primary big')));
  }

  function open(name) {
    activeGame = DEFAULT_MODE[name] ? name : null;
    placeMode(name);
    const mode = modeOf(name);
    clearTimeout(lobbyTimer);
    clearTimeout(slotTimer);
    if (name === 'slot') {
      $('slot-feed').hidden = mode !== 'online';
      if (mode === 'online') slotFeed();
    }
    if (name === 'tayyare' || name === 'roulette') {
      current = null;
      const game = name === 'tayyare' ? 'tayyare' : 'rulet';
      const draw = name === 'tayyare' ? drawTayyare : drawRoulette;
      if (mode === 'solo') {
        stop();
        api('/tables/solo', { game }).then((r) => { if (activeGame === name && modeOf(name) === 'solo') watch(r.id, draw); }).catch((e) => say(e.message, 'lose'));
      } else watch(game, draw);
      return;
    }
    if (ROOTS[name]) return mode === 'solo' ? soloIntro(name, $(ROOTS[name])) : showLobby(name, $(ROOTS[name]));
    if (name === 'blackjack') {
      $('bj-solo').hidden = mode !== 'solo';
      $('bjm-root').hidden = mode !== 'online';
      if (mode === 'online') return showLobby('blackjack', $('bjm-root'));
    }
    current = null;
    stop();
  }

  // Bahis tutarı değişince Tayyare ve blackjack düğmesindeki tutar da yenilensin
  $('bet').addEventListener('input', () => { if (tay.room) drawTayButton(); });
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-add],[data-sub],[data-bet]')) {
      if (tay.room) drawTayButton();
      const w = watching;
      if (w?.last && w.id.startsWith('blackjack-')) w.render(w.last.room, w.last);
    }
  });

  return { open, stop };
}
