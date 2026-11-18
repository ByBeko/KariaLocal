// Müziğin nerede çalacağı: botla ses kanalında, burada (sadece bu cihazda) ya da etkinlikteki herkesle ortak.
// Botsuz modlarda ses sunucudan m4a olarak gelir ve <audio> ile çalar; çalar aynı görünümü (drawMusic) kullanır.
export function initListen(ctx) {
  const { api, API, $, say, drawMusic, getInstance } = ctx;
  const audio = $('music-audio');
  const HINTS = {
    bot: 'Ses, bulunduğun ses kanalında bot üzerinden çalar.',
    local: 'Ses sadece bu cihazda çalar; ses kanalına girmen gerekmez.',
    party: 'Bu etkinlikteki herkes aynı şarkıyı aynı anda dinler.',
  };
  const LOOP_NEXT = { off: 'track', track: 'queue', queue: 'off' };
  let mode = 'bot';
  let volume = 70;
  try {
    volume = Number(localStorage.getItem('karia-volume')) || 70;
  } catch {}
  const local = { tracks: [], history: [], current: null, loop: 'off' };
  let party = null; // son oda görünümü
  let partyTimer = 0;
  let startTimer = 0;
  let offset = 0; // sunucu saati - bu cihazın saati
  let locked = false; // tarayıcı kendiliğinden çalmaya izin vermedi: ilk dokunuşta açılır

  const plain = (t) => ({ src: t.src, title: t.title, artist: t.artist ?? '', duration: t.duration ?? 0, thumb: t.thumb ?? null, cover: t.cover ?? null, thumbnail: t.thumbnail ?? null });
  const shuffle = (list) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  };

  function setVolume(level) {
    volume = Math.max(0, Math.min(150, Number(level) || 0));
    audio.volume = Math.min(1, volume / 100);
    try {
      localStorage.setItem('karia-volume', String(volume));
    } catch {}
  }
  setVolume(volume);

  function stopAudio() {
    clearTimeout(startTimer);
    audio.pause();
    audio.removeAttribute('src');
    delete audio.dataset.src;
    audio.load();
  }

  function playAudio() {
    audio.play().then(() => { locked = false; }).catch(() => {
      if (!locked) say('Sesi açmak için ▶ düğmesine bas.');
      locked = true;
    });
  }

  /** Yüklenmeden önce ileri sarılamaz: yüklenince istenen yere gider */
  function seek(target) {
    if (audio.readyState >= 1) audio.currentTime = Math.max(0, target());
    else audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.max(0, target()); }, { once: true });
  }

  // ── Kişisel dinleme: sıra bu cihazdadır ──
  function localView() {
    const c = local.current;
    return {
      playing: Boolean(c),
      loading: Boolean(c?.loading),
      paused: Boolean(c) && (c.loading || audio.paused),
      current: c,
      position: c && !c.loading ? audio.currentTime : 0,
      loop: local.loop,
      volume,
      canBack: local.history.length > 0,
      upcoming: local.tracks.slice(0, 50),
      remaining: local.tracks.length,
    };
  }

  async function playLocal(track) {
    const current = { ...plain(track), loading: true };
    local.current = current;
    clearTimeout(startTimer);
    audio.pause();
    redraw();
    try {
      const next = local.loop === 'track' ? null : local.tracks[0];
      const r = await api('/listen/prepare', { src: current.src, title: current.title, duration: current.duration, next: next?.src });
      if (local.current !== current) return;
      current.loading = false;
      current.duration = r.duration || current.duration;
      if (!current.thumb && !current.cover && r.yt) current.thumb = r.yt;
      current.audio = r.audio;
      if (mode === 'local') {
        audio.src = `${API}/${r.audio}`;
        audio.dataset.src = r.audio;
        playAudio();
      }
    } catch (error) {
      if (local.current !== current) return;
      // Çok hızlı istek (art arda geç): şarkı atlanmaz, biraz sonra yeniden istenir
      if (/yavaşla/i.test(error.message)) return void setTimeout(() => { if (local.current === current) playLocal(current); }, 400);
      say(`${current.title}: ${error.message}`, 'lose');
      nextLocal({ failed: true });
      return;
    }
    redraw();
  }

  /** Sıradakine geçer; döngüye göre biten şarkı tekrar ya da sona eklenir */
  function nextLocal({ force = false, failed = false } = {}) {
    const finished = local.current;
    if (finished && !failed) {
      if (local.loop === 'track' && !force) local.tracks.unshift(plain(finished));
      else {
        local.history.push(plain(finished));
        if (local.history.length > 20) local.history.shift();
        if (local.loop === 'queue') local.tracks.push(plain(finished));
      }
    }
    const next = local.tracks.shift();
    if (next) return playLocal(next);
    local.current = null;
    stopAudio();
    redraw();
  }

  function addLocal(tracks) {
    const room = 200 - local.tracks.length;
    if (room <= 0) throw new Error('Sıra dolu (en fazla 200 şarkı).');
    local.tracks.push(...tracks.slice(0, room).map(plain));
    if (!local.current) nextLocal();
    else redraw();
    return Math.min(room, tracks.length);
  }

  // ── Ortak dinleme: sıra sunucuda, herkes şarkının başladığı ana göre çalar ──
  const partyPath = (action = '') => `/party/${encodeURIComponent(getInstance())}${action ? `/${action}` : ''}`;
  const partyWant = () => {
    if (!party?.startAt) return 0;
    return party.paused ? party.position : (Date.now() + offset - party.startAt) / 1000;
  };

  function partyDraw() {
    if (!party) return { playing: false, upcoming: [], remaining: 0, volume };
    return { ...party, position: Math.max(0, partyWant()), volume, notice: undefined };
  }

  function syncParty(view) {
    if (mode !== 'party') return;
    if (view.closed) return void api(partyPath('join'), {}).then(syncParty).catch(() => {});
    party = view;
    if (view.now) offset = view.now - Date.now();
    if (view.notice) say(view.notice);
    clearTimeout(startTimer);
    if (!view.audio || !view.current) {
      if (audio.dataset.src) stopAudio();
    } else {
      if (audio.dataset.src !== view.audio) {
        audio.src = `${API}/${view.audio}`;
        audio.dataset.src = view.audio;
      }
      const want = partyWant();
      if (view.paused) {
        audio.pause();
        if (Math.abs(audio.currentTime - want) > 1) seek(partyWant);
      } else if (want < 0) { // şarkı birazdan herkes için aynı anda başlar
        audio.pause();
        seek(() => 0);
        startTimer = setTimeout(playAudio, -want * 1000);
      } else {
        if (audio.readyState < 1 || Math.abs(audio.currentTime - want) > 1.5) seek(partyWant);
        if (audio.paused && !locked) playAudio();
      }
    }
    const names = view.listeners ?? [];
    $('music-hint').textContent = `${HINTS.party}${names.length ? ` Dinleyenler: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` +${names.length - 6}` : ''}` : ''}`;
    drawMusic(partyDraw());
  }

  const pollParty = () => api(partyPath()).then(syncParty).catch(() => {});

  // ── Ortak ──
  function redraw() {
    if (mode === 'local') drawMusic(localView());
    else if (mode === 'party') drawMusic(partyDraw());
  }

  audio.addEventListener('ended', () => { if (mode === 'local') nextLocal(); });
  audio.addEventListener('play', redraw);
  audio.addEventListener('pause', redraw);
  audio.addEventListener('error', () => {
    if (mode !== 'local' || !local.current || local.current.loading || !audio.getAttribute('src')) return;
    say(`${local.current.title} çalınamadı.`, 'lose');
    nextLocal({ failed: true });
  });

  function paint() {
    for (const b of document.querySelectorAll('[data-lmode]')) b.classList.toggle('active', b.dataset.lmode === mode);
    $('music-hint').textContent = HINTS[mode];
    $('music-query').placeholder = mode === 'bot' ? 'Şarkı adı ya da link' : 'Şarkı adı ya da link (burada çalar)';
  }

  function setMode(next) {
    if (next === mode || (next === 'party' && !getInstance())) return;
    const prev = mode;
    mode = next;
    clearTimeout(startTimer);
    if (prev === 'party') {
      clearInterval(partyTimer);
      api(partyPath('leave'), {}).catch(() => {});
      party = null;
      stopAudio();
    }
    if (prev === 'local' && local.current) { // geri dönünce kaldığı yerden sürer
      local.current.resumeAt = audio.currentTime;
      stopAudio();
    }
    paint();
    if (mode === 'local' && local.current?.audio) {
      audio.src = `${API}/${local.current.audio}`;
      audio.dataset.src = local.current.audio;
      const at = local.current.resumeAt ?? 0;
      seek(() => at);
    }
    if (mode === 'party') {
      say('Ortak dinlemeye katılıyorsun...');
      api(partyPath('join'), {}).then(syncParty).catch((error) => say(error.message, 'lose'));
      partyTimer = setInterval(pollParty, 2000);
    }
    refresh().catch(() => {});
  }
  for (const b of document.querySelectorAll('[data-lmode]')) b.addEventListener('click', () => setMode(b.dataset.lmode));

  async function refresh() {
    if (mode === 'bot') drawMusic(await api('/music'));
    else redraw();
  }

  /** Çalar düğmeleri: pause, skip, previous, stop, shuffle, loop, volume */
  async function action(name, body = {}) {
    if (mode === 'bot') return drawMusic(await api(`/music/${name}`, body));
    if (name === 'volume') {
      setVolume(body.level);
      return redraw();
    }
    if (mode === 'party') {
      if (name === 'pause' && locked) return playAudio(); // sesi sadece bu cihazda açar, odayı duraklatmaz
      return syncParty(await api(partyPath(name), body));
    }
    switch (name) {
      case 'pause':
        if (!local.current || local.current.loading) return;
        if (audio.paused) playAudio();
        else audio.pause();
        return;
      case 'skip':
        nextLocal({ force: true });
        return;
      case 'previous': {
        const prev = local.history.pop();
        if (!prev) return;
        if (local.current) local.tracks.unshift(plain(local.current));
        playLocal(prev);
        return;
      }
      case 'stop':
        local.tracks = [];
        local.current = null;
        stopAudio();
        break;
      case 'shuffle':
        if (local.tracks.length < 2) throw new Error('Karıştırmak için sırada en az 2 şarkı olmalı.');
        shuffle(local.tracks);
        break;
      case 'loop':
        local.loop = LOOP_NEXT[local.loop];
        break;
    }
    redraw();
  }

  /** Arama kutusu: bot modunda bot çalar, diğerlerinde burada ya da odada */
  async function search(query) {
    if (mode === 'bot') {
      drawMusic(await api('/music/play', { query }));
      return 'Sıraya eklendi.';
    }
    if (mode === 'party') {
      syncParty(await api(partyPath('search'), { query }));
      return '';
    }
    const r = await api('/listen/search', { query });
    const added = addLocal(r.playlist ? r.tracks : r.tracks.slice(0, 1));
    return added > 1 ? `${added} şarkı sıraya eklendi.` : 'Sıraya eklendi.';
  }

  /** Çalma listesini botsuz modda çalar (bot modunu çağıran taraf yönetir) */
  async function playList(id, shuffled) {
    if (mode === 'party') return syncParty(await api(partyPath('list'), { id, shuffle: shuffled }));
    const { list } = await api(`/playlists/${id}`);
    const tracks = list.tracks.map((t) => ({ src: t.src, title: t.title, artist: t.artist, duration: t.duration, thumb: t.yt, cover: t.cover, thumbnail: t.thumbnail }));
    if (!tracks.length) throw new Error('Liste boş, önce şarkı ekle.');
    if (shuffled) shuffle(tracks);
    say(`${list.name}: ${addLocal(tracks)} şarkı sıraya eklendi.`, 'win');
  }

  /** Açılışta: ses kanalındaysan bot, değilsen burada dinleme seçilir */
  function boot(music) {
    $('lmode-party').hidden = !getInstance();
    if (music?.inVoice) {
      paint();
      drawMusic(music);
    } else setMode('local');
  }

  const nowTracks = () => {
    if (mode === 'party') return party?.current ? [party.current, ...(party.upcoming ?? [])] : [];
    return local.current ? [local.current, ...local.tracks] : [];
  };

  return {
    boot,
    mode: () => mode,
    action,
    search,
    playList,
    refresh,
    /** Kaydetmek için çalan şarkı / sıra (botsuz modlar) */
    current: () => nowTracks().slice(0, 1).map(plain),
    queue: () => nowTracks().map(plain),
  };
}
