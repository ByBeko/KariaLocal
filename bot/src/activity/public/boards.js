// Sıra tabanlı masa oyunlarının çizimi: satranç, Karia Labirent, Okey 101. Kararlar sunucudadır.
// Hepsi tables.js'teki ortak kabuğa (paint) çizilir: üst satır, oyun alanı, durum şeridi, aksiyon çubuğu.
export function initBoards(ctx) {
  const { el, fmt, sfx, act, avatar, timed, btn, paint, headFor, lastLog, countdown, myId } = ctx;

  /** Koltuk kartları: kim oturuyor, hazır mı, sıra kimde; boş koltukta Otur */
  function seatList(room, { col = false, extra = () => null } = {}) {
    const seated = room.mySeat >= 0;
    const waiting = room.phase === 'waiting';
    return el('div', { className: `seats${col ? ' col' : ''}` }, ...room.seats.map((s, i) => {
      if (!s) return el('div', { className: 'seat empty' }, seated ? 'Boş koltuk' : btn('Otur', () => act(room.id, 'join', { seat: i }), 'pk go sm'));
      const turn = room.phase === 'playing' && room.turn === i;
      const ring = avatar(s.id, turn ? 'timer' : s.ready && waiting ? 'ready' : '');
      if (turn) timed(ring, room);
      const won = room.result?.winners.some((w) => w.seat === i);
      const sub = won ? `Kazandı +${fmt(room.result.amount)}` : waiting ? (s.ready ? 'Hazır' : 'Bekliyor') : turn ? 'Sırada' : '';
      return el('div', { className: `seat${turn ? ' turn' : ''}${s.id === myId() ? ' me' : ''}${won ? ' winner' : ''}${s.ready && waiting ? ' ready' : ''}` },
        ring,
        el('div', { className: 'seat-text' }, el('strong', { textContent: s.id === myId() ? `${s.name} (sen)` : s.name }), el('small', { textContent: sub })),
        ...[extra(s, i)].filter(Boolean));
    }));
  }

  /**
   * Oyun dışındaki anlar her masada aynıdır: oturmadıysan Otur, beklerken Hazırım, bitince sonuç.
   * Oyun sürerken o oyunun kendi durum ve butonları kullanılır.
   */
  function flow(room, playing) {
    const log = lastLog(room);
    if (room.phase === 'playing') return playing;
    if (room.mySeat < 0) return { status: { text: room.seats.some((s) => !s) ? `Giriş ${fmt(room.stake)} coin. Boş bir koltuğa tıklayıp otur.` : 'Masa dolu, izliyorsun.', tone: 'go', log } };
    if (room.phase === 'result' && room.result) {
      const r = room.result;
      const mine = r.winners.some((w) => w.id === myId());
      return { status: {
        text: mine ? `Kazandın! +${fmt(r.amount)} • ${r.reason}` : r.winners.length ? `${r.winners.map((w) => w.name).join(', ')} kazandı • ${r.reason}` : `Berabere, girişin geri döndü • ${r.reason}`,
        tone: mine ? 'win' : r.winners.length ? 'lose' : 'go', log } };
    }
    const solo = room.id.startsWith('solo-');
    const need = room.game === 'okey' ? 4 : 2;
    const main = room.ready ? [btn('Hazır Değilim', () => act(room.id, 'unready'), 'pk soft')] : [btn(`Hazırım • ${fmt(room.stake)}`, () => act(room.id, 'ready'), 'pk gold big')];
    const status = room.startsAt ? { text: countdown('Oyun {s} sn sonra başlıyor', room.startsAt), tone: 'turn', log }
      : room.ready ? { text: solo ? 'Hazırsın, oyun başlıyor...' : `Hazırsın. Diğer oyuncular bekleniyor (en az ${need} kişi).`, tone: 'go', log }
        : { text: solo ? 'Hazırım’a bas, oyun başlasın.' : `Hazırım’a bas. Herkes hazır olunca başlar (en az ${need} kişi; boş yere + Bot ekleyebilirsin).`, tone: 'turn', log };
    return { status, main, myTurn: !room.ready };
  }

  /** Bitişte ses (sonuç yazısı durum şeridinde) */
  function resultSound(room, root) {
    const key = room.phase === 'result' ? JSON.stringify(room.result) : '';
    if (key && root.dataset.done !== key) {
      root.dataset.done = key;
      if (room.mySeat >= 0) sfx.result(room.result.winners.some((w) => w.id === myId()) ? 1 : room.result.winners.length ? -1 : 0);
    }
    if (!key) delete root.dataset.done;
  }

  const resign = (room) => (room.phase === 'playing' && room.mySeat >= 0 ? [btn('Pes Et', () => act(room.id, 'resign'), 'pk no sm')] : []);
  const turnName = (room) => room.seats[room.turn]?.name ?? '';

  // ───────────────────────── Satranç ─────────────────────────
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
    const myTurn = Boolean(room.myColor && room.toMove === room.myColor);
    const check = room.check ? ' • ŞAH!' : '';
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
        btn('Vazgeç', () => { chessPromo = null; drawChess(room, data, root); }, 'pk soft sm'))
      : null;
    // Beraberlik: teklif et, rakibin teklifini kabul et ya da reddet
    const offered = room.drawOffer != null && room.drawOffer !== room.mySeat;
    const drawButtons = room.phase !== 'playing' || room.mySeat < 0 ? []
      : offered ? [btn('Beraberliği Kabul Et', () => act(room.id, 'draw'), 'pk go'), btn('Reddet', () => act(room.id, 'decline'), 'pk soft')]
        : room.canOfferDraw ? [btn('Berabere Teklif Et', () => act(room.id, 'draw'), 'pk soft sm')] : [];
    const note = offered ? ' • Rakibin beraberlik teklif ediyor.' : room.drawOffer === room.mySeat ? ' • Beraberlik teklifin rakibinde.' : '';
    const status = !room.myColor
      ? { text: `Sıra: ${room.toMove === 'w' ? 'beyaz' : 'siyah'}${check}`, deadline: room.deadline, total: room.turnMs, log: lastLog(room) }
      : myTurn
        ? { text: `Sıra sende (${room.myColor === 'w' ? 'beyaz' : 'siyah'})${check}: taşına tıkla, sonra işaretli kareye.${note}`, tone: 'turn', deadline: room.deadline, total: room.turnMs }
        : { text: `Rakibin düşünüyor...${check}${note}`, tone: offered ? 'turn' : '', deadline: room.deadline, total: room.turnMs };
    const playing = { status, main: offered ? drawButtons : [], side: [...(offered ? [] : drawButtons), ...resign(room)], myTurn: myTurn || offered };
    paint(root, 'satranc', {
      ...headFor(room, root, `Giriş ${fmt(room.stake)}`),
      stage: [el('div', { className: 'board-layout' },
        el('div', { className: 'board-wrap' }, board, ...(promoPick ? [promoPick] : [])),
        el('div', { className: 'board-side' },
          seatList(room, { col: true, extra: (s) => (room.colors?.[s.seat] ? el('em', { className: `seat-tag chip-${room.colors[s.seat]}`, textContent: colorName(s.seat) }) : null) }),
          el('div', { className: 'chess-moves' }, ...(room.moves ?? []).map((m, k) => el('span', { textContent: m, className: k === room.moves.length - 1 ? 'new' : '' })))))],
      ...flow(room, playing),
    });
    resultSound(room, root);
  }

  // ───────────────────────── Karia Labirent (koridor yarışı) ─────────────────────────
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
          if (!ok) return ctx.say('Oraya engel konmaz: başka engelle çakışıyor ya da yolu tamamen kapatıyor.', 'lose');
          const [mo, mr, mc] = target.split('-');
          act(room.id, 'wall', { o: mo, r: Number(mr), c: Number(mc) });
        });
      }
    }

    const wallDots = (count) => el('span', { className: 'lab-walls' }, el('span', {}, ...Array.from({ length: room.wallsMax ?? 10 }, (_, k) => el('i', { className: k < count ? 'on' : '' }))), el('small', { textContent: `${count}/${room.wallsMax ?? 10}` }));
    const info = room.pawns.map((p) => el('div', { className: `lab-pl${room.phase === 'playing' && room.turn === p.seat ? ' turn' : ''}` },
      el('span', { className: `pawn p${p.color}` }),
      el('div', {}, el('b', { textContent: p.seat === room.mySeat ? 'Sen' : p.name }), el('small', { textContent: `Hedefe ${p.dist} adım` })),
      wallDots(p.walls)));
    const status = myTurn
      ? { text: me.walls ? 'Sıra sende: parlayan karelere yürü ya da iki kare arasına engel koy.' : 'Sıra sende: engelin kalmadı, parlayan karelere yürü.', tone: 'turn', deadline: room.deadline, total: room.turnMs, log: room.lastAction ?? '' }
      : { text: room.mySeat >= 0 ? 'Rakibin düşünüyor...' : `Sıra: ${turnName(room)}`, deadline: room.deadline, total: room.turnMs, log: room.lastAction ?? '' };
    paint(root, 'labirent', {
      ...headFor(room, root, `Giriş ${fmt(room.stake)}`),
      stage: [el('div', { className: 'board-layout' },
        el('div', { className: 'board-wrap' }, grid),
        // Oyun sürerken oyuncular bilgi kutusunda (kalan adım ve engel); koltuk listesi tekrar etmesin
        el('div', { className: 'board-side' }, ...(room.phase === 'playing' ? [] : [seatList(room, { col: true })]), ...info))],
      ...flow(room, { status, side: resign(room), myTurn }),
    });
    resultSound(room, root);
  }

  // ───────────────────────── Okey 101 ─────────────────────────
  // Istaka 2×15 yuvadır; taşlar sürüklenerek dizilir. Aralarında boşluk olmayan taşlar bir per sayılır.
  const TILE_COLOR = ['kirmizi', 'sari', 'mavi', 'siyah'];
  const COLOR_TR = ['Kırmızı', 'Sarı', 'Mavi', 'Siyah'];
  const ROW = 15;
  const ok = { slots: Array(ROW * 2).fill(null), selected: new Set(), gameKey: '', pendingSlot: -1 };
  const tileEl = (t, extra = '') => el('span', { className: `tile ${t.f ? 'fake' : TILE_COLOR[t.c]}${t.w ? ' wild' : ''}${extra ? ` ${extra}` : ''}`, title: t.f ? 'Sahte okey' : `${COLOR_TR[t.c]} ${t.n}${t.w ? ' (okey)' : ''}` },
    ...(t.w ? [el('i', { textContent: 'OKEY' })] : []), el('b', { textContent: t.f ? '★' : String(t.n) }));
  const emptyTile = () => el('span', { className: 'tile empty' });

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
        // Kopya gövdeye eklenir; taş boyu ıstakadaki boyla aynı kalsın
        const r = node.getBoundingClientRect();
        ghost = node.cloneNode(true);
        ghost.classList.remove('sel', 'takeable');
        ghost.classList.add('drag-ghost');
        ghost.style.setProperty('--tw', `${r.width}px`);
        ghost.style.setProperty('--th', `${r.height}px`);
        ghost.style.setProperty('--k', '1');
        ghost.style.width = `${r.width}px`;
        ghost.style.height = `${r.height}px`;
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
    const head = headFor(room, root, `Giriş ${fmt(room.stake)}`);
    const playing = room.phase !== 'waiting' && room.players.length > 0;
    if (!playing) {
      ok.gameKey = '';
      paint(root, 'okey', { ...head, stage: [seatList(room)], ...flow(room, {}) });
      return resultSound(room, root);
    }
    if (room.mySeat >= 0) syncRack(room);
    const hand = new Map(room.hand.map((t) => [t.id, t]));
    const redraw = () => drawOkey(room, data, root);
    const myTurn = Boolean(room.myTurn);
    const canDraw = myTurn && !room.drawn;
    const canDiscard = myTurn && room.drawn;
    const rules = room.okey ? okeyRules(room.okey) : null;

    // Oyuncular masanın etrafında; sıra sağa geçer (sen → sağ → üst → sol). Soldakinin attığı taşı alabilirsin.
    const base = room.mySeat >= 0 ? room.mySeat : 0;
    const at = (rel) => room.players.find((p) => (p.seat - base + 4) % 4 === rel);
    const me = room.mySeat >= 0 ? at(0) : null;
    const leftP = at(3);
    const subOf = (p) => (room.phase === 'result' && p.penalty != null ? `ceza ${p.penalty}` : `${p.tiles} taş${p.opened ? (p.opened === 'pairs' ? ' • çift açtı' : ' • açtı') : ''}${p.gone ? ' • bot' : ''}`);
    const opp = (p, side) => {
      if (!p) return el('div', { className: `ok-opp ${side} empty` });
      const turn = room.phase === 'playing' && room.turn === p.seat;
      const ring = avatar(room.seats[p.seat]?.id ?? 'bot-x', turn ? 'timer' : '');
      if (turn) timed(ring, room);
      const won = room.result?.winners.some((w) => w.seat === p.seat);
      const takeable = Boolean(p.seat === room.leftSeat && canDraw && p.discard);
      const tile = p.discard ? tileEl(p.discard, takeable ? 'takeable' : '') : emptyTile();
      if (takeable) {
        tile.title = 'Al: tıkla ya da ıstakana sürükle';
        tile.addEventListener('pointerdown', (e) => startDrag(e, drawFrom(room, 'discard'), tile));
      }
      return el('div', { className: `ok-opp ${side}${turn ? ' turn' : ''}${won ? ' winner' : ''}` },
        ring,
        el('div', { className: 'ok-who' }, el('strong', { textContent: p.seat === room.mySeat ? 'Sen' : p.name }), el('small', { textContent: won ? `Kazandı +${fmt(room.result.amount)}` : subOf(p) })),
        el('div', { className: `ok-disc${takeable ? ' take' : ''}` }, tile, el('small', { textContent: takeable ? '↓ Al' : 'Attığı' })));
    };

    // Orta: deste, gösterge ve okey taşı; yanında açılan perler
    const deck = el('div', { className: `ok-deck${canDraw ? ' can' : ''}`, title: canDraw ? 'Desteden çek: tıkla ya da ıstakana sürükle' : 'Deste' }, el('span', { textContent: String(room.deck) }));
    if (canDraw) deck.addEventListener('pointerdown', (e) => startDrag(e, drawFrom(room, 'deck'), deck));
    const pile = (node, label) => el('div', { className: 'ok-pile' }, node, el('small', { textContent: label }));
    const canAdd = room.opened === 'melds' && canDiscard;
    const melds = el('div', { className: 'ok-melds' }, ...(room.melds.length ? room.melds.map((m, i) => {
      const box = el('div', { className: `ok-meld${canAdd ? ' can' : ''}`, title: canAdd ? 'Taşı bu pere sürükle ya da seçip tıkla' : '' },
        el('i', { textContent: room.seats[m.owner]?.name ?? '' }), ...m.tiles.map((t) => tileEl(t)));
      box.dataset.drop = `meld-${i}`;
      box.addEventListener('click', () => {
        if (!canAdd) return;
        if (!ok.selected.size) return ctx.say('İşlemek istediğin taşı seç ya da bu pere sürükle.');
        act(room.id, 'add', { meld: i, tiles: [...ok.selected] });
        ok.selected.clear();
      });
      return box;
    }) : [el('p', { className: 'hint', textContent: 'Açılan perler burada görünür.' })]));
    const felt = el('div', { className: 'ok-felt felt' },
      el('div', { className: 'ok-center' },
        pile(deck, canDraw ? '↓ Çek' : 'Deste'),
        pile(room.indicator ? tileEl(room.indicator) : emptyTile(), 'Gösterge'),
        pile(room.okey ? tileEl({ c: room.okey.color, n: room.okey.num, w: true }) : emptyTile(), 'Okey')),
      melds);
    const table = el('div', { className: 'ok-table' }, opp(at(2), 'top'), opp(at(3), 'left'), felt, opp(at(1), 'right'));

    // Istaka: bitişik grupların geçerliliği ve toplamı
    let meldPoints = 0;
    const meldSegs = [];
    const pairSegs = [];
    const inMeld = new Set();
    for (const ids of me ? segments() : []) {
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
    let mine;
    if (me) {
      const rack = el('div', { className: 'ok-rack' });
      rack.dataset.drop = 'rack';
      for (let i = 0; i < ROW * 2; i++) {
        const slot = el('div', { className: 'ok-slot' });
        slot.dataset.drop = `slot-${i}`;
        const id = ok.slots[i];
        if (id != null && hand.has(id)) {
          const node = tileEl(hand.get(id), `${ok.selected.has(id) ? 'sel' : ''}${room.took === id ? ' took' : ''}${inMeld.has(id) ? ' inmeld' : ''}`.trim());
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
                if (!canDiscard) return ctx.say(myTurn ? 'Önce bir taş çek.' : 'Sıra sende değil.', 'lose');
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
      // Atma kutusu: senin attığın taş burada durur (sağındaki oyuncu alabilir)
      const throwBox = el('div', { className: `ok-throw${canDiscard ? ' on' : ''}`, title: canDiscard ? 'Atmak istediğin taşı buraya sürükle' : '' },
        ...(me.discard ? [tileEl(me.discard)] : []),
        el('span', { textContent: canDiscard ? 'Taşı buraya at' : me.discard ? 'Attığın' : 'Atılacak taş' }));
      throwBox.dataset.drop = 'discard';
      mine = el('div', { className: 'ok-mine' }, rack, throwBox);
    } else {
      mine = el('div', { className: 'ok-mine' }, opp(at(0), 'bottom'));
    }

    const pairCount = pairSegs.length;
    const usePairs = room.opened === 'pairs' || (!room.opened && meldPoints < 101 && pairCount >= 5);
    const openGroups = usePairs ? pairSegs : meldSegs;
    const canOpen = meldPoints >= 101 || pairCount >= 5;
    const badge = el('div', { className: `ok-score${canOpen ? ' ready' : ''}`, title: 'Istakadaki geçerli perlerin toplamı (101 olunca açabilirsin)' },
      el('b', { textContent: usePairs ? String(pairCount) : String(meldPoints) }), el('small', { textContent: usePairs ? 'çift / 5' : 'sayı / 101' }));

    // Butonlar: ortada sıradaki zorunlu hamle, yanda dizme ve diğerleri
    const main = [];
    const side = [];
    if (me && room.phase === 'playing') {
      if (canDraw) {
        main.push(btn('Desteden Çek', () => act(room.id, 'draw', { from: 'deck' }), 'pk go big'));
        if (leftP?.discard) main.push(btn('Soldakini Al', () => act(room.id, 'draw', { from: 'discard' }), 'pk soft'));
      }
      if (canDiscard) {
        if (openGroups.length && (room.opened || canOpen)) {
          const label = room.opened ? `Per Aç (${openGroups.length})` : usePairs ? `Çiftle Aç (${pairCount})` : `Elini Aç • ${meldPoints}`;
          main.push(btn(label, () => act(room.id, 'open', { groups: openGroups }), 'pk gold'));
        }
        main.push(btn('Taş At', () => {
          if (ok.selected.size !== 1) return ctx.say('Atmak için tek bir taş seç ya da taşı sağdaki kutuya sürükle.');
          act(room.id, 'discard', { tile: [...ok.selected][0] });
          ok.selected.clear();
        }, 'pk go big'));
        if (room.took != null) main.push(btn('Geri Bırak', () => act(room.id, 'untake'), 'pk soft'));
      }
      side.push(btn('Seri Diz', () => { arrange(room, 'melds'); sfx.chip(); redraw(); }, 'pk soft sm'),
        btn('Çift Diz', () => { arrange(room, 'pairs'); sfx.chip(); redraw(); }, 'pk soft sm'),
        ...resign(room));
    }

    const timer = { deadline: room.deadline, total: room.turnMs };
    let status;
    if (!me) status = { text: `Sıra: ${turnName(room)}`, ...timer, log: lastLog(room) };
    else if (!myTurn) status = { text: `Sıra: ${turnName(room)}. Bu arada taşlarını dizebilirsin.`, ...timer, log: lastLog(room) };
    else if (canDraw) status = { text: `Sıra sende: desteden çek ya da soldaki oyuncunun${leftP ? ` (${leftP.name})` : ''} attığı taşı al.`, tone: 'turn', ...timer };
    else if (room.took != null) status = { text: 'Yerden aldığın taşı bu el açarken ya da pere işlerken kullanmalısın. Kullanmayacaksan Geri Bırak’a bas.', tone: 'turn', ...timer };
    else if (room.opened) status = { text: 'Perlere taş işleyebilirsin. Sonra bir taşı sağdaki kutuya at ya da seçip Taş At’a bas.', tone: 'turn', ...timer };
    else if (canOpen) status = { text: `Açabilirsin! Önce ${usePairs ? 'Çiftle Aç' : 'Elini Aç'}’a bas, sonra bir taş at.`, tone: 'turn', ...timer };
    else status = { text: 'Bir taş at: taşı sağdaki kutuya sürükle ya da seçip Taş At’a bas.', tone: 'turn', ...timer };

    paint(root, 'okey', {
      ...head,
      stage: [table, mine],
      stageClass: 'okey',
      left: me ? [badge] : [],
      ...flow(room, { status, main, side, myTurn }),
    });
    resultSound(room, root);
  }

  return { drawChess, drawLabirent, drawOkey };
}
