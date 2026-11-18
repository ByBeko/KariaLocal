// Müzik > Sözler (sağdaki çalar kartında açılıp kapanır): çalan şarkının sözleri (LRCLIB). Zaman damgalı sözlerde o anki satır vurgulanır ve ortada tutulur.
// Bot, burada dinleme ve ortak dinleme modlarının hepsinde çalışır; konum app.js'ten gelir.
export function initLyrics(ctx) {
  const { api, $, el, nowPlaying, position } = ctx;
  const box = $('lyrics-box');
  let key = null; // sözleri gösterilen şarkı (null: henüz bakılmadı)
  let data = null;
  let rows = [];
  let active = -1;
  let ticket = 0;
  let userScrollAt = 0; // elle kaydırınca bir süre otomatik kaydırma durur

  for (const type of ['wheel', 'touchmove']) box.addEventListener(type, () => { userScrollAt = Date.now(); }, { passive: true });

  function message(text) {
    rows = [];
    active = -1;
    box.replaceChildren(el('p', { className: 'queue-empty', textContent: text }));
  }

  async function load(now) {
    const mine = ++ticket;
    message('Sözler aranıyor...');
    try {
      const query = new URLSearchParams({ title: now.title, artist: now.artist || '', duration: String(Math.round(now.duration || 0)) });
      const r = await api(`/lyrics?${query}`);
      if (mine !== ticket) return;
      data = r;
      draw();
    } catch {
      if (mine === ticket) message('Sözler şu an getirilemedi.');
    }
  }

  function draw() {
    if (!data?.found) return message('Bu şarkının sözleri bulunamadı.');
    if (!data.synced?.length && !data.plain) return message(data.instrumental ? 'Bu şarkı enstrümantal, sözü yok.' : 'Bu şarkının sözleri bulunamadı.');
    const head = el('div', { className: 'ly-head' }, el('strong', { textContent: data.title }), el('small', { textContent: data.artist }));
    const foot = el('small', { className: 'ly-source', textContent: 'Sözler: LRCLIB' });
    active = -1;
    if (data.synced?.length) {
      rows = data.synced.map(([, text]) => el('p', { className: 'ly-line', textContent: text || '♪' }));
      box.replaceChildren(head, el('div', { className: 'ly-lines synced' }, ...rows), foot);
      box.scrollTop = 0;
      tick();
    } else {
      rows = [];
      box.replaceChildren(head, el('div', { className: 'ly-lines' }, ...String(data.plain).split('\n').map((line) => el('p', { className: 'ly-line', textContent: line || ' ' }))), foot);
      box.scrollTop = 0;
    }
  }

  function tick() {
    if (box.hidden) return;
    const now = nowPlaying();
    const nextKey = now ? `${now.title}|${now.artist}` : '';
    if (nextKey !== key) {
      key = nextKey;
      data = null;
      if (!now) return message('Şu an bir şey çalmıyor.');
      return void load(now);
    }
    if (!rows.length) return;
    const at = position() + 0.3; // satır sesten biraz önce yansın
    let index = -1;
    for (let i = 0; i < data.synced.length && data.synced[i][0] <= at; i++) index = i;
    if (index === active) return;
    rows[active]?.classList.remove('on');
    active = index;
    const row = rows[index];
    if (!row) return;
    row.classList.add('on');
    if (Date.now() - userScrollAt > 4000) box.scrollTo({ top: row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2, behavior: 'smooth' });
  }

  // Sağdaki çalar kartında kapak ile sözler arasında geçiş
  const toggle = $('music-lyrics');
  const card = box.closest('.now-card');
  function setOpen(open) {
    box.hidden = !open;
    card.classList.toggle('show-lyrics', open);
    toggle.classList.toggle('on', open);
    toggle.setAttribute('aria-pressed', String(open));
    toggle.setAttribute('aria-label', open ? 'Sözleri gizle' : 'Sözleri göster');
    try { localStorage.setItem('karia-lyrics', open ? '1' : ''); } catch {}
    if (open) setTimeout(tick);
  }
  toggle.addEventListener('click', () => setOpen(box.hidden));
  try { if (localStorage.getItem('karia-lyrics')) setOpen(true); } catch {}

  setInterval(tick, 250);
}
