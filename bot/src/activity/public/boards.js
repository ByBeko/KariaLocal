// Sıra tabanlı masa oyunlarının çizimi: satranç, Karia Labirent, Okey 101. Kararlar sunucudadır.
export function initBoards(ctx) {
  const { el, fmt, say, sfx, act, avatar, btn, roomHead, roomLog, pastBox, countdown, myId } = ctx;

  /** Oyuncu şeridi: koltuklar, hazır olma, sıra süresi; altında hazır/otur düğmeleri */
  function players(room, extra = () => null) {
    const seated = room.mySeat >= 0;
    return el('div', { className: 'tt-players' }, ...room.seats.map((s, i) => {
      if (!s) return el('div', { className: 'tt-seat empty' }, ...(seated ? [el('small', { textContent: 'Boş' })] : [btn('Otur', () => act(room.id, 'join', { seat: i }), 'sit')]));
      const turn = room.turn === i;
      const ring = avatar(s.id, turn ? 'timer' : s.ready && room.phase === 'waiting' ? 'ready' : '');
      if (turn) {
        ring.dataset.deadline = String(room.deadline);
        ring.dataset.total = String(room.turnMs);
      }
      const won = room.result?.winners.some((w) => w.seat === i);
      return el('div', { className: `tt-seat${turn ? ' turn' : ''}${s.id === myId() ? ' me' : ''}${won ? ' winner' : ''}` },
        ring, el('div', { className: 'seat-plate' }, el('strong', { textContent: s.name }), el('span', { textContent: won ? `+${fmt(room.result.amount)}` : room.phase === 'waiting' ? (s.ready ? 'Hazır' : 'Bekliyor') : '' })),
        ...[extra(s, i)].filter(Boolean));
    }));
  }

  function waitingBar(room) {
    const bar = el('div', { className: 'pcontrols' });
    if (room.mySeat < 0) bar.append(el('p', { className: 'hint', textContent: `Giriş ${fmt(room.stake)} coin. Boş bir koltuğa otur.` }));
    else if (room.phase === 'waiting') {
      bar.append(room.ready ? btn('Vazgeç', () => act(room.id, 'unready'), 'ghost') : btn(`Hazırım • ${fmt(room.stake)}`, () => act(room.id, 'ready'), 'primary big'));
      const solo = room.id.startsWith('solo-');
      bar.append(el('p', { className: 'hint' }, room.startsAt ? countdown('Oyun {s} sn sonra başlıyor', room.startsAt) : solo ? 'Botlar hazır; Hazırım’a basınca oyun başlar.' : `Herkes hazır olunca başlar (en az ${room.game === 'okey' ? 4 : 2} kişi; boş yere + Bot ekleyebilirsin)`));
    } else if (room.phase === 'result') {
      const r = room.result;
      bar.append(el('p', { className: 'hint big-result', textContent: r.winners.length ? `${r.winners.map((w) => w.name).join(', ')} kazandı • ${r.reason}` : `Berabere • ${r.reason}` }));
    }
    return bar;
  }

  function resultSound(room, root) {
    const key = room.phase === 'result' ? JSON.stringify(room.result) : '';
    if (key && root.dataset.done !== key) {
      root.dataset.done = key;
      const mine = room.result.winners.some((w) => w.id === myId());
      const played = room.mySeat >= 0;
      if (played) {
        sfx.result(mine ? 1 : room.result.winners.length ? -1 : 0);
        say(mine ? `Kazandın! +${fmt(room.result.amount)}` : room.result.winners.length ? `${room.result.winners.map((w) => w.name).join(', ')} kazandı.` : 'Berabere, girişin geri döndü.', mine ? 'win' : room.result.winners.length ? 'lose' : 'info');
      }
    }
    if (!key) delete root.dataset.done;
  }

  const stakeTag = (room) => el('span', { className: 'room-stake', textContent: `Giriş ${fmt(room.stake)}` });
  const resign = (room) => (room.phase === 'playing' && room.mySeat >= 0 ? [btn('Pes Et', () => act(room.id, 'resign'), 'ghost danger')] : []);

  // ── Satranç ──
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  let chessPick = -1;
  let chessKey = '';
  let chessPromo = null; // { from, to }: terfi için taş seçimi bekleniyor
  const PROMOS = [['q', 'Vezir'], ['r', 'Kale'], ['b', 'Fil'], ['n', 'At']];

  function drawChess(room, data, root) {
    const flip = room.myColor === 'b';
    const legal = room.legal ?? [];
    const key = `${room.id}-${room.board.join('')}`;
    if (key !== chessKey) {
      if (chessKey && room.lastMove) sfx.card(1);
      chessKey = key;
      chessPick = -1;
      chessPromo = null;
    }
    const targets = new Set(legal.filter((m) => m[0] === chessPick).map((m) => m[1]));
    const king = room.board.indexOf(room.toMove === 'w' ? 'K' : 'k');
    const board = el('div', { className: `chess${flip ? ' flip' : ''}` });
    for (let v = 0; v < 64; v++) {
      const i = flip ? 63 - v : v;
      const pc = room.board[i];
      const light = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
      const cls = ['sq', light ? 'l' : 'd'];
      if (room.lastMove && (room.lastMove.from === i || room.lastMove.to === i)) cls.push('last');
      if (i === chessPick) cls.push('pick');
      if (targets.has(i)) cls.push(pc === '.' ? 'dot' : 'hit');
      if (room.check && i === king) cls.push('check');
      const cell = el('button', { type: 'button', className: cls.join(' ') });
      if (pc !== '.') cell.append(el('span', { className: `pc ${pc === pc.toUpperCase() ? 'w' : 'b'}`, textContent: GLYPH[pc.toLowerCase()] }));
      if (v % 8 === 0) cell.append(el('i', { className: 'rank', textContent: String(8 - Math.floor(i / 8)) }));
      if (v >= 56) cell.append(el('i', { className: 'file', textContent: 'abcdefgh'[i % 8] }));
      cell.addEventListener('click', () => {
        if (targets.has(i)) {
          // Terfi: piyon son sıraya varınca hangi taşa dönüşeceği sorulur
          if (legal.some((m) => m[0] === chessPick && m[1] === i && m[2])) {
            chessPromo = { from: chessPick, to: i };
            return drawChess(room, data, root);
          }
          act(room.id, 'move', { from: chessPick, to: i });
          chessPick = -1;
          return;
        }
        chessPick = legal.some((m) => m[0] === i) ? i : -1;
        drawChess(room, data, root);
      });
      board.append(cell);
    }
    const colorName = (seat) => ({ w: 'Beyaz', b: 'Siyah' })[room.colors?.[seat]] ?? '';
    const status = room.phase === 'playing'
      ? el('p', { className: `hint${room.myColor && room.toMove === room.myColor ? ' turn-strip' : ''}`, textContent: room.myColor ? (room.toMove === room.myColor ? `Sıra sende (${room.myColor === 'w' ? 'beyaz' : 'siyah'})${room.check ? ' • ŞAH!' : ''}` : `Rakibin düşünüyor${room.check ? ' • ŞAH!' : ''}`) : `Sıra: ${room.toMove === 'w' ? 'beyaz' : 'siyah'}` })
      : null;
    // Terfi seçimi tahtanın üstünde açılır
    const promoPick = chessPromo
      ? el('div', { className: 'promo-pick' },
        el('p', { textContent: 'Piyon neye dönüşsün?' }),
        el('div', {}, ...PROMOS.map(([k, name]) => {
          const b = el('button', { type: 'button', title: name }, el('span', { className: `pc ${room.myColor}`, textContent: GLYPH[k] }), el('small', { textContent: name }));
          b.addEventListener('click', () => {
            act(room.id, 'move', { ...chessPromo, promo: k });
            chessPromo = null;
            chessPick = -1;
          });
          return b;
        })),
        btn('Vazgeç', () => { chessPromo = null; drawChess(room, data, root); }, 'ghost'))
      : null;
    // Beraberlik: teklif et, rakibin teklifini kabul et ya da reddet
    const opponentOffered = room.drawOffer != null && room.drawOffer !== room.mySeat;
    const drawButtons = room.phase !== 'playing' || room.mySeat < 0 ? []
      : opponentOffered ? [btn('Kabul Et', () => act(room.id, 'draw'), 'primary'), btn('Reddet', () => act(room.id, 'decline'), 'ghost')]
        : room.canOfferDraw ? [btn('Berabere Teklif', () => act(room.id, 'draw'), 'ghost')] : [];
    const offerNote = opponentOffered ? el('p', { className: 'hint big-result', textContent: 'Rakibin beraberlik teklif ediyor.' })
      : room.drawOffer === room.mySeat ? el('p', { className: 'hint', textContent: 'Beraberlik teklifin rakibinde.' }) : null;
    root.replaceChildren(
      roomHead(room, data, root, [...drawButtons, ...resign(room), stakeTag(room)]),
      el('div', { className: 'tt-layout' },
        el('div', { className: 'chess-wrap' }, board, ...(promoPick ? [promoPick] : [])),
        el('div', { className: 'tt-side' }, players(room, (s) => (room.colors?.[s.seat] ? el('em', { className: `seat-tag chip-${room.colors[s.seat]}`, textContent: colorName(s.seat) }) : null)),
          ...(status ? [status] : []), ...(offerNote ? [offerNote] : []),
          el('div', { className: 'chess-moves' }, ...(room.moves ?? []).map((m, k) => el('span', { textContent: m, className: k === room.moves.length - 1 ? 'new' : '' }))))),
      waitingBar(room), roomLog(room.log), pastBox('turn', room.past));
    resultSound(room, root);
  }

  // ── Karia Labirent (koridor yarışı) ──
  // Tahta 2N-1 izlik bir ızgaradır: tek izler kare, çift izler karelerin arasındaki oluk (engel yeri).
  let labKey = '';
  function drawLabirent(room, data, root) {
    const n = room.size ?? 9;
    const me = room.pawns.find((p) => p.seat === room.mySeat);
    const myTurn = Boolean(room.phase === 'playing' && room.turn === room.mySeat && me);
    const steps = new Set(room.steps);
    const walls = new Set(room.walls);
    const wallOk = new Set(room.wallOk ?? []);
    // Benim hedefim hep yukarıda görünsün: gerekirse tahta 180° döner
    const flip = me ? me.goal !== 0 : false;
    const cellAt = (r, c) => (flip ? (n - 1 - r) * n + (n - 1 - c) : r * n + c);
    const wallAt = (o, r, c) => (flip ? `${o}-${n - 2 - r}-${n - 2 - c}` : `${o}-${r}-${c}`);
    const key = `${room.id}-${room.walls.length}-${room.pawns.map((p) => p.pos).join(',')}`;
    if (labKey && key !== labKey && room.phase === 'playing') sfx.chip();
    labKey = key;

    const grid = el('div', { className: 'lab' });
    grid.style.gridTemplateColumns = grid.style.gridTemplateRows = `repeat(${n - 1}, minmax(0, 1fr) var(--g)) minmax(0, 1fr)`;
    const place = (node, row, col) => {
      node.style.gridRow = String(row + 1);
      node.style.gridColumn = String(col + 1);
      grid.append(node);
      return node;
    };
    const slots = new Map(); // görünen oluk parçaları: 'h-r-c', 'v-r-c', 'x-r-c'
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = cellAt(r, c);
        const pawn = room.pawns.find((p) => p.pos === i);
        const goalOf = room.pawns.find((p) => p.goal === Math.floor(i / n));
        const cls = ['cell'];
        if (goalOf) cls.push(`goal${goalOf.color}`);
        if (myTurn && steps.has(i)) cls.push('can');
        const cell = place(el('button', { type: 'button', className: cls.join(' ') }), 2 * r, 2 * c);
        if (pawn) cell.append(el('span', { className: `pawn p${pawn.color}${pawn.seat === room.mySeat ? ' mine' : ''}` }));
        // Koordinatlar: altta harf, sağda sayı (1 başlangıç kenarı)
        if (r === n - 1) cell.append(el('i', { className: 'lab-file', textContent: 'abcdefghi'[i % n] }));
        if (c === n - 1) cell.append(el('i', { className: 'lab-rank', textContent: String(flip ? Math.floor(i / n) + 1 : n - Math.floor(i / n)) }));
        cell.addEventListener('click', () => { if (myTurn && steps.has(i)) act(room.id, 'step', { cell: i }); });
        if (r < n - 1) slots.set(`h-${r}-${c}`, place(el('div', { className: 'groove h' }), 2 * r + 1, 2 * c));
        if (c < n - 1) slots.set(`v-${r}-${c}`, place(el('div', { className: 'groove v' }), 2 * r, 2 * c + 1));
        if (r < n - 1 && c < n - 1) slots.set(`x-${r}-${c}`, place(el('div', { className: 'groove x' }), 2 * r + 1, 2 * c + 1));
      }
    }
    // Görünen bir engelin kapladığı üç oluk parçası
    const parts = (o, r, c) => (o === 'h' ? [`h-${r}-${c}`, `x-${r}-${c}`, `h-${r}-${c + 1}`] : [`v-${r}-${c}`, `x-${r}-${c}`, `v-${r + 1}-${c}`]).map((k) => slots.get(k)).filter(Boolean);
    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n - 1; c++) {
        for (const o of ['h', 'v']) {
          const k = wallAt(o, r, c);
          if (walls.has(k)) for (const [j, part] of parts(o, r, c).entries()) part.classList.add('wall', `w${o}${j}`, ...(k === room.lastWall ? ['new'] : []));
        }
      }
    }
    // Oluğun üstüne gelince engelin nereye konacağı görünür; tıklayınca konur
    if (myTurn && me.walls > 0) {
      for (const [k, node] of slots) {
        const [o, rs, cs] = k.split('-');
        if (o === 'x') continue;
        const r = o === 'v' ? Math.min(Number(rs), n - 2) : Number(rs);
        const c = o === 'h' ? Math.min(Number(cs), n - 2) : Number(cs);
        const target = wallAt(o, r, c);
        const ok = wallOk.has(target);
        node.classList.add('aim');
        const preview = (on) => { for (const part of parts(o, r, c)) part.classList.toggle(ok ? 'pv' : 'pv-bad', on); };
        node.addEventListener('mouseenter', () => preview(true));
        node.addEventListener('mouseleave', () => preview(false));
        node.addEventListener('click', () => {
          if (!ok) return say('Oraya engel konmaz: başka engelle çakışıyor ya da yolu tamamen kapatıyor.', 'lose');
          const [mo, mr, mc] = target.split('-');
          act(room.id, 'wall', { o: mo, r: Number(mr), c: Number(mc) });
        });
      }
    }

    const wallDots = (count) => el('span', { className: 'lab-walls' }, el('span', {}, ...Array.from({ length: room.wallsMax ?? 10 }, (_, k) => el('i', { className: k < count ? 'on' : '' }))), el('small', { textContent: `${count}/${room.wallsMax ?? 10}` }));
    const info = el('div', { className: 'lab-help' },
      ...room.pawns.map((p) => el('div', { className: `lab-pl${room.turn === p.seat ? ' turn' : ''}` },
        el('span', { className: `pawn p${p.color}` }),
        el('div', {}, el('b', { textContent: p.seat === room.mySeat ? 'Sen' : p.name }), el('small', { textContent: `Hedefe ${p.dist} adım` })),
        wallDots(p.walls))),
      el('p', { textContent: 'Karşı kenara ilk varan kazanır. Sıranda parlayan kareye yürü ya da iki kare arasındaki oluğa engel koy.' }));
    const status = room.phase === 'playing'
      ? el('p', { className: `hint${myTurn ? ' turn-strip' : ''}`, textContent: myTurn ? (me.walls ? 'Sıra sende: yürü ya da engel koy.' : 'Sıra sende: engelin kalmadı, yürü.') : room.lastAction ?? 'Rakibin düşünüyor...' })
      : null;
    root.replaceChildren(
      roomHead(room, data, root, [...resign(room), stakeTag(room)]),
      el('div', { className: 'tt-layout' },
        el('div', { className: 'lab-wrap' }, grid),
        // Oyun sürerken oyuncular zaten bilgi kutusunda (kalan adım ve engel); koltuk listesi tekrar etmesin
        el('div', { className: 'tt-side' }, ...(room.phase === 'playing' ? [] : [players(room)]), ...(status ? [status] : []), info)),
      waitingBar(room), roomLog(room.log), pastBox('turn', room.past));
    resultSound(room, root);
  }

  // ── Okey 101 ──
  // Istaka 2×15 yuvadır; taşlar sürüklenerek dizilir. Aralarında boşluk olmayan taşlar bir per sayılır.
  const TILE_COLOR = ['kirmizi', 'sari', 'mavi', 'siyah'];
  const COLOR_TR = ['Kırmızı', 'Sarı', 'Mavi', 'Siyah'];
  const ROW = 15;
  const ok = { slots: Array(ROW * 2).fill(null), selected: new Set(), gameKey: '', pendingSlot: -1 };
  const tileEl = (t, extra = '') => el('span', { className: `tile ${t.f ? 'fake' : TILE_COLOR[t.c]}${t.w ? ' wild' : ''} ${extra}` }, el('b', { textContent: t.f ? '★' : String(t.n) }), ...(t.w ? [el('i', { textContent: 'OKEY' })] : []));

  /** Sunucudaki per kurallarının istemci kopyası (yalnızca ıstakadaki toplamı göstermek için; karar sunucuda) */
  function okeyRules(okey) {
    const wild = (t) => t.w;
    const face = (t) => (t.f ? { c: okey.color, n: okey.num } : t);
    function meld(tiles) {
      if (tiles.length < 3) return null;
      const jokers = tiles.filter(wild);
      const normals = tiles.filter((t) => !wild(t));
      if (!normals.length) return null;
      if (tiles.length <= 4) {
        const num = face(normals[0]).n;
        const colors = new Set(normals.map((t) => face(t).c));
        if (normals.every((t) => face(t).n === num) && colors.size === normals.length) return { kind: 'set', points: num * tiles.length };
      }
      const color = face(normals[0]).c;
      if (!normals.every((t) => face(t).c === color)) return null;
      const L = tiles.length;
      let best = null;
      for (let start = 1; start + L - 1 <= 14; start++) {
        const end = start + L - 1;
        const used = new Set();
        let fit = true;
        for (const t of normals) {
          let n = face(t).n;
          if (n === 1 && (n < start || n > end)) n = 14;
          if (n < start || n > end || used.has(n)) {
            fit = false;
            break;
          }
          used.add(n);
        }
        if (!fit || L - used.size > jokers.length) continue;
        let points = 0;
        for (let n = start; n <= end; n++) points += n === 14 ? 11 : n;
        if (!best || points > best.points) best = { kind: 'run', points };
      }
      return best;
    }
    const pair = (tiles) => tiles.length === 2 && (wild(tiles[0]) || wild(tiles[1]) || (face(tiles[0]).c === face(tiles[1]).c && face(tiles[0]).n === face(tiles[1]).n));
    return { meld, pair };
  }

  /** Istakadaki bitişik taş grupları (her sıra ayrı) */
  function segments() {
    const out = [];
    for (let row = 0; row < 2; row++) {
      let cur = null;
      for (let k = 0; k < ROW; k++) {
        const id = ok.slots[row * ROW + k];
        if (id == null) cur = null;
        else {
          if (!cur) out.push(cur = []);
          cur.push(id);
        }
      }
    }
    return out;
  }

  /** Yeni gelen taş için yuva: iki yanı da boş olan sondaki yuva, böylece perlerin arasındaki boşluğa girip onları birleştirmez */
  function looseSlot() {
    const empty = (i) => ok.slots[i] == null;
    for (let i = ROW * 2 - 1; i >= 0; i--) {
      const k = i % ROW;
      if (empty(i) && (k === 0 || empty(i - 1)) && (k === ROW - 1 || empty(i + 1))) return i;
    }
    return ok.slots.lastIndexOf(null);
  }

  /** Eldeki taşlar ile ıstakayı eşitler: giden taş yuvasından çıkar, gelen taş bırakıldığı yere ya da boş bir yuvaya oturur */
  function syncRack(room) {
    const key = `${room.id}-${room.indicator ? `${room.indicator.c}-${room.indicator.n}` : ''}-${room.okey ? `${room.okey.color}-${room.okey.num}` : ''}`;
    const hand = new Set(room.hand.map((t) => t.id));
    // Yeni oyun: eldeki taşların hiçbiri ıstakada yoksa ıstaka baştan dizilir
    if (key !== ok.gameKey || (room.hand.length && !ok.slots.some((id) => id != null && hand.has(id)))) {
      ok.gameKey = key;
      ok.slots.fill(null);
      ok.selected.clear();
      ok.pendingSlot = -1;
      if (room.suggest) return arrange(room, 'melds');
    }
    ok.slots = ok.slots.map((id) => (id != null && hand.has(id) ? id : null));
    for (const id of [...ok.selected]) if (!hand.has(id)) ok.selected.delete(id);
    const placed = new Set(ok.slots.filter((id) => id != null));
    for (const t of room.hand) {
      if (placed.has(t.id)) continue;
      const at = ok.pendingSlot >= 0 && ok.slots[ok.pendingSlot] == null ? ok.pendingSlot : looseSlot();
      ok.pendingSlot = -1;
      if (at < 0) break;
      ok.slots[at] = t.id;
      placed.add(t.id);
    }
  }

  /** Öneriye göre diz: perler aralarında birer boşlukla, kalan taşlar renge ve sayıya göre sona */
  function arrange(room, mode) {
    const hand = new Map(room.hand.map((t) => [t.id, t]));
    const groups = (mode === 'pairs' ? room.suggest?.pairs : room.suggest?.melds) ?? [];
    const used = new Set();
    ok.slots.fill(null);
    let pos = 0;
    for (const g of groups) {
      if (!g.every((id) => hand.has(id) && !used.has(id))) continue;
      const row = Math.floor(pos / ROW);
      let start = pos;
      if ((start % ROW) + g.length > ROW) start = (row + 1) * ROW; // sığmıyorsa alt sıraya
      if (start + g.length > ROW * 2) continue;
      g.forEach((id, k) => {
        ok.slots[start + k] = id;
        used.add(id);
      });
      pos = start + g.length + 1;
    }
    const rest = room.hand.filter((t) => !used.has(t.id)).sort((a, b) => (a.f ? 9 : a.c) - (b.f ? 9 : b.c) || a.n - b.n);
    for (const t of rest) {
      let at = ok.slots.indexOf(null, Math.min(pos, ROW * 2 - 1));
      if (at < 0) at = ok.slots.indexOf(null);
      if (at < 0) break;
      ok.slots[at] = t.id;
      pos = at + 1;
    }
    ok.selected.clear();
  }

  // ── Sürükle-bırak (fare ve dokunmatik): kısa dokunuş tıklama sayılır ──
  function startDrag(event, payload, node) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    const sx = event.clientX;
    const sy = event.clientY;
    let ghost = null;
    const hit = (e) => {
      if (ghost) ghost.hidden = true;
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop]');
      if (ghost) ghost.hidden = false;
      return target;
    };
    const move = (e) => {
      if (!ghost) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
        ghost = node.cloneNode(true);
        ghost.classList.add('drag-ghost');
        document.body.append(ghost);
        node.classList.add('dragging');
      }
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
      for (const t of document.querySelectorAll('.drop-hot')) t.classList.remove('drop-hot');
      hit(e)?.classList.add('drop-hot');
    };
    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      for (const t of document.querySelectorAll('.drop-hot')) t.classList.remove('drop-hot');
      if (!ghost) return e.type === 'pointerup' ? payload.click?.() : undefined;
      const target = hit(e);
      ghost.remove();
      node.classList.remove('dragging');
      if (target) payload.drop(target.dataset.drop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Desteden ya da yerden çekme: ıstakada bir yuvaya bırakılırsa taş oraya oturur */
  const drawFrom = (room, from) => ({
    click: () => act(room.id, 'draw', { from }),
    drop: (where) => {
      if (where.startsWith('slot-')) ok.pendingSlot = Number(where.slice(5));
      if (where.startsWith('slot-') || where === 'rack') act(room.id, 'draw', { from });
    },
  });

  function drawOkey(room, data, root) {
    const playing = room.phase !== 'waiting' && room.players.length > 0;
    if (!playing) {
      ok.gameKey = '';
      root.replaceChildren(roomHead(room, data, root, [stakeTag(room)]), players(room), waitingBar(room), roomLog(room.log), pastBox('turn', room.past));
      return resultSound(room, root);
    }
    syncRack(room);
    const hand = new Map(room.hand.map((t) => [t.id, t]));
    const redraw = () => drawOkey(room, data, root);
    const myTurn = room.myTurn;
    const canDraw = myTurn && !room.drawn;
    const canDiscard = myTurn && room.drawn;
    const rules = room.okey ? okeyRules(room.okey) : null;

    // Oyuncular masanın etrafında; sıra sağa geçer (sen → sağ → üst → sol)
    const base = room.mySeat >= 0 ? room.mySeat : 0;
    const at = (rel) => room.players.find((p) => (p.seat - base + 4) % 4 === rel);
    const me = room.mySeat >= 0 ? at(0) : null;
    const plate = (p, side) => {
      if (!p) return el('div', { className: `okp ${side} empty` });
      const turn = room.turn === p.seat;
      const ring = avatar(room.seats[p.seat]?.id ?? 'bot-x', turn ? 'timer' : '');
      if (turn) {
        ring.dataset.deadline = String(room.deadline);
        ring.dataset.total = String(room.turnMs);
      }
      const won = room.result?.winners.some((w) => w.seat === p.seat);
      const sub = room.phase === 'result' && p.penalty != null ? `ceza ${p.penalty}` : `${p.tiles} taş${p.opened ? ` • ${p.opened === 'pairs' ? 'çift açtı' : 'açtı'}` : ''}${p.gone ? ' • bot' : ''}`;
      return el('div', { className: `okp ${side}${turn ? ' turn' : ''}${won ? ' winner' : ''}` }, ring, el('div', { className: 'okp-text' }, el('strong', { textContent: p.seat === room.mySeat ? 'Sen' : p.name }), el('small', { textContent: won ? `+${fmt(room.result.amount)}` : sub })));
    };
    // Köşeler: her oyuncunun attığı taş sağındakinin önüne düşer; sol alttaki senin alabileceğin taştır
    const corner = (p, pos, mine = false) => {
      const takeable = Boolean(p && p.seat === room.leftSeat && canDraw && p.discard);
      const box = el('div', { className: `okc ${pos}${takeable ? ' can' : ''}${mine && canDiscard ? ' drop' : ''}`, title: takeable ? 'Al: tıkla ya da ıstakaya sürükle' : mine ? 'Atmak için taşı buraya sürükle' : '' });
      if (mine) box.dataset.drop = 'discard';
      const t = p?.discard ? tileEl(p.discard, takeable ? 'takeable' : '') : el('span', { className: 'tile empty' });
      if (takeable) t.addEventListener('pointerdown', (e) => startDrag(e, drawFrom(room, 'discard'), t));
      box.append(t);
      return box;
    };

    const deck = el('div', { className: `ok-deck${canDraw ? ' can' : ''}`, title: canDraw ? 'Desteden çek: tıkla ya da ıstakaya sürükle' : 'Deste' }, el('b', { textContent: String(room.deck) }), el('small', { textContent: 'deste' }));
    if (canDraw) deck.addEventListener('pointerdown', (e) => startDrag(e, drawFrom(room, 'deck'), deck));
    const canAdd = room.opened === 'melds' && canDiscard;
    const melds = el('div', { className: 'ok-melds' }, ...(room.melds.length ? room.melds.map((m, i) => {
      const box = el('div', { className: `ok-meld${canAdd ? ' can' : ''}`, title: 'Taşı bu pere sürükle ya da seçip tıkla' },
        el('i', { textContent: room.seats[m.owner]?.name ?? '' }), ...m.tiles.map((t) => tileEl(t, 'sm')));
      box.dataset.drop = `meld-${i}`;
      box.addEventListener('click', () => {
        if (!ok.selected.size) return say('İşlemek istediğin taşı bu pere sürükle.');
        act(room.id, 'add', { meld: i, tiles: [...ok.selected] });
        ok.selected.clear();
      });
      return box;
    }) : [el('p', { className: 'hint', textContent: 'Açılan perler burada görünür.' })]));
    const felt = el('div', { className: 'okf' },
      el('div', { className: 'okf-mid' },
        deck,
        el('div', { className: 'ok-pile' }, room.indicator ? tileEl(room.indicator) : el('span', { className: 'tile empty' }), el('small', { textContent: 'gösterge' })),
        el('div', { className: 'ok-info' },
          el('strong', { textContent: room.okey ? `Okey: ${COLOR_TR[room.okey.color]} ${room.okey.num}` : 'Okey 101' }),
          el('small', { textContent: me?.penalty != null ? `Senin cezan: ${me.penalty}` : room.opened ? (room.opened === 'pairs' ? 'Çiftle açtın' : 'Açtın: perlere taş işleyebilirsin') : '101 sayı ya da 5 çiftle açılır' }))),
      melds);

    // Istaka: bitişik grupların geçerliliği ve toplamı
    let meldPoints = 0;
    const meldSegs = [];
    const pairSegs = [];
    const inMeld = new Set();
    for (const ids of segments()) {
      const tiles = ids.map((id) => hand.get(id));
      const m = rules && tiles.length >= 3 ? rules.meld(tiles) : null;
      const pairOk = Boolean(rules && tiles.length === 2 && rules.pair(tiles));
      if (m) {
        meldPoints += m.points;
        meldSegs.push(ids);
      }
      if (pairOk) pairSegs.push(ids);
      if (m || pairOk) for (const id of ids) inMeld.add(id);
    }
    const rack = el('div', { className: 'ok-rack' });
    rack.dataset.drop = 'rack';
    for (let i = 0; i < ROW * 2; i++) {
      const slot = el('div', { className: 'ok-slot' });
      slot.dataset.drop = `slot-${i}`;
      const id = ok.slots[i];
      if (id != null && hand.has(id)) {
        const node = tileEl(hand.get(id), `${ok.selected.has(id) ? 'sel' : ''}${room.took === id ? ' took' : ''}${inMeld.has(id) ? ' inmeld' : ''}`);
        node.addEventListener('pointerdown', (e) => startDrag(e, {
          click: () => {
            // Aynı taşa hızlı iki dokunuş: taş çekildiyse o taşı atar
            const double = ok.lastTap?.id === id && Date.now() - ok.lastTap.at < 380;
            ok.lastTap = { id, at: Date.now() };
            if (double && canDiscard) {
              ok.selected.clear();
              return act(room.id, 'discard', { tile: id });
            }
            if (ok.selected.has(id)) ok.selected.delete(id);
            else ok.selected.add(id);
            sfx.chip();
            redraw();
          },
          drop: (where) => {
            if (where.startsWith('slot-')) {
              const to = Number(where.slice(5));
              const from = ok.slots.indexOf(id);
              [ok.slots[from], ok.slots[to]] = [ok.slots[to], ok.slots[from]];
              sfx.chip();
              redraw();
            } else if (where === 'discard') {
              if (!canDiscard) return say(myTurn ? 'Önce taş çek.' : 'Sıra sende değil.', 'lose');
              ok.selected.clear();
              act(room.id, 'discard', { tile: id });
            } else if (where.startsWith('meld-')) {
              act(room.id, 'add', { meld: Number(where.slice(5)), tiles: ok.selected.has(id) ? [...ok.selected] : [id] });
              ok.selected.clear();
            }
          },
        }, node));
        slot.append(node);
      }
      rack.append(slot);
    }

    const pairCount = pairSegs.length;
    const usePairs = room.opened === 'pairs' || (!room.opened && meldPoints < 101 && pairCount >= 5);
    const openGroups = usePairs ? pairSegs : meldSegs;
    const badge = el('div', { className: `ok-score${meldPoints >= 101 || pairCount >= 5 ? ' ready' : ''}`, title: 'Istakadaki geçerli perlerin toplamı' },
      el('b', { textContent: usePairs ? String(pairCount) : String(meldPoints) }), el('small', { textContent: usePairs ? 'çift' : 'sayı' }));

    const controls = el('div', { className: `pcontrols ok-controls${me && room.phase === 'playing' && myTurn ? ' my-turn' : ''}` });
    if (me && room.phase === 'playing') {
      if (myTurn) {
        const timer = el('div', { className: 'turn-bar' });
        timer.dataset.deadline = String(room.deadline);
        timer.dataset.total = String(room.turnMs);
        controls.append(timer);
      }
      controls.append(
        btn('Seri Diz', () => { arrange(room, 'melds'); sfx.chip(); redraw(); }, 'ghost mini'),
        btn('Çift Diz', () => { arrange(room, 'pairs'); sfx.chip(); redraw(); }, 'ghost mini'));
      if (canDraw) controls.append(btn('Taş Çek', () => act(room.id, 'draw', { from: 'deck' }), 'pk call'));
      if (canDiscard) {
        if (openGroups.length) {
          const label = room.opened ? `Per Aç (${openGroups.length})` : usePairs ? `Çiftle Aç (${pairCount})` : `Elini Aç • ${meldPoints}`;
          controls.append(btn(label, () => act(room.id, 'open', { groups: openGroups }), 'pk raise'));
        }
        if (room.took != null) controls.append(btn('Geri Bırak', () => act(room.id, 'untake'), 'ghost'));
        controls.append(btn('Taş At', () => {
          if (ok.selected.size !== 1) return say('Atmak için tek bir taş seç ya da taşı sağ alt köşeye sürükle.');
          act(room.id, 'discard', { tile: [...ok.selected][0] });
          ok.selected.clear();
        }, 'pk fold'));
      }
      controls.append(el('p', { className: 'hint', textContent: !myTurn
        ? `Sıra: ${room.players.find((p) => p.seat === room.turn)?.name ?? ''}`
        : canDraw ? 'Desteden ya da sol alttaki taştan çek: tıkla ya da ıstakaya sürükle.'
          : room.opened ? 'Taş işlemek için taşı masadaki pere sürükle; sonra bir taşı sağ alt köşeye at.'
            : 'Taşları sürükleyerek diz: boşluksuz yan yana taşlar bir per sayılır. 101 olunca Elini Aç, sonra bir taş at.' }));
    }

    const table = el('div', { className: 'okt' },
      corner(at(2), 'tl'), plate(at(2), 'top'), corner(at(1), 'tr'),
      plate(at(3), 'left'), felt, plate(at(1), 'right'),
      corner(at(3), 'bl'), el('div', { className: 'okt-me' }, plate(me, 'me'), ...(me ? [badge] : [])), corner(me, 'br', Boolean(me)));
    root.replaceChildren(
      roomHead(room, data, root, [...resign(room), stakeTag(room)]),
      table, ...(me ? [rack] : []), ...(controls.childElementCount ? [controls] : []), waitingBar(room), roomLog(room.log), pastBox('turn', room.past));
    resultSound(room, root);
  }

  return { drawChess, drawLabirent, drawOkey };
}
