import { initBoards } from './boards.js';

// Oyun ekranları: dokuz oyunun ortak kabuğu (üst satır, oyun alanı, durum şeridi, aksiyon çubuğu),
// lobi, canlı izleme ve masa çizimleri (poker, blackjack masası, zar, Tayyare, rulet).
// Bütün kararlar sunucudadır; burası yalnızca gösterir ve hamleyi iletir.
export function initTables(ctx) {
  const { api, $, el, fmt, say, setBalance, setStatus, sfx, cardEl, avatarImg, betValue, guarded, limits, myId } = ctx;
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
  const x2 = (m) => `${m.toFixed(2).replace('.', ',')}×`;
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '±0');

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
      if (current?.table === id) soloIntro(current.game, current.root, false);
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
  const face = (id) => (isBot(id) ? el('img', { src: 'emojis/bot.png', alt: '' }) : avatarImg(id, ''));
  function avatar(id, extra = '') {
    const box = el('div', { className: `seat-avatar ${extra}${isBot(id) ? ' bot' : ''}` });
    box.append(face(id));
    return box;
  }
  /** Avatarın çevresindeki sıra süresi halkası */
  const timed = (node, room) => {
    node.dataset.deadline = String(room.deadline);
    node.dataset.total = String(room.turnMs);
    return node;
  };

  // ───────────────────────── Ortak oyun kabuğu ─────────────────────────
  const GAME = {
    blackjack: ['Blackjack', 'kart.png'], poker: ['Poker', 'maca.png'], tayyare: ['Tayyare', 'tayyare.svg'], roulette: ['Rulet', 'oyun.png'],
    zar: ['Zar Düellosu', 'zar.svg'], slot: ['Slot', 'slot_yedi.png'], satranc: ['Satranç', 'satranc.svg'], okey: ['Okey 101', 'okey.svg'], labirent: ['Karia Labirent', 'labirent.svg'],
  };
  const BET_GAMES = new Set(['blackjack', 'tayyare', 'roulette', 'slot']);

  /** Kabuğun iskeleti bir kez kurulur; sonraki çizimlerde yalnızca içerikler değişir (bahis kutusu ve Solo/Online yerinde kalır) */
  function shell(root, game) {
    if (root._gs?.game === game) return root._gs;
    const [name, icon] = GAME[game];
    const meta = el('span', { className: 'gs-meta' });
    const tools = el('div', { className: 'gs-tools' });
    const mode = el('span', { className: 'gs-mode' });
    const rules = el('button', { type: 'button', className: 'gs-icon', title: 'Nasıl oynanır?', textContent: '?' });
    rules.dataset.rules = '';
    const stage = el('div', { className: 'gs-stage' });
    const status = el('div', { className: 'gs-status' });
    const left = el('span', { className: 'gs-left' });
    const bet = el('div', { className: 'gs-bet' }, left);
    const main = el('div', { className: 'gs-main' });
    const side = el('div', { className: 'gs-side' });
    const bar = el('div', { className: 'gs-bar' }, bet, main, side);
    root.replaceChildren(
      el('header', { className: 'gs-head' },
        el('div', { className: 'gs-title' }, el('img', { src: `emojis/${icon}`, alt: '' }), el('strong', { textContent: name }), meta),
        el('div', { className: 'gs-right' }, tools, mode, rules)),
      stage, status, bar);
    root._gs = { game, meta, tools, mode, stage, status, bet, left, main, side, bar };
    return root._gs;
  }

  /**
   * Bir oyun ekranını çizer. Her oyun aynı parçaları doldurur:
   * meta (üstteki bilgi), tools (üstteki küçük butonlar), stage (oyun alanı), status (durum şeridi),
   * left (çubuğun solu), main (ana butonlar), side (ikincil butonlar), bet (bahis kutusu görünsün mü)
   */
  function paint(root, game, { meta = '', tools = [], stage = [], stageClass = '', status = '', left = [], main = [], side = [], bet = false, myTurn = false } = {}) {
    const gs = shell(root, game);
    gs.meta.textContent = meta;
    gs.tools.replaceChildren(...tools);
    gs.stage.className = `gs-stage${stageClass ? ` ${stageClass}` : ''}`;
    gs.stage.replaceChildren(...stage);
    setStatus(gs.status, status);
    gs.left.replaceChildren(...left);
    gs.main.replaceChildren(...main);
    gs.side.replaceChildren(...side);
    gs.bar.classList.toggle('my-turn', myTurn);
    gs.bar.hidden = !(bet || left.length || main.length || side.length); // izlerken boş çubuk görünmesin
    if (root.closest('[data-panel]')?.dataset.panel === activeGame) mountShared(gs, bet);
    return gs;
  }

  /** Solo/Online düğmesi ve bahis kutusu tek tanedir: açık oyunun kabuğuna taşınır */
  function mountShared(slots, bet) {
    const sw = $('mode-switch');
    const bb = $('betbar');
    if (slots.mode && sw.parentElement !== slots.mode) slots.mode.append(sw);
    sw.hidden = false;
    if (bet) {
      if (bb.parentElement !== slots.bet) slots.bet.prepend(bb);
      bb.hidden = false;
    } else if (bb.parentElement === slots.bet) bb.hidden = true;
  }
  const staticSlots = (node) => ({ mode: node.querySelector('.gs-mode'), bet: node.querySelector('.gs-bet') });

  /** Masa oyunlarında üst satır: masa bilgisi, + Bot, kalk / masalara dön */
  function headFor(room, root, stakeText) {
    const seated = room.mySeat >= 0;
    const solo = room.id.startsWith('solo-');
    const bots = room.seats.filter((s) => s && isBot(s.id)).length;
    const tools = seated ? [
      ...(room.seats.some((s) => !s) ? [btn('+ Bot', () => act(room.id, 'bot'), 'hbtn add')] : []),
      ...(bots && !solo ? [btn('Botları Kaldır', () => act(room.id, 'kickbots'), 'hbtn')] : []),
      btn(solo ? 'Oyundan Çık' : 'Masadan Kalk', () => act(room.id, 'leave'), 'hbtn danger'),
    ] : [btn('‹ Masalar', () => showLobby(current.game, root), 'hbtn')];
    return { meta: solo ? `Solo • ${stakeText}` : `${room.name} • ${stakeText}`, tools };
  }
  const lastLog = (room) => room.log?.at(-1) ?? '';

  // ── Nasıl oynanır: her oyunun adımları, ödemeleri ve masanın son elleri ──
  const RULES = {
    blackjack: {
      steps: [
        'Bahsini seç ve <b>Dağıt</b>’a bas. Sana ve krupiyeye ikişer kart gelir.',
        'Amaç: kartlarının toplamı 21’i geçmeden krupiyeninkinden yüksek olsun. Resimli kartlar 10, As 1 ya da 11 sayılır.',
        '<b>Kart Çek</b> yeni kart verir, <b>Dur</b> elini bitirir. İlk iki kartta <b>İkiye Katla</b>, eş iki kartla <b>İkiye Ayır</b> ya da <b>Teslim Ol</b> seçebilirsin.',
        'Krupiye 17’ye ulaşana kadar kart çeker. Online’da aynı krupiyeye karşı 6 kişiye kadar oynanır.'],
      pays: [['kupa', 'Kazanç', '2×'], ['kart', 'Blackjack', '2,5×'], ['yenile', 'Beraberlik', 'İade'], ['kalkan', 'Sigorta (krupiye As)', '2:1'], ['bayrak', 'Teslim', 'Yarısı döner']],
    },
    poker: {
      steps: [
        'Masaya fişle oturursun; kalkınca kalan fişin cüzdanına döner. Solo’da 3 bota karşı oynarsın.',
        'Herkese 2 kapalı kart gelir, ortaya sırayla 5 açık kart açılır. Kendi kartların ve ortadakilerle en iyi 5’li eli kurarsın.',
        'Sıra sana gelince: <b>Pas</b> (eli bırak), <b>Kontrol</b> (bahis yoksa bekle), <b>Gör</b> (bahsi eşitle), <b>Yükselt</b> ya da <b>Hepsi</b>.',
        'El sıralaması: Floş Royal › Kent Renk › Kare › Full › Renk › Kent › Üçlü › İki Çift › Çift › Yüksek Kart.'],
      pays: [['tac', 'Floş Royal / Kent Renk', 'Pot'], ['kupa', 'Kare / Full / Renk', 'Pot'], ['arkadaslar', 'Masa', '2-6 oyuncu'], ['coin', 'Kalkınca', 'Fişin cüzdana döner']],
    },
    tayyare: {
      steps: [
        'Kalkıştan önce bahsini seç ve <b>Bahis Koy</b>’a bas.',
        'Uçak kalkınca çarpan 1,00×’dan yükselir. <b>ÇEK</b>’e bastığın anda bahsin × çarpan kadar kazanırsın.',
        'Uçak düşmeden çekmezsen bahsin gider. Uçağın ne zaman düşeceği her uçuşta rastgeledir.',
        '<b>Otomatik çek</b> kutusuna bir çarpan yazarsan (ör. 2,00) o çarpanda kendiliğinden çekilir.'],
      pays: [['roket', 'Düşmeden çek', 'Bahis × çarpan'], ['yildiz', 'En yüksek', '1000×'], ['ayarlar', 'Otomatik çek', 'Hedefte öder']],
    },
    roulette: {
      steps: [
        'Üstten bahis türünü seç ve masadaki sayıya tıkla. Kırmızı/Siyah, Tek/Çift, 1-18/19-36, düzine ve sütunlara da doğrudan tıklayabilirsin.',
        'Her tıklama, seçtiğin bahis tutarı kadar fiş koyar. Sağ tık ya da <b>Geri Al</b> fişi kaldırır.',
        '<b>Çevir</b>’e bas. Online’da masadaki herkesin bahsi aynı çarkta döner.',
        'Top senin sayılarından birine düşerse çarpanı kadar kazanırsın.'],
      pays: [['elmas', 'Tek sayı', '36×'], ['yildiz', 'Ayrık / Sokak', '18× / 12×'], ['madalya', 'Köşe / Altılı', '9× / 6×'], ['kalp', 'Kırmızı / Siyah / Tek / Çift', '2×'], ['zil', 'Düzine / Sütun', '3×']],
    },
    zar: {
      steps: [
        'Boş bir koltuğa otur ve <b>Hazırım</b>’a bas; giriş ücretin pota eklenir.',
        'Herkes iki zar atar; toplamı en yüksek olan potun hepsini alır.',
        'Berabere kalanlar yeniden atar. Solo’da 2 bota karşı oynarsın.'],
      pays: [['kupa', 'En yüksek zar', 'Potun hepsi'], ['yenile', 'Beraberlik', 'Yeniden atış'], ['arkadaslar', 'Masa', '2-6 oyuncu']],
    },
    slot: {
      steps: [
        'Bahsini seç ve <b>Çevir</b>’e bas.',
        'Üç makarada aynı simgeden üç tane gelirse simgenin çarpanı kadar, herhangi iki aynı simge gelirse 1,5× kazanırsın.',
        'Online’da sunucudaki son kazançları canlı görürsün.'],
      pays: [['slot_yedi', 'Üçlü', '50×'], ['elmas', 'Üçlü', '20×'], ['zil', 'Üçlü', '10×'], ['kalp', 'Üçlü', '5×'], ['hediye', 'Üçlü', '4×'], ['kurabiye', 'Üçlü', '3×'], ['coin', 'Herhangi ikili', '1,5×']],
    },
    satranc: {
      steps: [
        'Masaya otur ve <b>Hazırım</b>’a bas. Renkler kurayla belirlenir, beyaz başlar.',
        'Sıran gelince taşına tıkla: gidebileceği kareler işaretlenir. İşaretli kareye tıklayıp hamleni yap.',
        'Şah mat eden kazanır. Pes eden ya da süresi dolan kaybeder.',
        '<b>Berabere Teklif</b> edebilirsin; rakip kabul ederse girişler geri döner.'],
      pays: [['kupa', 'Kazanırsan', 'Potun hepsi (2×)'], ['yenile', 'Berabere', 'Giriş geri'], ['arkadaslar', 'Masa', '2 oyuncu']],
    },
    okey: {
      steps: [
        '4 kişi oynanır, boş koltuklara bot oturur. Herkese 21, başlayana 22 taş dağıtılır.',
        'Sıran gelince ortadaki <b>desteden</b> ya da <b>solundakinin attığı</b> taştan bir taş çek: tıkla ya da ıstakana sürükle.',
        'Taşlarını sürükleyerek diz. Aralarında boşluk olmayan taşlar bir per sayılır: aynı renkte sıralı sayılar (4-5-6) ya da farklı renklerde aynı sayı (7-7-7).',
        'Perlerinin toplamı <b>101</b>’e ulaşınca ya da <b>5 çiftin</b> olunca <b>Elini Aç</b>. Açtıktan sonra masadaki perlere taş işleyebilirsin.',
        'Her turu bir taş atarak bitir: taşı <b>At</b> kutusuna sürükle ya da seçip <b>Taş At</b>’a bas. Elini ilk bitiren potu alır.',
        'Göstergenin bir üstü <b>okey</b>dir, her taşın yerine geçer. ★ sahte okeydir, okeyin kendisi yerine sayılır.'],
      pays: [['kupa', 'Elini bitiren', 'Potun hepsi (4×)'], ['kart', 'Açma', '101 ya da 5 çift'], ['arkadaslar', 'Masa', '4 oyuncu']],
    },
    labirent: {
      steps: [
        'İki kişi oynanır. Amaç, piyonunu karşı kenara ilk ulaştırmak.',
        'Sıranda ya parlayan karelerden birine yürü ya da iki kare arasındaki oluğa <b>engel</b> koy. Her oyuncunun 10 engeli var.',
        'Engel rakibin yolunu uzatır ama yolu tamamen kapatamaz.'],
      pays: [['kupa', 'Karşıya ilk varan', 'Potun hepsi (2×)'], ['kalkan', 'Hamle', 'Yürü ya da engel koy'], ['arkadaslar', 'Masa', '2 oyuncu']],
    },
  };

  function pastItems(game, past = []) {
    return past.map((p) => {
      if (game === 'poker') return [p.winners.map((w) => w.name).join(', '), `+${fmt(p.winners.reduce((a, w) => a + w.amount, 0))}${p.winners[0]?.hand ? ` • ${p.winners[0].hand}` : ''}`];
      if (game === 'zar') return [p.winners.join(', '), `Pot ${fmt(p.pot)} • ${p.best} attı`];
      if (game === 'blackjack') return [`Krupiye ${p.dealer}`, p.players.map((x) => `${x.name.replace(' (Bot)', '')} ${signed(x.net)}`).join(' • ')];
      return [p.winners.length ? p.winners.join(', ') : 'Berabere', `${p.reason} • Pot ${fmt(p.pot)}`];
    });
  }

  function openRules() {
    const game = activeGame;
    if (!game) return;
    const [name, icon] = GAME[game];
    const rule = RULES[game];
    const steps = el('ol');
    for (const s of rule.steps) steps.append(Object.assign(document.createElement('li'), { innerHTML: s })); // sabit, bizim yazdığımız metin
    const room = watching?.last?.room;
    const past = room && current?.table === room.id && current.game === game ? pastItems(game, room.past) : [];
    $('rules-body').replaceChildren(
      el('h3', {}, el('img', { src: `emojis/${icon}`, alt: '' }), name),
      el('h4', { textContent: 'Nasıl oynanır' }), steps,
      el('h4', { textContent: 'Ödemeler' }),
      el('div', { className: 'pay' }, ...rule.pays.map(([img, label, value]) => el('div', {}, el('img', { src: `emojis/${img}.png`, alt: '' }), el('span', { textContent: label }), el('b', { textContent: value })))),
      ...(past.length ? [el('h4', { textContent: 'Bu masada son eller' }), el('div', { className: 'past-list' }, ...past.map(([a, b]) => el('div', { className: 'past-item' }, el('b', { textContent: a }), el('span', { textContent: b }))))] : []));
    $('rules').showModal();
  }
  document.addEventListener('click', (event) => { if (event.target.closest('[data-rules]')) openRules(); });
  $('rules').addEventListener('click', (event) => { if (event.target === $('rules')) $('rules').close(); }); // dışına tıklayınca kapanır

  // ───────────────────────── Lobi (online masalar) ─────────────────────────
  const LOBBY = {
    poker: { sub: "Texas Hold'em • 2-6 kişi", stake: 'Kör' },
    blackjack: { sub: 'Aynı krupiyeye karşı 6 kişiye kadar', stake: 'Bahis' },
    zar: { sub: 'En yüksek atan potu alır • 2-6 kişi', stake: 'Giriş' },
    satranc: { sub: 'İki kişilik, kazanan iki girişi alır', stake: 'Giriş' },
    okey: { sub: '4 kişilik • eksik koltuklara + Bot', stake: 'Giriş' },
    labirent: { sub: 'İki kişilik koridor yarışı', stake: 'Giriş' },
  };
  let lobbyTimer = 0;
  let current = null; // açık oyun kökü: { game, root, table, solo }

  async function showLobby(game, root) {
    stop();
    clearTimeout(lobbyTimer);
    current = { game, root, table: null };
    let data;
    try {
      data = await api(`/tables?game=${game}`);
    } catch (error) {
      paint(root, game, { meta: 'Online', stage: [el('p', { className: 'room-empty', textContent: error.message })], status: { text: 'Masalar yüklenemedi.', tone: 'lose' } });
      return;
    }
    if (current?.root !== root || current.table) return;
    if (data.seatedAt?.startsWith(`${game}-`)) return openTable(game, data.seatedAt, root);
    const info = LOBBY[game];
    const stakes = game === 'poker' ? data.blinds.map((b) => [b, `${fmt(b)}/${fmt(b * 2)}`]) : game === 'zar' ? data.antes.map((a) => [a, fmt(a)]) : data.stakes?.length ? data.stakes.map((a) => [a, fmt(a)]) : null;
    const prev = root._gs?.main.querySelector('.stake-select')?.value; // 5 sn'de bir yenilenirken seçim kaybolmasın
    const select = stakes ? el('select', { className: 'stake-select', title: `${info.stake} seç` }, ...stakes.map(([v, label]) => el('option', { value: String(v), textContent: `${info.stake} ${label}` }))) : null;
    if (select && prev) select.value = prev;
    const create = btn('Yeni Masa Aç', () => guarded(async () => {
      const made = await api('/tables', { game, stake: select ? Number(select.value) : null });
      openTable(game, made.id, root);
    }), 'pk gold');
    const cards = data.tables.map((t) => {
      const seats = el('div', { className: 'lobby-seats' }, ...Array.from({ length: t.max }, (_, i) => el('i', { className: i < t.players ? 'on' : '' })));
      const c = el('button', { type: 'button', className: 'lobby-card' },
        el('div', { className: 'lobby-felt' }, el('img', { src: `emojis/${GAME[game][1]}`, alt: '' })),
        el('div', { className: 'lobby-info' },
          el('strong', { textContent: t.name }),
          el('small', { textContent: `${info.stake} ${t.stake} • ${t.players}/${t.max} kişi${t.playing ? ' • Oyun sürüyor' : ''}` }),
          seats),
        el('span', { className: 'lobby-go', textContent: t.players >= t.max ? 'İzle' : 'Otur' }));
      c.addEventListener('click', () => openTable(game, t.id, root));
      return c;
    });
    paint(root, game, {
      meta: `Online • ${info.sub}`,
      stage: [el('div', { className: 'lobby' }, ...(cards.length ? cards : [el('div', { className: 'lobby-empty' }, el('strong', { textContent: 'Henüz açık masa yok' }), el('span', { textContent: 'Aşağıdan bir masa aç, arkadaşların da otursun.' }))]))],
      stageClass: 'lobby-stage',
      status: { text: cards.length ? 'Bir masaya tıklayıp otur ya da yeni masa aç.' : 'İlk masayı sen aç!', tone: 'go' },
      main: [...(select ? [select] : []), create],
    });
    lobbyTimer = setTimeout(() => { if (current?.root === root && !current.table && root.isConnected && !root.closest('[hidden]')) showLobby(game, root); }, 5000);
  }

  function openTable(game, id, root) {
    clearTimeout(lobbyTimer);
    current = { game, root, table: id };
    paint(root, game, { stage: [el('p', { className: 'room-empty', textContent: 'Masaya bağlanılıyor...' })], status: 'Bağlanılıyor...' });
    const draw = { poker: drawPoker, blackjack: drawBlackjackTable, zar: drawDice, satranc: boards.drawChess, okey: boards.drawOkey, labirent: boards.drawLabirent }[game];
    const solo = id.startsWith('solo-');
    watch(id, (room, data) => {
      // Solo masada artık oturmuyorsan (süre doldu, kalktın) masa yerine tanıtım ekranı gösterilir
      if (solo && room.mySeat < 0) {
        if (data.balance !== undefined) setBalance(data.balance);
        return soloIntro(game, root, false);
      }
      draw(room, data, root);
    }, () => {
      if (solo) return soloIntro(game, root, false);
      say('Masa kapandı.');
      showLobby(game, root);
    });
  }

  const SPOTS = 6;
  /** Benim koltuğum hep altta ortada */
  const spot = (seat, mySeat) => (seat - (mySeat >= 0 ? mySeat : 0) + SPOTS) % SPOTS;

  // ───────────────────────── Poker ─────────────────────────
  let raiseTo = 0;
  let raiseTurn = '';
  let raiseOpen = ''; // Yükselt'e ilk basışta tutar seçici açılır; açık kaldığı sıra
  let lastPokerTurn = '';
  let lastBoard = 0;

  function drawPoker(room, data, root) {
    setBalance(data.balance);
    if (room.id.startsWith('solo-') && room.mySeat < 0) return soloIntro('poker', root, false);
    const seated = room.mySeat >= 0;
    const table = el('div', { className: 'ptable' });
    table.append(el('div', { className: 'pfelt' },
      el('div', { className: 'pboard' }, ...room.board.map((c, i) => card(c, `${room.id}-b${i}`)), ...Array.from({ length: 5 - room.board.length }, () => el('div', { className: 'card slot' }))),
      el('div', { className: 'ppot' }, el('img', { src: 'emojis/coin.png', alt: '' }), el('span', { textContent: room.pot ? `Pot ${fmt(room.pot)}` : `Kör ${fmt(room.sb)}/${fmt(room.bb)}` }))));
    if (room.board.length > lastBoard) sfx.card(room.board.length - lastBoard);
    lastBoard = room.board.length;

    room.seats.forEach((s, i) => {
      const pos = spot(i, room.mySeat);
      if (!s) {
        if (seated && room.id.startsWith('solo-')) return; // solo masada boş koltuk gösterilmez
        if (seated) return table.append(el('div', { className: `pseat empty s${pos}` }));
        return table.append(el('div', { className: `pseat empty s${pos}` }, btn('Otur', () => drawBuyIn(room, i, root), 'sit')));
      }
      const turn = room.turn === i && room.phase !== 'showdown';
      const won = room.result?.winners.find((w) => w.seat === i);
      const ring = avatar(s.id, turn ? 'timer' : '');
      if (turn) timed(ring, room);
      const tag = won ? `+${fmt(won.amount)}${won.hand ? ` • ${won.hand}` : ''}` : s.hand ?? (s.folded ? 'Pas' : s.allIn ? 'Hepsi' : s.sittingOut ? 'Ara verdi' : '');
      table.append(el('div', { className: `pseat s${pos}${turn ? ' turn' : ''}${s.folded ? ' folded' : ''}${s.id === myId() ? ' me' : ''}${won ? ' winner' : ''}` },
        ring,
        el('div', { className: 'seat-plate' }, el('strong', { textContent: s.name }), el('span', { textContent: fmt(s.stack) })),
        ...(tag ? [el('em', { className: `seat-tag${won ? ' win' : ''}`, textContent: tag })] : []),
        el('div', { className: 'seat-cards' }, ...s.cards.map((c, k) => card(c, `${room.id}-s${i}-${k}`))),
        ...(s.bet ? [el('div', { className: 'seat-bet' }, el('img', { src: 'emojis/coin.png', alt: '' }), el('span', { textContent: short(s.bet) }))] : []),
        ...(room.button === i && room.phase !== 'waiting' ? [el('b', { className: 'dealer-btn', textContent: 'D' })] : [])));
    });

    const myTurnKey = room.controls ? `${room.id}-${room.turn}-${room.deadline}` : '';
    if (myTurnKey && myTurnKey !== lastPokerTurn) sfx.chip();
    lastPokerTurn = myTurnKey;
    const mine = room.result?.winners.find((w) => room.seats[w.seat]?.id === myId());
    if (mine && !root.dataset.cheered) {
      root.dataset.cheered = '1';
      sfx.win();
    }
    if (!room.result) delete root.dataset.cheered;

    let main = [];
    if (seated && room.controls) main = pokerControls(room);
    else if (seated) main = [room.sittingOut ? btn('Oyuna Dön', () => act(room.id, 'back'), 'pk go') : btn('Ara Ver', () => act(room.id, 'sitout'), 'pk soft sm')];
    const buyBox = root._gs?.game === 'poker' ? root._gs.stage.querySelector('.buyin') : null;
    paint(root, 'poker', {
      ...headFor(room, root, `Kör ${fmt(room.sb)}/${fmt(room.bb)}`),
      stage: [table, ...(buyBox && !seated ? [buyBox] : [])],
      status: pokerStatus(room, mine),
      main,
      myTurn: Boolean(room.controls),
    });
  }

  function pokerStatus(room, mine) {
    const log = room.myHand ? `Elin: ${room.myHand}` : lastLog(room);
    if (room.mySeat < 0) return { text: room.seats.some((s) => !s) ? 'Boş bir koltuğa tıkla ve otur.' : 'Masa dolu, izliyorsun.', tone: 'go', log };
    if (room.result) {
      const text = room.result.winners.map((w) => `${w.name} kazandı${w.hand ? ` (${w.hand})` : ''}`).join(' • ');
      return { text: mine ? `Potu aldın! +${fmt(mine.amount)}${mine.hand ? ` • ${mine.hand}` : ''}` : text, tone: mine ? 'win' : 'lose', log };
    }
    if (room.phase === 'waiting') return { text: room.seats.filter(Boolean).length < 2 ? 'En az 2 oyuncu gerekli. Boş koltuğa + Bot ekleyebilirsin.' : 'Oyuncular hazırlanıyor...', log };
    if (room.phase === 'starting') return { text: countdown('Yeni el {s} sn sonra başlıyor', room.startsAt), log };
    const c = room.controls;
    if (c) return { text: c.canCheck ? 'Sıra sende: Kontrol et, bahis aç ya da Pas geç.' : `Sıra sende: ${fmt(c.toCall)} Gör, Yükselt ya da Pas geç.`, tone: 'turn', deadline: room.deadline, total: room.turnMs, log };
    const name = room.seats[room.turn]?.name;
    return { text: name ? `Sıra: ${name}` : 'El sürüyor...', deadline: room.deadline, total: room.turnMs, log };
  }

  function pokerControls(room) {
    const c = room.controls;
    const key = `${room.id}-${room.turn}-${room.deadline}`;
    if (raiseTurn !== key) {
      raiseTurn = key;
      raiseTo = c.minTo;
    }
    raiseTo = Math.min(Math.max(raiseTo, c.minTo), c.maxTo);
    const out = [btn('Pas', () => act(room.id, 'fold'), 'pk no')];
    out.push(c.canCheck ? btn('Kontrol', () => act(room.id, 'check'), 'pk go') : btn(`Gör ${fmt(c.toCall)}`, () => act(room.id, 'call'), 'pk go'));
    if (c.canRaise && c.maxTo > c.currentBet) {
      const range = el('input', { type: 'range', min: String(c.minTo), max: String(c.maxTo), step: String(room.sb), value: String(raiseTo) });
      const label = el('b', { textContent: fmt(raiseTo) });
      const verb = c.currentBet ? 'Yükselt' : 'Bahis Aç';
      // Sade görünüm: tutar seçici (Min / ½ Pot / Pot / kaydırıcı) Yükselt'e ilk basışta açılır, ikinci basış onaylar
      const open = () => raiseOpen === key;
      const raiseText = () => (open() ? `${verb} ${fmt(raiseTo)}` : verb);
      const raise = btn(raiseText(), () => {
        if (!open()) {
          raiseOpen = key;
          box.classList.remove('closed');
          raise.textContent = raiseText();
          return;
        }
        act(room.id, raiseTo >= c.maxTo ? 'allin' : 'raise', { amount: raiseTo });
      }, 'pk gold');
      const sync = () => {
        label.textContent = fmt(raiseTo);
        raise.textContent = raiseText();
      };
      range.addEventListener('input', () => {
        raiseTo = Number(range.value);
        sync();
      });
      const preset = (text, value) => btn(text, () => {
        raiseTo = Math.min(Math.max(Math.floor(value), c.minTo), c.maxTo);
        range.value = String(raiseTo);
        sync();
      }, 'mini');
      const box = el('div', { className: `raise-box${open() ? '' : ' closed'}` },
        el('div', { className: 'raise-presets' }, preset('Min', c.minTo), preset('½ Pot', c.currentBet + c.pot / 2), preset('Pot', c.currentBet + c.pot), label),
        range);
      out.push(box, raise);
    }
    out.push(btn('Hepsi', () => act(room.id, 'allin'), 'pk soft'));
    return out;
  }

  function drawBuyIn(room, seat, root) {
    const stage = root._gs.stage;
    stage.querySelector('.buyin')?.remove();
    const value = Math.min(room.maxBuy, Math.max(room.minBuy, Math.min(room.minBuy * 5, ctx.balance())));
    const input = el('input', { inputMode: 'numeric', value: String(value) });
    const box = el('div', { className: 'buyin' },
      el('span', { textContent: `Masaya kaç coinle oturacaksın? (${fmt(room.minBuy)} - ${fmt(room.maxBuy)})` }),
      input,
      btn('Otur', () => act(room.id, 'join', { seat, buyIn: Math.floor(Number(input.value.replace(/\D/g, '')) || 0) }), 'pk go sm'),
      btn('Vazgeç', () => box.remove(), 'pk soft sm'));
    stage.append(box);
    input.focus();
  }

  // ───────────────────────── Blackjack masası (online) ─────────────────────────
  let lastBjPhase = '';
  const BJ_OUT = { blackjack: 'Blackjack!', win: 'Kazandın', push: 'Berabere', lose: 'Kaybettin', bust: "21'i geçtin", surrender: 'Teslim oldun' };
  function drawBlackjackTable(room, data, root) {
    setBalance(data.balance);
    const seated = room.mySeat >= 0;
    const me = seated ? room.seats[room.mySeat] : null;
    const table = el('div', { className: 'bjtable' });
    table.append(el('div', { className: 'bj-dealer' },
      el('h3', {}, 'Krupiye', ...(room.dealerTotal != null ? [el('span', { className: 'total', textContent: String(room.dealerTotal) })] : [])),
      el('div', { className: 'cards' }, ...room.dealer.map((c, i) => card(c, `${room.id}-d${i}`)))));
    const OUT = { blackjack: 'Blackjack!', win: 'Kazandı', push: 'Berabere', lose: 'Kaybetti', bust: 'Battı', surrender: 'Teslim oldu' };
    const row = el('div', { className: 'bj-seats' });
    room.seats.forEach((s, i) => {
      const pos = spot(i, room.mySeat);
      if (!s) {
        row.append(el('div', { className: `bseat empty b${pos}` }, ...(seated ? [] : [btn('Otur', () => act(room.id, 'join', { seat: i }), 'sit')])));
        return;
      }
      const turn = room.turn === i;
      const ring = avatar(s.id, turn ? 'timer' : '');
      if (turn) timed(ring, room);
      row.append(el('div', { className: `bseat b${pos}${turn ? ' turn' : ''}${s.id === myId() ? ' me' : ''}${s.outcome ? ` o-${s.outcome}` : ''}` },
        el('div', { className: 'seat-cards' }, ...s.cards.map((c, k) => card(c, `${room.id}-s${i}-${k}`))),
        ...(s.total != null ? [el('span', { className: 'total', textContent: String(s.total) })] : []),
        ...(s.bet ? [el('div', { className: 'seat-bet' }, el('img', { src: 'emojis/coin.png', alt: '' }), el('span', { textContent: short(s.bet) }))] : []),
        ring,
        el('div', { className: 'seat-plate' }, el('strong', { textContent: s.name })),
        ...(s.outcome ? [el('em', { className: `seat-tag${s.payout > s.bet ? ' win' : ''}`, textContent: `${OUT[s.outcome]}${s.payout > s.bet ? ` +${fmt(s.payout - s.bet)}` : ''}` })] : [])));
    });
    table.append(row);

    if (room.phase === 'result' && lastBjPhase !== 'result' && me?.outcome) sfx.result(me.payout - me.bet, me.bet);
    if (room.phase === 'playing' && lastBjPhase !== 'playing') sfx.card(3);
    lastBjPhase = room.phase;

    let status;
    let main = [];
    let bet = false;
    const log = lastLog(room);
    if (!seated) status = { text: 'Boş bir koltuğa tıklayıp otur.', tone: 'go', log };
    else if (room.controls) {
      status = { text: `Sıra sende: Kart Çek ya da Dur.${me?.total != null ? ` (Elin ${me.total})` : ''}`, tone: 'turn', deadline: room.deadline, total: room.turnMs, log };
      main = [btn('Kart Çek', () => act(room.id, 'hit'), 'pk go'), btn('Dur', () => act(room.id, 'stand'), 'pk gold'),
        ...(room.controls.canDouble ? [btn('İkiye Katla', () => act(room.id, 'double'), 'pk soft')] : []),
        ...(room.controls.canSurrender ? [btn('Teslim Ol', () => act(room.id, 'surrender'), 'pk no')] : [])];
    } else if (room.phase === 'betting' && !me.bet) {
      bet = true;
      status = { text: room.endsAt ? countdown('Bahsini koy • Kartlar {s} sn sonra dağıtılıyor', room.endsAt) : 'Bahsini seç ve Bahis Koy’a bas.', tone: 'turn', log };
      main = [btn(`Bahis Koy • ${fmt(betValue())}`, () => act(room.id, 'bet', { bet: betValue() }), 'pk gold big')];
    } else if (room.phase === 'betting') {
      status = { text: room.endsAt ? countdown('Bahsin hazır • Kartlar {s} sn sonra dağıtılıyor', room.endsAt) : 'Bahsin hazır, diğer oyuncular bekleniyor.', tone: 'go', log };
    } else if (room.phase === 'result' && me?.outcome) {
      const net = me.payout - me.bet;
      status = { text: `${BJ_OUT[me.outcome]} ${net ? signed(net) : ''}`.trim(), tone: net > 0 ? 'win' : net < 0 ? 'lose' : 'go', log: 'Yeni el birazdan başlıyor.' };
    } else if (room.phase === 'result') status = { text: 'Yeni el birazdan başlıyor.', log };
    else status = { text: `Sıra: ${room.seats[room.turn]?.name ?? 'krupiye'}`, deadline: room.deadline, total: room.turnMs, log };
    paint(root, 'blackjack', {
      ...headFor(room, root, `Bahis ${fmt(room.minBet)} - ${fmt(room.maxBet)} • 3:2 öder`),
      stage: [table], status, main, bet, myTurn: Boolean(room.controls),
    });
  }

  // ───────────────────────── Zar düellosu ─────────────────────────
  const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
  const die = (n, rolling = false) => el('div', { className: `die${rolling ? ' rolling' : ''}` }, ...Array.from({ length: 9 }, (_, i) => el('i', { className: PIPS[n]?.includes(i + 1) ? 'on' : '' })));
  let diceAnim = 0;
  let diceShown = '';
  let diceRunning = false;
  let dieBoxes = new Map(); // son çizimdeki zar kutuları; animasyon yeniden çizimde de doğru kutuya yazar

  function drawDice(room, data, root) {
    if (room.id.startsWith('solo-') && room.mySeat < 0) return soloIntro('zar', root, false);
    const seated = room.mySeat >= 0;
    const solo = room.id.startsWith('solo-');
    const table = el('div', { className: 'ztable' });
    table.append(el('div', { className: 'zcenter' }, el('div', { className: 'ppot' }, el('img', { src: 'emojis/coin.png', alt: '' }), el('span', { textContent: `Pot ${fmt(room.pot)}` }))));
    dieBoxes = new Map();
    room.seats.forEach((s, i) => {
      const pos = spot(i, room.mySeat);
      if (!s) {
        if (seated && solo) return; // solo masada boş koltuk gösterilmez
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

    const played = room.players.some((p) => p.id === myId());
    const iWon = Boolean(room.winner?.ids.includes(myId()));
    let status;
    const log = lastLog(room);
    if (!seated) status = { text: `Giriş ${fmt(room.ante)} coin. Boş bir koltuğa tıklayıp otur.`, tone: 'go', log };
    else if (room.phase === 'waiting') status = room.endsAt ? { text: countdown('Zarlar {s} sn sonra atılıyor', room.endsAt), tone: 'turn', log } : { text: room.ready ? 'Hazırsın. Diğer oyuncular bekleniyor...' : solo ? 'Hazırım’a bas, botlarla zarlar atılsın.' : 'Hazırım’a bas. Hazır olanlar en az 2 kişi olunca zarlar atılır.', tone: room.ready ? 'go' : 'turn', log };
    else if (room.phase === 'result' && room.winner) status = played
      ? { text: iWon ? `Potu aldın! +${fmt(room.winner.amount - room.ante)}` : `${room.winner.names.join(', ')} kazandı. ${signed(-room.ante)}`, tone: iWon ? 'win' : 'lose', log }
      : { text: `${room.winner.names.join(', ')} kazandı! +${fmt(room.winner.amount)}`, log };
    else status = { text: 'Zarlar atılıyor...', tone: 'go', log };
    const main = seated && room.phase === 'waiting'
      ? [room.ready ? btn('Hazır Değilim', () => act(room.id, 'unready'), 'pk soft') : btn(`Hazırım • ${fmt(room.ante)}`, () => act(room.id, 'ready'), 'pk gold big')]
      : [];
    paint(root, 'zar', { ...headFor(room, root, `Giriş ${fmt(room.ante)}`), stage: [table], status, main, myTurn: seated && room.phase === 'waiting' && !room.ready });
    setBalance(data.balance);
    if (room.phase === 'result' && room.winner && root.dataset.diceWin !== JSON.stringify(room.winner)) {
      root.dataset.diceWin = JSON.stringify(room.winner);
      if (played) sfx.result(iWon ? 1 : -1);
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

  // ───────────────────────── Tayyare ─────────────────────────
  const tay = { room: null, frame: 0, lastPhase: '' };

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
      if (room.phase === 'crashed') sfx.lose();
      tay.lastPhase = room.phase;
    }
    if (mine?.cashedAt && !prev?.me?.cashedAt) sfx.coins();

    $('tay-history').replaceChildren(...room.history.map((x) => el('span', { className: x >= 10 ? 'hot' : x >= 2 ? 'good' : '', textContent: x2(x) })));
    $('tay-bets').replaceChildren(
      el('h4', { textContent: `Bu uçuş • ${room.bets.length} oyuncu` }),
      ...(room.bets.length ? room.bets.map((b) => el('div', { className: `tay-bet${b.cashedAt ? ' won' : room.phase === 'crashed' ? ' lost' : ''}${b.id === myId() ? ' me' : ''}` },
        avatarImg(b.id, ''),
        el('span', { textContent: b.name }),
        el('b', { textContent: fmt(b.bet) }),
        el('em', { textContent: b.cashedAt ? `${x2(b.cashedAt)} • +${fmt(b.win)}` : room.phase === 'crashed' ? 'Düştü' : '' }))) : [el('p', { className: 'hint', textContent: 'Henüz bahis yok.' })]));
    tayLine(room);
    drawTayButton();
    if (!tay.frame) tay.frame = requestAnimationFrame(tayLoop);
  }

  /** Tayyare durum şeridi: ne yapman gerektiğini söyler */
  function tayLine(room) {
    const mine = room.me;
    const line = $('tay-line');
    if (room.phase === 'crashed') {
      if (mine?.cashedAt) return setStatus(line, { text: `${x2(mine.cashedAt)} ile çektin! +${fmt(mine.win - mine.bet)}`, tone: 'win', log: `Tayyare ${x2(room.crashAt)} ile düştü` });
      if (mine) return setStatus(line, { text: `Tayyare ${x2(room.crashAt)} ile düştü. ${signed(-mine.bet)}`, tone: 'lose' });
      return setStatus(line, { text: `Tayyare ${x2(room.crashAt)} ile düştü. Sonraki uçuşa bahis koyabilirsin.` });
    }
    if (room.phase === 'flying') {
      if (mine?.cashedAt) return setStatus(line, { text: `${x2(mine.cashedAt)} ile çektin! +${fmt(mine.win - mine.bet)}`, tone: 'win' });
      if (mine) return setStatus(line, { text: 'Uçak yükseliyor: düşmeden ÇEK’e bas!', tone: 'turn' });
      return setStatus(line, { text: 'Uçuş sürüyor. Sonraki uçuşa bahis koyabilirsin.' });
    }
    if (mine) return setStatus(line, { text: `Bahsin hazır (${fmt(mine.bet)}). Uçak kalkınca ÇEK’e basmayı unutma.`, tone: 'go' });
    setStatus(line, { text: 'Bahsini seç ve Bahis Koy’a bas. Uçak düşmeden çekersen kazanırsın.', tone: 'turn' });
  }

  function drawTayButton() {
    const room = tay.room;
    const b = $('tay-btn');
    const mine = room?.me;
    b.className = 'pk gold big';
    b.disabled = false;
    if (!room) return;
    if (room.phase === 'betting' || room.phase === 'idle') {
      if (mine) {
        b.textContent = `Geri Al • ${fmt(mine.bet)}`;
        b.className = 'pk no big';
        b.dataset.do = 'cancel';
      } else {
        b.textContent = `Bahis Koy • ${fmt(betValue())}`;
        b.dataset.do = 'bet';
      }
    } else if (room.phase === 'flying' && mine && !mine.cashedAt) {
      b.textContent = `ÇEK • ${fmt(Math.floor(mine.bet * tayMult(room)))}`;
      b.className = 'pk go big';
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
      multEl.textContent = x2(m);
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
    g.font = '12px system-ui';
    g.fillStyle = 'rgba(191,247,236,.5)';
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

  // ───────────────────────── Rulet ─────────────────────────
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const numColor = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
  const COLOR_TR = { green: 'yeşil', red: 'kırmızı', black: 'siyah' };
  const rl = { room: null, pending: new Map(), order: [], last: null, wheelDeg: 0, spunAt: 0, settledAt: 0, kind: 'tek', first: null };
  const KIND_HINT = { tek: 'Tek sayı: bir sayıya tıkla.', ayrik: 'Ayrık: yan yana iki sayıya sırayla tıkla.', sokak: 'Sokak: üç sayılık sütunun herhangi bir sayısına tıkla.', kose: 'Köşe: dört sayının birleştiği köşe; sayıya tıkla.', altili: 'Altılı: yan yana iki sokak; sayıya tıkla.' };

  // ── İç bahisler: seçilen türe göre tıklanan sayının kapsadığı grup (sunucu da aynı grupları kabul eder) ──
  const KIND_NAME = { 2: 'Ayrık', 3: 'Sokak', 4: 'Köşe', 6: 'Altılı' };
  const groupKey = (nums) => `g${[...nums].sort((a, b) => a - b).join('-')}`;
  const groupNums = (key) => key.slice(1).split('-').map(Number);
  const adjacent = (a, b) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    if (lo === 0) return hi <= 3;
    return (hi - lo === 1 && lo % 3 !== 0) || hi - lo === 3;
  };
  function groupFor(kind, n) {
    if (kind === 'sokak') return n === 0 ? [0, 1, 2] : [3 * Math.ceil(n / 3) - 2, 3 * Math.ceil(n / 3) - 1, 3 * Math.ceil(n / 3)];
    if (kind === 'kose') {
      if (n === 0) return [0, 1, 2, 3];
      let base = n % 3 === 0 ? n - 1 : n;
      if (base > 32) base -= 3;
      return [base, base + 1, base + 3, base + 4];
    }
    if (kind === 'altili') {
      const r = Math.min(Math.max(Math.ceil(n / 3), 1), 11);
      return [3 * r - 2, 3 * r - 1, 3 * r, 3 * r + 1, 3 * r + 2, 3 * r + 3];
    }
    return null;
  }

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
    // Grup bahisleri: kapsadığı sayılar işaretlenir, altta liste olarak durur (sağ tık / × ile silinir)
    const groups = new Map();
    for (const [key, amount] of [...Object.entries(mine), ...rl.pending]) if (key[0] === 'g') groups.set(key, (groups.get(key) ?? 0) + amount);
    const covered = new Set([...groups.keys()].flatMap(groupNums));
    for (const b of $('roulette-board').children) {
      const n = b.dataset.key[0] === 'n' ? Number(b.dataset.key.slice(1)) : -1;
      b.classList.toggle('covered', covered.has(n));
      b.classList.toggle('first', rl.first === n);
    }
    $('roulette-groups').replaceChildren(...[...groups].map(([key, amount]) => {
      const nums = groupNums(key);
      const chip = el('span', { className: `rg${mine[key] ? ' placed' : ''}${rl.room?.phase === 'result' && rl.room.result && winsOn(key, rl.room.result.result) ? ' hit' : ''}` },
        el('b', { textContent: `${KIND_NAME[nums.length]} ${nums.join('-')}` }), el('em', { textContent: short(amount) }));
      if (rl.pending.has(key)) {
        const x = el('button', { type: 'button', textContent: '×', title: 'Kaldır' });
        x.addEventListener('click', () => removeRouletteBet(key));
        chip.append(x);
      }
      return chip;
    }));
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
    if (key[0] === 'g') return groupNums(key).includes(n);
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
    try {
      const key = cell.dataset.key;
      // Dış bahisler (renk, düzine...) türden bağımsızdır; tür sadece sayılara uygulanır
      if (key[0] !== 'n' || rl.kind === 'tek') return placeRouletteBet(key);
      const n = Number(key.slice(1));
      if (rl.kind === 'ayrik') {
        // Ayrık: iki komşu sayıya sırayla tıklanır
        if (rl.first == null || rl.first === n || !adjacent(rl.first, n)) {
          if (rl.first != null && rl.first !== n) say('Ayrık bahis için yan yana iki sayı seç.', 'lose');
          rl.first = rl.first === n ? null : n;
          return renderRouletteBets();
        }
        const pair = [rl.first, n];
        rl.first = null;
        return placeRouletteBet(groupKey(pair));
      }
      placeRouletteBet(groupKey(groupFor(rl.kind, n)));
    } catch (error) { say(error.message, 'lose'); }
  });
  // Seçili türde bir sayının üstüne gelince hangi sayıları kapsadığı görünür
  $('roulette-board').addEventListener('pointerover', (event) => {
    const cell = event.target.closest('.rc');
    const n = cell?.dataset.key[0] === 'n' ? Number(cell.dataset.key.slice(1)) : -1;
    const nums = n < 0 ? [] : rl.kind === 'ayrik' ? (rl.first != null && adjacent(rl.first, n) ? [rl.first, n] : [n]) : groupFor(rl.kind, n) ?? [n];
    for (const b of $('roulette-board').children) b.classList.toggle('preview', nums.includes(Number(b.dataset.key.slice(1))) && b.dataset.key[0] === 'n');
  });
  $('roulette-board').addEventListener('pointerleave', () => {
    for (const b of $('roulette-board').children) b.classList.remove('preview');
  });
  for (const b of document.querySelectorAll('#roulette-kind [data-kind]')) {
    b.addEventListener('click', () => {
      rl.kind = b.dataset.kind;
      rl.first = null;
      for (const o of document.querySelectorAll('#roulette-kind [data-kind]')) o.classList.toggle('active', o === b);
      if (!locked()) setStatus($('roulette-status'), { text: KIND_HINT[rl.kind], tone: 'go' });
      renderRouletteBets();
    });
  }
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

  function rouletteLine(room) {
    const status = $('roulette-status');
    if (room.phase === 'open') setStatus(status, { text: `Bahis türünü seç, sayılara tıkla, sonra Çevir’e bas.`, tone: 'go', log: KIND_HINT[rl.kind] });
    else if (room.phase === 'betting') setStatus(status, { text: countdown(`Çark {s} sn sonra dönüyor • ${room.players.length} oyuncu`, room.endsAt), tone: 'turn', log: 'Bu sürede bahis ekleyebilirsin' });
    else if (room.phase === 'spinning') setStatus(status, { text: 'Çark dönüyor...', tone: 'go' });
  }

  function drawRoulette(room, data) {
    const prev = rl.room;
    rl.room = room;
    if (room.phase !== 'result') rouletteLine(room);

    $('roulette-players').replaceChildren(...room.players.map((p) => el('span', { className: `rp${p.id === myId() ? ' me' : ''}${p.payout ? ' won' : p.payout === 0 ? ' lost' : ''}` },
      avatarImg(p.id, ''), el('b', { textContent: p.name }), el('em', { textContent: p.payout != null ? (p.payout ? `+${fmt(p.payout)}` : fmt(-p.total)) : fmt(p.total) }))));
    $('roulette-history').replaceChildren(...room.history.map((h) => el('span', { className: `rh ${h.color}`, textContent: String(h.result) })));

    if ((room.phase === 'spinning' || room.phase === 'result') && room.spinAt && rl.spunAt !== room.spinAt) {
      rl.spunAt = room.spinAt;
      setStatus($('roulette-status'), { text: 'Çark dönüyor...', tone: 'go' });
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
    const head = `${room.result.result} ${COLOR_TR[room.result.color]} geldi.`;
    const me = room.players?.find((p) => p.id === myId());
    if (me) {
      const n = room.result.result;
      const rate = (key) => (key[0] === 'n' ? 36 : key[0] === 'g' ? 36 / groupNums(key).length : /^[dc]/.test(key) ? 3 : 2);
      const payout = Object.entries(room.mine ?? {}).reduce((sum, [key, amount]) => sum + (winsOn(key, n) ? amount * rate(key) : 0), 0);
      const net = payout - me.total;
      sfx.result(net, me.total);
      setStatus($('roulette-status'), { text: `${head} ${signed(net)}`, tone: net > 0 ? 'win' : net < 0 ? 'lose' : 'go', log: 'Yeni tur için bahis koy' });
    } else {
      sfx.reelStop();
      setStatus($('roulette-status'), { text: head, log: 'Yeni tur için bahis koy' });
    }
  }

  buildWheel();
  buildRouletteBoard();
  renderRouletteBets();
  setStatus($('roulette-status'), { text: 'Bahis türünü seç, sayılara tıkla, sonra Çevir’e bas.', tone: 'go' });
  setStatus($('tay-line'), { text: 'Bahsini seç ve Bahis Koy’a bas. Uçak düşmeden çekersen kazanırsın.', tone: 'turn' });

  // ── Sıra tabanlı masa oyunları (satranç, okey, labirent) ──
  const ROOTS = { poker: 'poker-root', zar: 'zar-root', satranc: 'satranc-root', okey: 'okey-root', labirent: 'labirent-root' };
  const boards = initBoards({ el, fmt, say, sfx, act, avatar, timed, btn, paint, headFor, lastLog, countdown, myId });

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

  // ───────────────────────── Solo / Online ─────────────────────────
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

  for (const b of document.querySelectorAll('[data-mode]')) {
    b.addEventListener('click', () => {
      // Solo masadan kalkmışsan aynı Solo butonu masayı yeniden açar
      const rejoin = b.dataset.mode === 'solo' && current?.solo && !current.table;
      if (!activeGame || (modeOf(activeGame) === b.dataset.mode && !rejoin)) return;
      try { localStorage.setItem(`karia-mode-${activeGame}`, b.dataset.mode); } catch {}
      sfx.chip();
      open(activeGame);
    });
  }

  const SOLO_TEXT = {
    poker: ['Solo Poker', "3 bota karşı Texas Hold'em. Kör 10/20; masaya 2.000 coin fişle oturursun, kalkınca kalan fişin cüzdanına döner."],
    zar: ['Solo Zar Düellosu', '2 bota karşı zar at; en yüksek atan 300 coinlik potu alır. Giriş 100 coin.'],
    satranc: ['Solo Satranç', 'Bota karşı satranç. Giriş 100 coin: kazanırsan 200 alırsın, berabere biterse girişin döner.'],
    okey: ['Solo Okey 101', '3 bota karşı Okey 101. Giriş 100 coin; elini ilk bitiren 400 coinlik potu alır.'],
    labirent: ['Solo Karia Labirent', 'Bota karşı koridor yarışı: karşı kenara ilk varan kazanır. Giriş 100 coin, kazanan 200 alır.'],
  };

  // Solo'ya girince masa beklemeden açılır. auto=false: masadan yeni kalkıldı, kendiliğinden tekrar oturtulmaz.
  async function soloIntro(game, root, auto = true) {
    stop();
    clearTimeout(lobbyTimer);
    current = { game, root, table: null, solo: true };
    try {
      const data = await api(`/tables?game=${game}`);
      if (data.seatedAt === `solo-${game}-${myId()}`) return openTable(game, data.seatedAt, root);
    } catch {}
    if (current?.root !== root) return;
    const [title, text] = SOLO_TEXT[game];
    const intro = (status, main = []) => paint(root, game, {
      meta: 'Solo',
      stage: [el('div', { className: 'intro' }, el('img', { src: 'emojis/bot.png', alt: '' }), el('h3', { textContent: title }), el('p', { textContent: text }))],
      status, main,
    });
    if (!auto) return intro({ text: 'Masadan kalktın. Yeniden oynamak için Tekrar Oyna’ya bas.', tone: 'go' }, [btn('Tekrar Oyna', () => soloIntro(game, root, true), 'pk gold big')]);
    intro({ text: 'Masa hazırlanıyor...', tone: 'go' });
    try {
      const made = await api('/tables/solo', { game });
      if (current?.root === root && !current.table) openTable(game, made.id, root);
    } catch (error) {
      // Örn. başka bir masada oturuyorsun: sebebi yaz, yeniden denemek tek tık
      if (current?.root === root && !current.table) intro({ text: error.message, tone: 'lose' }, [btn('Tekrar Dene', () => soloIntro(game, root, true), 'pk gold big')]);
    }
  }

  function open(name) {
    activeGame = DEFAULT_MODE[name] ? name : null;
    const sw = $('mode-switch');
    if (!activeGame) {
      sw.hidden = true;
      $('betbar').hidden = true;
    }
    for (const b of sw.querySelectorAll('[data-mode]')) b.classList.toggle('active', activeGame && b.dataset.mode === modeOf(name));
    const mode = modeOf(name);
    clearTimeout(lobbyTimer);
    clearTimeout(slotTimer);
    const panel = document.querySelector(`[data-panel="${name}"]`);
    if (name === 'slot') {
      mountShared(staticSlots(panel), true);
      $('slot-feed').hidden = mode !== 'online';
      if (mode === 'online') slotFeed();
    }
    if (name === 'tayyare' || name === 'roulette') {
      mountShared(staticSlots(panel), true);
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
      mountShared(staticSlots($('bj-solo')), true);
    }
    current = null;
    stop();
  }

  // Bahis tutarı değişince Tayyare ve blackjack masasındaki düğmenin tutarı da yenilensin
  document.addEventListener('betchange', () => {
    if (tay.room) drawTayButton();
    const w = watching;
    if (w?.last && w.id.startsWith('blackjack-')) w.render(w.last.room, w.last);
  });

  return { open, stop };
}
