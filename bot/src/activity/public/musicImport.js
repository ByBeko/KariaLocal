// Müzik > Aktar: sekmelerin yanındaki küçük açılır menü. Yalnızca link ile liste aktarılır; aktarılan liste "Çalma Listelerim"de açılır.
export function initMusicImport(ctx) {
  const { api, $, el, say, guarded, showList } = ctx;
  const box = $('import-box');
  const toggle = $('import-toggle');

  const input = el('input', { placeholder: 'Spotify, YouTube, Deezer, Apple Music ya da SoundCloud linki', maxLength: 500 });
  const form = el('form', { className: 'pl-new' }, input, el('button', { className: 'primary', textContent: 'Aktar' }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!input.value.trim()) return;
    guarded(async () => {
      say('Liste okunuyor...');
      const r = await api('/playlists/import', { url: input.value.trim() });
      input.value = '';
      setOpen(false);
      say(r.notice, 'win');
      showList(r.list);
    });
  });
  box.replaceChildren(
    el('h5', { textContent: 'Link ile liste aktar' }),
    form,
    el('small', { textContent: 'Herkese açık listeler, albümler ve şarkılar aktarılır.' }));

  function setOpen(open) {
    box.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('active', open);
    if (open) input.focus();
  }
  toggle.addEventListener('click', (event) => { event.stopPropagation(); setOpen(box.hidden); });
  box.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => { if (!box.hidden) setOpen(false); });

  return { open: () => setOpen(true) };
}
