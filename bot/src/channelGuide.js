// Üyelerin gördüğü kanalların açıklamaları. Boş olan kanal konuları buradan doldurulur, /rehber de buradan beslenir.
// icon: sunucudaki Karia_<icon> emojisi. legacy: eski otomatik açıklamadaki emoji (o açıklamaları yenilemek için).
// readOnly: üyeler bu kanala yazamamalı (otomatik kanal kontrolü düzeltir).
export default [
  { key: 'kurallar', match: /kural/i, icon: 'kitap', legacy: '📜', about: 'Sunucu kuralları. Sohbete başlamadan önce mutlaka oku.', readOnly: true },
  { key: 'duyurular', match: /duyuru/i, icon: 'megafon', legacy: '📢', about: 'Karia ile ilgili resmi duyurular ve haberler.', readOnly: true },
  { key: 'takviyeler', match: /takviye/i, icon: 'roket', legacy: '🚀', about: 'Sunucuya takviye yapanlar ve takviye ayrıcalıkları.', readOnly: true },
  { key: 'baglantilar', match: /ba[gğ]lant/i, icon: 'zincir', legacy: '🌍', about: 'Karia’nın resmi bağlantıları ve sosyal medya hesapları.', readOnly: true },
  { key: 'roller', match: /roller/i, icon: 'rozet', legacy: '🃏', about: 'Bildirim ve ilgi alanı rollerini buradan seç.', readOnly: true },
  { key: 'sss', match: /sss/i, icon: 'soru', legacy: '❓', about: 'Sık sorulan sorular ve cevapları.', readOnly: true },
  { key: 'website', match: /^website$/i, icon: 'televizyon', legacy: '🌐', about: 'Karia websitesi ile ilgili güncellemeler ve durum bilgileri.', readOnly: true },
  { key: 'karia-local', match: /^karia-local$/i, icon: 'bot', legacy: '🤖', about: 'Karia Local botunun haftalık güncellemeleri.', readOnly: true },
  { key: 'karia-bot', match: /^karia-bot$/i, icon: 'bot', legacy: '🤖', about: 'Karia botunun güncellemeleri ve durum bilgileri.', readOnly: true },
  { key: 'minecraft', match: /^minecraft$/i, icon: 'oyun', legacy: '⛏️', about: 'Karia Minecraft sunucusu ile ilgili gelişmeler.' },
  { key: 'sohbet', match: /sohbet/i, icon: 'mesaj', legacy: '💬', about: 'Topluluğun genel sohbet kanalı. Kurallara uyarak istediğin gibi yaz.' },
  { key: 'komutlar', match: /komutlar/i, icon: 'araclar', legacy: '🔧', about: 'Bot komutlarını burada kullan. Liste için /yardım yaz.' },
  { key: 'galeri', match: /galeri/i, icon: 'foto', legacy: '📷', about: 'Sadece fotoğraf ve video paylaşılır. Yorumlar gönderinin başlığına yazılır.' },
  { key: 'arkadas-bul', match: /arkada[sş]/i, icon: 'arkadaslar', legacy: '👥', about: 'Birlikte oynayacak ya da takılacak arkadaş bul.' },
  { key: 'oy-ver', match: /oy-ver/i, icon: 'alev', legacy: '🔥', about: 'Karia’ya oy vererek büyümesine destek ol.', readOnly: true },
  { key: 'destek', match: /destek/i, icon: 'cankurtaran', legacy: '🎫', about: 'Sorunun varsa buradaki menüden sana özel destek talebi aç.', readOnly: true },
];
