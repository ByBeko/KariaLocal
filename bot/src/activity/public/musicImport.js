// Müzik > Aktar: link ile liste aktarma ve Spotify / YouTube Music hesabı bağlama. Aktarılan liste "Çalma Listelerim"de açılır.
export function initMusicImport(ctx) {
  const { api, $, el, say, guarded, openLink, showList } = ctx;
  const box = $('import-box');
  let accounts = [];
  let browsing = null; // { platform, label, name, playlists }
  let waitTimer = 0;

  const btn = (text, onClick, className = '', title = '') => {
    const b = el('button', { type: 'button', className, textContent: text, title });
    b.addEventListener('click', onClick);
    return b;
  };
  const cover = (src) => {
    const img = el('img', { src: src || 'emojis/muzik.png', alt: '' });
    img.addEventListener('error', () => { img.src = 'emojis/muzik.png'; }, { once: true });
    return img;
  };

  function linkForm() {
    const input = el('input', { placeholder: 'Spotify, YouTube Music, Deezer, Apple Music ya da SoundCloud linki', maxLength: 500 });
    const form = el('form', { className: 'pl-new' }, input, el('button', { className: 'primary', textContent: 'Aktar' }));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      guarded(async () => {
        say('Liste okunuyor...');
        const r = await api('/playlists/import', { url: input.value.trim() });
        input.value = '';
        say(r.notice, 'win');
        showList(r.list);
      });
    });
    return el('section', { className: 'imp-card' },
      el('h5', { textContent: 'Link ile aktar' }),
      form,
      el('small', { textContent: 'Herkese açık listeler, albümler ve şarkılar giriş yapmadan aktarılır. Şarkılar çalınırken YouTube\'da bulunur.' }));
  }

  function accountRow(a) {
    const actions = !a.ready
      ? [el('em', { textContent: 'Henüz ayarlanmadı' })]
      : a.connected
        ? [btn('Listelerim', () => browse(a), 'primary'), btn('Kaldır', () => guarded(async () => {
          accounts = (await api(`/music-accounts/${a.platform}/disconnect`, {})).accounts;
          say(`${a.label} bağlantısı kaldırıldı.`);
          draw();
        }), 'pl-danger')]
        : [btn('Bağla', () => connect(a), 'primary')];
    return el('li', { className: `imp-acc ${a.platform}` },
      el('i', { className: 'imp-logo', textContent: a.platform === 'spotify' ? 'S' : '▶' }),
      el('span', {}, el('strong', { textContent: a.label }), el('small', { textContent: a.connected ? `Bağlı: ${a.name}` : a.note })),
      el('div', { className: 'imp-actions' }, ...actions));
  }

  function draw() {
    if (browsing) return drawBrowse();
    box.replaceChildren(
      linkForm(),
      el('section', { className: 'imp-card' }, el('h5', { textContent: 'Hesaplarım' }), el('ul', { className: 'imp-accs' }, ...accounts.map(accountRow))));
  }

  async function load() {
    try {
      accounts = (await api('/music-accounts')).accounts;
    } catch (error) {
      say(error.message, 'lose');
    }
    draw();
  }

  function connect(a) {
    guarded(async () => {
      const { url } = await api(`/music-accounts/${a.platform}/connect`, {});
      openLink(url);
      say(`${a.label} girişi tarayıcıda açıldı. İzin verdikten sonra buraya dön.`);
      clearInterval(waitTimer);
      const until = Date.now() + 5 * 60_000;
      waitTimer = setInterval(async () => {
        if (Date.now() > until) return clearInterval(waitTimer);
        const r = await api('/music-accounts').catch(() => null);
        if (!r?.accounts.find((x) => x.platform === a.platform)?.connected) return;
        clearInterval(waitTimer);
        accounts = r.accounts;
        say(`${a.label} bağlandı.`, 'win');
        if (!box.hidden && !browsing) draw();
      }, 3000);
    });
  }

  function browse(a) {
    guarded(async () => {
      say(`${a.label} listelerin getiriliyor...`);
      const { playlists } = await api(`/music-accounts/${a.platform}/playlists`);
      say('');
      browsing = { ...a, playlists };
      drawBrowse();
    });
  }

  function drawBrowse() {
    const b = browsing;
    const rows = b.playlists.map((p) => el('li', { className: 'pl-row' },
      cover(p.cover),
      el('span', {}, el('strong', { textContent: p.name }), el('small', { textContent: p.count != null ? `${p.count} şarkı` : '' })),
      btn('Aktar', () => importOne(b, p), 'imp-take')));
    box.replaceChildren(
      el('div', { className: 'pl-head' },
        btn('‹', () => { browsing = null; draw(); }, 'pl-back', 'Geri'),
        el('strong', { className: 'imp-title', textContent: `${b.label} • ${b.name}` })),
      rows.length ? el('ul', { className: 'pl-list' }, ...rows) : el('p', { className: 'queue-empty', textContent: 'Bu hesapta liste bulunamadı.' }));
  }

  function importOne(b, p) {
    guarded(async () => {
      say(`${p.name} aktarılıyor...`);
      const r = await api(`/music-accounts/${b.platform}/import`, { id: p.id, name: p.name });
      say(r.notice, 'win');
      browsing = null;
      showList(r.list);
    });
  }

  for (const b of document.querySelectorAll('[data-mtab]')) b.addEventListener('click', () => { if (b.dataset.mtab === 'import') load(); });
  return { load };
}
