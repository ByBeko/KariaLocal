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
      bar.append(el('p', { className: 'hint' }, room.startsAt ? countdown('Oyun {s} sn sonra başlıyor', room.startsAt) : `Herkes hazır olunca başlar (en az ${room.game === 'okey' ? 4 : 2} kişi; boş yere + Bot ekleyebilirsin)`));
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

  function drawChess(room, data, root) {
    const flip = room.myColor === 'b';
    const legal = room.legal ?? [];
    const key = `${room.id}-${room.board.join('')}`;
    if (key !== chessKey) {
      if (chessKey && room.lastMove) sfx.card(1);
      chessKey = key;
      chessPick = -1;
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
          const promo = legal.some((m) => m[0] === chessPick && m[1] === i && m[2]) ? 'q' : undefined;
          act(room.id, 'move', { from: chessPick, to: i, promo });
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
      ? el('p', { className: 'hint', textContent: room.myColor ? (room.toMove === room.myColor ? `Sıra sende (${room.myColor === 'w' ? 'beyaz' : 'siyah'})${room.check ? ' • ŞAH!' : ''}` : `Rakibin düşünüyor${room.check ? ' • ŞAH!' : ''}`) : `Sıra: ${room.toMove === 'w' ? 'beyaz' : 'siyah'}` })
      : null;
    root.replaceChildren(
      roomHead(room, data, root, [...resign(room), stakeTag(room)]),
      el('div', { className: 'tt-layout' },
        el('div', { className: 'chess-wrap' }, board),
        el('div', { className: 'tt-side' }, players(room, (s) => (room.colors?.[s.seat] ? el('em', { className: `seat-tag chip-${room.colors[s.seat]}`, textContent: colorName(s.seat) }) : null)),
          ...(status ? [status] : []),
          el('div', { className: 'chess-moves' }, ...(room.moves ?? []).map((m, k) => el('span', { textContent: m, className: k === room.moves.length - 1 ? 'new' : '' }))))),
      waitingBar(room), roomLog(room.log), pastBox('turn', room.past));
    resultSound(room, root);
  }

  // ── Karia Labirent ──
  let labMode = 'step';
  function drawLabirent(room, data, root) {
    const size = room.size;
    const me = room.pawns.find((p) => p.seat === room.mySeat);
    const myTurn = room.phase === 'playing' && room.turn === room.mySeat && me;
    const steps = new Set(room.steps);
    const rocks = new Set(room.rocks);
    if (myTurn && labMode === 'rock' && !me.rocks) labMode = 'step';
    if (myTurn && labMode === 'pick' && !me.pick) labMode = 'step';
    const grid = el('div', { className: 'lab', style: `--n:${size}` });
    // Benim hedefim hep yukarıda görünsün
    const flipped = me ? me.goal !== 0 : false;
    for (let v = 0; v < size * size; v++) {
      const i = flipped ? size * size - 1 - v : v;
      const row = Math.floor(i / size);
      const pawn = room.pawns.find((p) => p.pos === i);
      const goalOf = room.pawns.find((p) => p.goal === row);
      const cls = ['cell'];
      if (goalOf) cls.push(`goal${goalOf.color}`);
      if (rocks.has(i)) cls.push('rock');
      if (myTurn && labMode === 'step' && steps.has(i)) cls.push('can');
      if (myTurn && labMode === 'rock' && !rocks.has(i) && !pawn) cls.push('canrock');
      if (myTurn && labMode === 'pick' && rocks.has(i)) cls.push('canpick');
      const cell = el('button', { type: 'button', className: cls.join(' ') });
      if (pawn) cell.append(el('span', { className: `pawn p${pawn.color}${pawn.seat === room.mySeat ? ' mine' : ''}` }));
      cell.addEventListener('click', () => {
        if (!myTurn) return;
        if (labMode === 'step' && steps.has(i)) act(room.id, 'step', { cell: i });
        else if (labMode === 'rock' && !rocks.has(i) && !pawn) act(room.id, 'rock', { cell: i });
        else if (labMode === 'pick' && rocks.has(i)) act(room.id, 'pick', { cell: i });
      });
      grid.append(cell);
    }
    const modes = myTurn ? el('div', { className: 'lab-modes' },
      ...[['step', 'Yürü'], ['rock', `Kaya Koy (${me.rocks})`], ['pick', `Kazma (${me.pick})`]].map(([m, text]) => {
        const b = btn(text, () => { labMode = m; drawLabirent(room, data, root); }, labMode === m ? 'active' : '');
        b.disabled = (m === 'rock' && !me.rocks) || (m === 'pick' && !me.pick);
        return b;
      })) : null;
    const info = el('div', { className: 'lab-help' },
      el('p', { textContent: 'Karşı kenara ilk varan kazanır. Sıranda ya bir kare yürü, ya boş kareye kaya koy, ya da kazmayla bir kayayı kır. Kaya yolu tamamen kapatamaz; rakip yanındaysa üstünden atlarsın.' }),
      ...room.pawns.map((p) => el('div', { className: 'lab-pl' }, el('span', { className: `pawn p${p.color}` }), el('b', { textContent: p.name }), el('em', { textContent: `${p.rocks} kaya • ${p.pick} kazma` }))));
    root.replaceChildren(
      roomHead(room, data, root, [...resign(room), stakeTag(room)]),
      el('div', { className: 'tt-layout' },
        el('div', { className: 'lab-wrap' }, grid),
        el('div', { className: 'tt-side' }, players(room), ...(modes ? [modes] : []), ...(room.phase === 'playing' ? [el('p', { className: 'hint', textContent: myTurn ? 'Sıra sende.' : room.lastAction ?? 'Rakibin oynuyor.' })] : []), info)),
      waitingBar(room), roomLog(room.log), pastBox('turn', room.past));
    resultSound(room, root);
  }

  // ── Okey 101 ──
  const TILE_COLOR = ['kirmizi', 'sari', 'mavi', 'siyah'];
  const ok = { order: [], selected: new Set(), groups: [], room: null, sort: null };
  const tileEl = (t, extra = '') => el('span', { className: `tile ${t.f ? 'fake' : TILE_COLOR[t.c]}${t.w ? ' wild' : ''} ${extra}` }, el('b', { textContent: t.f ? '★' : String(t.n) }), ...(t.w ? [el('i', { textContent: 'OKEY' })] : []));

  function drawOkey(room, data, root) {
    ok.room = room;
    const hand = new Map(room.hand.map((t) => [t.id, t]));
    // Yerel sıra korunur: yeni taşlar sona eklenir, gidenler çıkar
    ok.order = ok.order.filter((id) => hand.has(id));
    for (const t of room.hand) if (!ok.order.includes(t.id)) ok.order.push(t.id);
    for (const id of [...ok.selected]) if (!hand.has(id)) ok.selected.delete(id);
    ok.groups = ok.groups.map((g) => g.filter((id) => hand.has(id))).filter((g) => g.length);
    const grouped = new Set(ok.groups.flat());
    const sel = () => [...ok.selected];
    const redraw = () => drawOkey(room, data, root);

    const others = room.players.filter((p) => p.seat !== room.mySeat);
    const opp = el('div', { className: 'ok-opps' }, ...others.map((p) => {
      const left = p.seat === room.leftSeat;
      const disc = p.discard ? tileEl(p.discard, left && room.myTurn && !room.drawn ? 'takeable' : '') : el('span', { className: 'tile empty' });
      if (left && room.myTurn && !room.drawn && p.discard) disc.addEventListener('click', () => act(room.id, 'draw', { from: 'discard' }));
      return el('div', { className: `ok-opp${room.turn === p.seat ? ' turn' : ''}` },
        avatar(room.seats[p.seat]?.id ?? 'bot-x', room.turn === p.seat ? 'timer' : ''),
        el('div', {}, el('strong', { textContent: p.name }), el('small', { textContent: `${p.tiles} taş${p.opened ? ` • ${p.opened === 'pairs' ? 'çiftle açtı' : 'açtı'}` : ''}${p.penalty != null ? ` • ceza ${p.penalty}` : ''}` })),
        el('div', { className: 'ok-disc', title: left ? 'Senin solun: attığını alabilirsin' : 'Son attığı' }, disc));
    }));
    for (const node of opp.querySelectorAll('.timer')) {
      node.dataset.deadline = String(room.deadline);
      node.dataset.total = String(room.turnMs);
    }

    const deck = el('button', { type: 'button', className: `ok-deck${room.myTurn && !room.drawn ? ' can' : ''}` }, el('b', { textContent: String(room.deck) }), el('small', { textContent: 'deste' }));
    deck.addEventListener('click', () => { if (room.myTurn && !room.drawn) act(room.id, 'draw', { from: 'deck' }); });
    const center = el('div', { className: 'ok-center' },
      deck,
      el('div', { className: 'ok-ind' }, room.indicator ? tileEl(room.indicator) : el('span', { className: 'tile empty' }), el('small', { textContent: 'gösterge' })),
      el('div', { className: 'ok-info' }, el('strong', { textContent: room.okey ? `Okey: ${['Kırmızı', 'Sarı', 'Mavi', 'Siyah'][room.okey.color]} ${room.okey.num}` : 'Okey 101' }), el('small', { textContent: 'Açmak için 101 sayı ya da 5 çift' })));

    const melds = el('div', { className: 'ok-melds' }, ...(room.melds.length ? room.melds.map((m, i) => {
      const box = el('button', { type: 'button', className: `ok-meld${ok.selected.size && room.myTurn && room.opened ? ' can' : ''}`, title: 'Seçili taşları bu pere işle' },
        el('i', { textContent: room.seats[m.owner]?.name ?? '' }), ...m.tiles.map((t) => tileEl(t, 'sm')));
      box.addEventListener('click', () => {
        if (!ok.selected.size) return say('Önce işlemek istediğin taşları seç.');
        act(room.id, 'add', { meld: i, tiles: sel() });
        ok.selected.clear();
      });
      return box;
    }) : [el('p', { className: 'hint', textContent: 'Açılan perler burada görünür.' })]));

    const groups = el('div', { className: 'ok-groups' }, ...ok.groups.map((g, gi) => {
      const box = el('button', { type: 'button', className: 'ok-group', title: 'Grubu boz' }, ...g.map((id) => tileEl(hand.get(id), 'sm')));
      box.addEventListener('click', () => { ok.groups.splice(gi, 1); redraw(); });
      return box;
    }));

    const rack = el('div', { className: 'ok-rack' }, ...ok.order.filter((id) => !grouped.has(id)).map((id) => {
      const t = hand.get(id);
      const node = tileEl(t, `${ok.selected.has(id) ? 'sel' : ''}${room.took === id ? ' took' : ''}`);
      node.addEventListener('click', () => {
        if (ok.selected.has(id)) ok.selected.delete(id);
        else ok.selected.add(id);
        sfx.chip();
        redraw();
      });
      return node;
    }));

    const sortBy = (kind) => {
      const val = (id) => hand.get(id);
      ok.order.sort((a, b) => {
        const x = val(a);
        const y = val(b);
        const xc = x.f ? 9 : x.c;
        const yc = y.f ? 9 : y.c;
        return kind === 'color' ? xc - yc || x.n - y.n : x.n - y.n || xc - yc;
      });
      redraw();
    };

    const controls = el('div', { className: 'pcontrols ok-controls' });
    if (room.phase === 'playing' && room.mySeat >= 0) {
      const timer = el('div', { className: 'turn-bar' });
      if (room.myTurn) {
        timer.dataset.deadline = String(room.deadline);
        timer.dataset.total = String(room.turnMs);
        controls.append(timer);
      }
      controls.append(btn('Renge göre', () => sortBy('color'), 'ghost mini'), btn('Sayıya göre', () => sortBy('num'), 'ghost mini'));
      controls.append(btn('Per Ayır', () => {
        if (ok.selected.size < 2) return say('Bir per için en az 2 taş seç (çift için 2, seri/grup için 3+).');
        ok.groups.push(sel());
        ok.selected.clear();
        redraw();
      }, 'ghost'));
      if (room.myTurn) {
        if (!room.drawn) controls.append(btn('Taş Çek', () => act(room.id, 'draw', { from: 'deck' }), 'pk call'));
        else {
          if (ok.groups.length) controls.append(btn(room.opened ? 'Perleri Aç' : 'Elini Aç', () => act(room.id, 'open', { groups: ok.groups }), 'pk raise'));
          if (room.took != null) controls.append(btn('Geri Bırak', () => act(room.id, 'untake'), 'ghost'));
          controls.append(btn('Taş At', () => {
            if (ok.selected.size !== 1) return say('Atmak için tek bir taş seç.');
            act(room.id, 'discard', { tile: sel()[0] });
            ok.selected.clear();
          }, 'pk fold'));
        }
        controls.append(el('p', { className: 'hint', textContent: !room.drawn ? 'Desteden çek ya da solundakinin attığı taşa tıkla.' : room.opened ? 'İstersen taş işle (taşı seç, pere tıkla), sonra bir taş at.' : 'Taşları seçip Per Ayır; toplam 101 olunca Elini Aç. Sonra bir taş at.' }));
      } else controls.append(el('p', { className: 'hint', textContent: `Sıra: ${room.players.find((p) => p.seat === room.turn)?.name ?? ''}` }));
    }

    root.replaceChildren(
      roomHead(room, data, root, [...resign(room), stakeTag(room)]),
      ...(room.phase === 'waiting' || !room.players.length ? [players(room)] : [opp, center, melds, groups, rack]),
      controls, waitingBar(room), roomLog(room.log), pastBox('turn', room.past));
    resultSound(room, root);
  }

  return { drawChess, drawLabirent, drawOkey };
}
