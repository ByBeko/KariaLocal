// Yapay zekanın Karia'nın özellikleri hakkında bildikleri. Yeni bir özellik eklenince buraya da bir satır yaz.
export const FEATURES = [
  'Karia Local botunun ve Karia sunucusunun sahibi BEKO\'dur.',
  'Komutlar `/` ile ya da kari, kl, k ön ekleriyle kullanılır. Tüm liste: /yardim. Yapay zekaya soru sormak için kari yazıp soruyu yazmak, Karia\'yı etiketlemek ya da cevabına yanıt vermek yeterlidir.',
  'Sosyal medya linkleri, Minecraft IP\'si ve takviye bilgisi için komut yoktur: sohbete instagram, ip ya da takviye yazmak yeterlidir, Karia otomatik cevaplar.',
  'Üye ve sunucu bilgileri: /bilgi kullanici, /bilgi sunucu. Rol listesi: /roller. Emoji listesi: /emoji.',
  'Sıralamalar: /siralama. Seviye, coin, mesaj, ses ve davet sıralamaları tek yerdedir, butonlarla geçilir.',
  'Destek talebi: #destek-talebi kanalındaki menüden konu seçilir, kişiye özel kanal açılır.',
  'Üye şikayeti: herhangi bir kanalda /rapor kullanici sebep yazılır (#rapor diye bir kanal yoktur). Rapor gizlice yetkililere gider, 5 dakikada bir kullanılabilir, sadece / ile çalışır.',
  'AFK: /afk sebep. Biri etiketleyince sebep söylenir, kişi yazınca AFK biter.',
  'Seviye: mesajla dakikada bir 10-20 XP, seste en az 2 kişiyken dakikada 3 XP kazanılır. Her seviye 3000 XP ister, düzenli aktif biri için yaklaşık 5 gün sürer. Seviye 5, 10, 15 ve böyle 50\'ye kadar her 5 seviyede bir rol verilir. Kart: /seviye.',
  'Etkinlikte (Oyunlar sekmesi) blackjack, slot, yazı tura ve rulet vardır. Her oyundan sonra 5 saniye beklenir. Blackjack\'te kart çek, dur, ikiye katla ve aynı değerde iki kart gelince ikiye ayırma yapılabilir. Rulet sadece Etkinlikte vardır.',
  'Ekonomi: coin sanaldır, gerçek değeri yoktur. Herkes ilk kullanımda 200 coin alır. Günlük ödül 100 coindir: /gunluk ya da Etkinlik ana sayfasındaki düğme, 20 saatte bir alınır. Bakiye: /bakiye. Gönderme: /gonder. Oyunlar: /coinflip, /slot, /blackjack.',
  'Müzik: /cal ile YouTube\'dan çalınır, önce ses kanalına girmek gerekir. Kalabalıkta şarkı geçme oylamayla olur.',
  'Özel oda: "Özel Oda Oluştur" ses kanalına girince kişiye özel oda açılır.',
  'Roller: #roller kanalındaki menüden bildirim ve ilgi alanı rolleri seçilir. Rozetler (Karia Kodcu, Karia Oyuncu, Karia Yaratıcı) ve topluluk rolleri sunucuya girişteki sorulardan ya da Kanallar ve Roller sayfasından seçilir.',
  'Öneri: /oneri yazılır, #oy-ver kanalına gider ve üyeler oy verir.',
  'Galeri: sadece fotoğraf ve video atılır, yorumlar gönderinin başlığına yazılır.',
  'Davet sıralamasında sadece hâlâ geçerli davet linkleri sayılır.',
  'Anket: yetkililer açar, üyeler butonla tek oy verir, aynı seçeneğe tekrar basınca oy geri alınır.',
  'Çekiliş: yetkililer başlatır, üyeler butonla katılır.',
  'Yeni çekilişlerde Çekiliş Bildirimi, yeni anketlerde Anket Bildirimi rolü etiketlenir. Bu roller #roller kanalından alınır.',
  'Bot güncellemeleri her Pazar 20:00\'de #karia-bot forumundaki "Karia Local Güncellemeleri" başlığında paylaşılır.',
];

export const STAFF_FEATURES = [
  'Toplu saldırı koruması: bir hesap 1 dakikada 3 kanal veya rol siler ya da 5 kişiyi banlar veya atarsa rolleri alınır, botsa atılır. Sunucu sahibi muaftır. Kapatmak için /ayarla ac-kapat.',
  'Yönetim Paneli: Discord Etkinliği içindeki Yönetim sekmesidir, yalnızca yöneticilere görünür. Bot ayarları değiştirilir ve komutlar çalıştırılır; blackjack ve emoji-yukle panelde yoktur.',
  '/dinle: sesli asistanı açar. Yalnızca bot sahibi kullanabilir ve yalnızca onun sesini işler.',
  '/duyuru: kurallar düzeninde duyuru formu açar. /guncelleme-ekle: haftalık güncelleme yazısına madde ekler. /anket: anket açar.',
  'Bot kanal açıklamalarını, bilgi kanallarının yazma iznini, log kanallarının gizliliğini ve Jail gizliliğini saatte bir kontrol edip düzeltir, yaptığını #mod-log kanalına yazar.',
];
