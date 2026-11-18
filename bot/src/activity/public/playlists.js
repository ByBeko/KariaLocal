// Müzik bölümündeki kişisel çalma listeleri: oluştur, şarkı ekle, sırala, tek tıkla çal.
export function initPlaylists(ctx) {
  const { api, $, el, fmt, say, guarded, mmss, refreshMusic, listen } = ctx;
  const box = $('playlist-box');
  let lists = [];
  let open = null; // açık liste
  let confirmDelete = 0;

  const btn = (text, onClick, className = '', title = '') => {
    const b = el('button', { type: 'button', className, textContent: text, title });
    b.addEventListener('click', onClick);
    return b;
  };
  const long = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)} sa ${Math.floor((sec % 3600) / 60)} dk` : `${Math.max(1, Math.round(sec / 60))} dk`);

  // Ana ekranda yalnızca çalma listeleri durur; Müzik'e her girişte yenilenir (sıra sağdaki açılır panelde)
  const show = () => (open ? openList(open.id) : loadLists().catch((error) => say(error.message, 'lose')));
  document.querySelector('.tab[data-tab="music"]')?.addEventListener('click', show);

  async function loadLists() {
    lists = (await api('/playlists')).lists;
    if (!open) drawLists();
  }

  const play = (id, shuffle) => guarded(async () => {
    say('Liste sıraya ekleniyor...');
    if (listen.mode() !== 'bot') return listen.playList(id, shuffle); // burada ya da ortak dinlemede çalar
    const r = await api(`/playlists/${id}/play`, { shuffle });
    say(r.notice, 'win');
    refreshMusic();
  });
  // Botsuz modlarda çalan şarkılar sunucuda değil bu cihazda/odadadır: bilgileri gönderilir
  const nowSource = (which) => (listen.mode() === 'bot' ? { source: which } : { source: 'tracks', tracks: which === 'current' ? listen.current() : listen.queue() });

  function drawLists() {
    open = null;
    const input = el('input', { placeholder: 'Yeni liste adı', maxLength: 40 });
    const form = el('form', { className: 'pl-new' }, input, el('button', { className: 'primary', textContent: 'Oluştur' }));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      guarded(async () => {
        if (!input.value.trim()) throw new Error('Listeye bir ad ver.');
        const r = await api('/playlists', { name: input.value });
        drawList(r.list);
      });
    });
    // Kart ızgarası: kapak (4 farklı kapak varsa dörtlü), üstünde çal düğmesi, altında ad ve şarkı sayısı
    const art = (covers = []) => {
      const shown = covers.length >= 4 ? covers.slice(0, 4) : covers.slice(0, 1);
      const imgs = shown.map((src) => {
        const img = el('img', { src, alt: '', loading: 'lazy' });
        img.addEventListener('error', () => img.remove(), { once: true });
        return img;
      });
      return el('div', { className: `pl-art${shown.length === 4 ? ' mosaic' : ''}` }, ...imgs);
    };
    const cards = lists.map((l) => {
      const cover = art(l.covers);
      cover.append(btn('▶', (e) => { e.stopPropagation(); play(l.id, false); }, 'pl-play', 'Çal'));
      const card = el('li', { className: 'pl-card', tabIndex: 0, title: l.name },
        cover,
        el('strong', { textContent: l.name }),
        el('small', { textContent: `Çalma listesi • ${l.count} şarkı${l.count ? ` • ${long(l.duration)}` : ''}` }));
      card.addEventListener('click', () => openList(l.id));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openList(l.id); });
      return card;
    });
    box.replaceChildren(form, ...(cards.length ? [el('ul', { className: 'pl-grid' }, ...cards)] : [el('p', { className: 'queue-empty', textContent: 'Henüz çalma listen yok. Bir ad yazıp oluştur.' })]));
  }

  async function openList(id) {
    try {
      drawList((await api(`/playlists/${id}`)).list);
    } catch (error) {
      say(error.message, 'lose');
      open = null;
      loadLists();
    }
  }

  const change = (path, body) => guarded(async () => {
    const r = await api(`/playlists/${open.id}/${path}`, body);
    if (r.list) drawList(r.list);
    if (r.notice) say(r.notice, 'win');
  });

  function drawList(list) {
    open = list;
    confirmDelete = 0;
    const title = el('input', { className: 'pl-title', value: list.name, maxLength: 40, title: 'Adı değiştirmek için yaz, Enter’a bas' });
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); });
    title.addEventListener('change', () => { if (title.value.trim() && title.value !== list.name) change('rename', { name: title.value }); });
    const del = btn('Sil', () => {
      if (Date.now() - confirmDelete > 3000) {
        confirmDelete = Date.now();
        del.textContent = 'Emin misin?';
        setTimeout(() => { if (del.isConnected) del.textContent = 'Sil'; }, 3000);
        return;
      }
      guarded(async () => {
        await api(`/playlists/${list.id}/delete`, {});
        say(`${list.name} silindi.`);
        open = null;
        loadLists();
      });
    }, 'pl-danger');
    const query = el('input', { placeholder: 'Şarkı adı ya da link (YouTube, Spotify, Deezer, Apple Music)', maxLength: 500 });
    const add = el('form', { className: 'pl-new' }, query, el('button', { className: 'primary', textContent: 'Ekle' }));
    add.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!query.value.trim()) return;
      say('Şarkı aranıyor...');
      change('add', { source: 'query', query: query.value });
    });
    const songs = list.tracks.map((t, i) => el('li', {},
      el('b', { textContent: String(i + 1) }),
      el('span', {}, el('strong', { textContent: t.title }), el('small', { textContent: t.artist || '' })),
      el('em', { textContent: t.duration ? mmss(t.duration) : '' }),
      el('div', { className: 'pl-tools' },
        btn('↑', () => change('move', { index: i, dir: 'up' }), '', 'Yukarı'),
        btn('↓', () => change('move', { index: i, dir: 'down' }), '', 'Aşağı'),
        btn('✕', () => change('remove', { index: i }), 'x', 'Listeden çıkar'))));
    box.replaceChildren(
      el('div', { className: 'pl-head' },
        btn('‹', () => { open = null; loadLists(); }, 'pl-back', 'Listelerim'),
        title,
        el('small', { textContent: `${list.tracks.length} şarkı${list.tracks.length ? ` • ${long(list.duration)}` : ''}` })),
      el('div', { className: 'pl-actions' },
        btn('▶ Çal', () => play(list.id, false), 'primary'),
        btn('⤨ Karışık', () => play(list.id, true)),
        btn('Çalan sırayı ekle', () => change('add', nowSource('queue'))),
        del),
      add,
      songs.length ? el('ol', { className: 'pl-songs' }, ...songs) : el('p', { className: 'queue-empty', textContent: 'Liste boş. Yukarıdan şarkı ara ya da çalan şarkıyı çalardaki + düğmesiyle ekle.' }));
  }

  // Çalardaki + : çalan şarkıyı seçilen listeye ekler
  const save = $('music-save');
  let menu = null;
  const closeMenu = () => { menu?.remove(); menu = null; };
  save.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu) return closeMenu();
    guarded(async () => {
      lists = (await api('/playlists')).lists;
      const newName = el('input', { placeholder: 'Yeni liste', maxLength: 40 });
      const create = el('form', { className: 'pl-new' }, newName, el('button', { className: 'primary', textContent: '+' }));
      create.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!newName.value.trim()) return;
        guarded(async () => {
          const made = await api('/playlists', { name: newName.value });
          const r = await api(`/playlists/${made.list.id}/add`, nowSource('current'));
          say(`${made.list.name}: ${r.notice}`, 'win');
          closeMenu();
        });
      });
      menu = el('div', { className: 'pl-menu' },
        el('h5', { textContent: 'Çalan şarkıyı ekle' }),
        ...lists.map((l) => btn(`${l.name} (${l.count})`, () => guarded(async () => {
          const r = await api(`/playlists/${l.id}/add`, nowSource('current'));
          say(`${l.name}: ${r.notice}`, 'win');
          closeMenu();
          if (open?.id === l.id && r.list) drawList(r.list);
        }))),
        create);
      menu.addEventListener('click', (e) => e.stopPropagation());
      save.parentElement.append(menu);
      newName.focus();
    });
  });
  document.addEventListener('click', closeMenu);

  return {
    refresh: show,
    /** Aktarılan listeyi "Çalma Listelerim"de açar */
    showList: (list) => {
      open = list;
      show();
    },
  };
}
