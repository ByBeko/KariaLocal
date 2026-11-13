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
  'Coin ödülleri: seviye atlayınca seviyenin 5 katı coin verilir. Bir kez olmak üzere Köylü 250, Zanaatkâr 500, Tüccar 1.500, Soylu 4.000, Lord 8.000, İmparator 15.000, Hata Avcısı 1.000, Erken Destekçi 1.500, Takviye 2.500, Prime 3.000 coin kazandırır. Takviye 7 gün dolmadan çekilirse ödülün dörtte üçü geri alınır. Her ay en çok oy veren üye 30 gün Prime kazanır. Takviye basanlardan çekilişle 1 kişi her ay 30 gün Prime ve 1.000 coin kazanır. Takviye (pembe) ve Prime (mor) ayrı rollerdir. Hata Bildirimi ve Sponsorluk talepleri yönetici onaylarsa Hata Avcısı ve Sponsor rolü verilir.',
  'Seviye: mesajla dakikada bir 10-20 XP, seste en az 2 kişiyken dakikada 3 XP (günde en çok 600) kazanılır. Seviye yükseldikçe sonraki seviye daha çok XP ister. Rütbeler: Seviye 5 Köylü, 10 Zanaatkâr, 25 Tüccar, 50 Soylu, 75 Lord, 100 İmparator. Üyede yalnızca ulaştığı en yüksek rütbe durur. Kart: /seviye, liste: /seviye oduller.',
  'Etkinlikte (Oyunlar sekmesi) blackjack, poker, Süper Tayyare, rulet, zar düellosu ve slot vardır; oyunlar arasında bekleme yoktur. Poker (Texas Hold’em), blackjack masası ve zar düellosu 6 kişiye kadar aynı masada online oynanır; rulet ve Süper Tayyare odadaki herkesle ortaktır. Pokerde masaya fişle oturulur, kalkınca kalan fiş cüzdana döner. Süper Tayyare’de çarpan yükselir, tayyare düşmeden Çek’e basan bahsi × çarpan kadar alır; otomatik çekme hedefi konabilir. Zar düellosunda en yüksek atan potun hepsini alır. Ayrıca satranç, Okey 101 (101 ya da 5 çiftle açılır, elini ilk bitiren potu alır) ve Karia Labirent (karşı kenara ilk varan kazanır; yürü, kaya koy ya da kazmayla kır) vardır. Her oyunda Solo (botlara karşı) ve Online (herkesle) seçimi bulunur. Blackjack’te kart çek, dur, ikiye katla ve tek kişilikte aynı değerde iki kart gelince ikiye ayırma yapılabilir. Bu masa oyunları sadece Etkinlikte vardır; yazı tura sadece /coinflip komutuyla oynanır.',
  'Ekonomi: coin sanaldır, gerçek değeri yoktur. Herkes ilk kullanımda 200 coin alır. Günlük ödül 100 coindir: /gunluk ya da Etkinlik ana sayfasındaki düğme, 20 saatte bir alınır. Bakiye: /bakiye. Gönderme: /gonder. Oyunlar: /coinflip, /slot, /blackjack.',
  'Müzik: /cal ile YouTube\'dan çalınır, önce ses kanalına girmek gerekir. Kalabalıkta şarkı geçme oylamayla olur. Etkinliğin Müzik bölümünde herkesin kendi çalma listeleri vardır: liste oluşturulur, şarkı aranarak ya da çalan şarkı + düğmesiyle eklenir, liste tek tıkla ya da karışık çalınır.',
  'Özel oda: "Özel Oda Oluştur" ses kanalına girince kişiye özel oda açılır.',
  'Roller: #roller kanalındaki menüden bildirim ve ilgi alanı rolleri seçilir. Rozetler (Karia Kodcu, Karia Oyuncu, Karia Yaratıcı) ve topluluk rolleri sunucuya girişteki sorulardan ya da Kanallar ve Roller sayfasından seçilir.',
  'Öneri: /oneri yazılır, #oy-ver kanalına gider ve üyeler oy verir.',
  'Galeri: sadece fotoğraf ve video atılır, yorumlar gönderinin başlığına yazılır.',
  'Davet sıralamasında sadece hâlâ geçerli davet linkleri sayılır.',
  'Anket: yetkililer açar, üyeler butonla tek oy verir, aynı seçeneğe tekrar basınca oy geri alınır.',
  'Çekiliş: yetkililer başlatır, üyeler butonla katılır.',
  'Yeni çekilişlerde Çekiliş Bildirimi, yeni anketlerde Anket Bildirimi rolü etiketlenir. Bu roller #roller kanalından alınır.',
  'Bot güncellemeleri her Pazar 20:00\'de #karia-local forumundaki "Karia Local Güncellemeleri" başlığında paylaşılır. Minecraft ve website güncellemeleri de aynı saatte #minecraft ve #website forumlarına yazılır.',
];

export const STAFF_FEATURES = [
  'Toplu saldırı koruması: bir hesap 1 dakikada 3 kanal veya rol siler ya da 5 kişiyi banlar veya atarsa rolleri alınır, botsa atılır. Sunucu sahibi muaftır. Kapatmak için /ayarla ac-kapat.',
  'Yönetim Paneli: Discord Etkinliği içindeki Yönetim sekmesidir, yalnızca yöneticilere görünür. Bot ayarları değiştirilir ve komutlar çalıştırılır; blackjack ve emoji-yukle panelde yoktur.',
  '/dinle: sesli asistanı açar. Yalnızca bot sahibi kullanabilir ve yalnızca onun sesini işler.',
  '/duyuru: kurallar düzeninde duyuru formu açar. /guncelleme-ekle: haftalık güncelleme yazısına madde ekler. /anket: anket açar.',
  'Bot kanal açıklamalarını, bilgi kanallarının yazma iznini, log kanallarının gizliliğini ve Jail gizliliğini saatte bir kontrol edip düzeltir, yaptığını #mod-log kanalına yazar.',
];
