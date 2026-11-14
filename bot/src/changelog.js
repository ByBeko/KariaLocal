// Haftalık güncelleme yazısının kaynağı. Bot değiştikçe yeni bir kayıt ekle (id her seferinde bir artar).
// Yayınlanmamış kayıtlar bir sonraki haftalık yazıya girer. Yeni komutlar ayrıca otomatik algılanır.
// area: bot (varsayılan, #karia-local), minecraft (#minecraft) veya website (#website).
export default [
  {
    id: 1,
    items: [
      'Yardım menüsü yenilendi: kategoriler butonlu, komutlar tıklanabilir.',
      '`/rehber` eklendi: sunucuda neyi nerede bulacağını gösterir.',
      'Karia artık destek isteyen üyeleri ilgili kanala yönlendiriyor.',
      'Üyelerin gördüğü kanallara açıklama eklendi.',
      'Paneller kurallar kanalındaki düzene geçirildi.',
      'Otomatik kanal kontrolü eklendi: eksik kanal ayarları düzeltiliyor.',
    ],
  },
  {
    id: 2,
    items: [
      'Bot mesajlarında normal emojiler yerine Karia emojileri kullanılıyor.',
      '`/afk` ile AFK olabilir, `/davetler` ile davet sıralamasını görebilirsin.',
      '`/rapor` ile bir üyeyi yetkililere gizlice bildirebilirsin.',
      'Yetkililer için `/anket`, `/duyuru` ve `/guncelleme-ekle` eklendi.',
    ],
  },
  {
    id: 3,
    items: [
      'Yardım menüsü ve rehber embed görünümüne geçti.',
      'Yeni oyun: `/tkm` ile Karia’ya karşı taş kağıt makas oyna.',
      '`/rep` ile üyelere günlük itibar verebilirsin.',
      '`#roller` kanalından bildirim ve ilgi alanı rollerini seçebilirsin.',
      '`/oneri` artık önerileri `#oy-ver` kanalına gönderiyor.',
      'Yapay zeka Karia özelliklerini daha iyi biliyor.',
      'Sunucu koruması güçlendirildi.',
      'Karia Etkinliği eklendi: Blackjack, Slot, Yazı Tura ve müzik kontrolü. Yöneticiler için Yönetim Paneli de içinde.',
      'Karia rozetleri, yeni bildirim ve topluluk rolleri eklendi; sunucuya giriş ekranı ve rehber kuruldu.',
      'Yeni Karia emojileri eklendi; oyunlar, müzik ve loglar artık kendi emojilerini kullanıyor.',
    ],
  },
  {
    id: 4,
    items: [
      'Küfür engeli eklendi.',
      'Yöneticiler için `/automod` ile Discord AutoMod kuralları kurulabiliyor.',
      'Hoş geldin mesajları kısaldı ve her girişte değişiyor.',
      'Sohbete instagram, ip ya da takviye yazman yeterli, Karia otomatik cevaplıyor.',
      '`/siralama` yenilendi: seviye, coin, mesaj, ses ve davet tek yerde.',
      '`/bilgi` ile üye ve sunucu bilgileri tek komutta, `/roller` ile rol listesi eklendi.',
      'Yazı tura, slot ve blackjack yeni görünümde. Yeni oyuncular 200 coin ile başlıyor, günlük ödül 100 coin.',
      'Yardım menüsü sadeleştirildi.',
      'Yeni rütbeler: Seviye 5 Köylü, 10 Zanaatkâr, 25 Tüccar, 50 Soylu, 75 Lord, 100 İmparator. Seviye yükseldikçe sonraki seviye zorlaşıyor, mevcut seviyeler korundu.',
      'Etkinlikte rulet eklendi, blackjack\'te ikiye ayırma geldi. Her oyundan sonra 5 saniye beklemek gerekiyor.',
      'Etkinlik ana sayfasından yetkililere şikayet gönderilebiliyor.',
      'Yetkililer Etkinlikten bota mesaj yazdırırken @ ile üye ve rol, # ile kanal etiketleyebiliyor.',
      'Etkinlikte komutlar yardım menüsü gibi gruplandı. Rulet çarkında sayılar var, kazançlar üstte bildirim olarak çıkıyor.',
      'Roller düzenlendi: ruh hali ve ilgi alanı rolleri üye rolünün altına alındı, rozetler turkuaz oldu.',
      'Karia Etkinliği yenilendi: casino masası, slot makinesi, kürsülü sıralama ve müzik oynatıcısı.',
      'Seviye rolleri artık birikmiyor: yeni seviye rolü alınca eskisi otomatik kalkıyor.',
      'Etkinlikteki oyunlara ses efektleri eklendi, yan menüden kapatılabiliyor.',
      'YouTube bir şarkıyı açmazsa müzik aynı şarkıyı SoundCloud\'dan çalmayı deniyor.',
    ],
  },
  {
    id: 5,
    items: [
      '`/yardım` menüsüne karia.live bağlantıları eklendi.',
      'Etkinlik artık tarayıcıdan da açılıyor: activity.karia.live',
      'Yönetim panelinde talepler, raporlar ve öneriler sayfa yenilemeden geliyor.',
    ],
  },
  {
    id: 6,
    area: 'website',
    items: [
      'karia.live yayında: ana sayfa, Karia Local, Karia paneli ve Minecraft bölümleri tek sitede.',
      'Oyunlar, müzik ve yönetim paneli activity.karia.live adresinden Discord girişiyle açılıyor.',
      'Karia paneli panel.karia.live adresine taşındı.',
      'Site Cloudflare korumasına alındı.',
    ],
  },
  {
    id: 7,
    area: 'minecraft',
    items: [
      'karia.live/minecraft sayfası açıldı: sunucu durumu, adres ve Discord bilgileri.',
      'Discord coin bakiyesini Minecraft ile ortak kullanacak hesap bağlama altyapısı hazırlandı. Sunucu açılınca devreye girecek.',
    ],
  },
  {
    id: 8,
    items: [
      'Seviye atlayınca coin kazanılıyor: ulaşılan seviyenin 5 katı.',
      'Seviye rolleri, Hata Avcısı, Erken Destekçi ve Prime rolleri alınınca tek seferlik coin ödülü veriliyor. En büyük ödül 100. seviyede.',
    ],
  },
  {
    id: 9,
    items: [
      'Prime ve Takviye ayrı roller oldu: Takviye pembe, Prime mor.',
      'Her ay en çok oy veren üye 30 gün Prime, takviye çekilişini kazanan üye 30 gün Prime ve 1.000 coin kazanıyor.',
      'Hata Bildirimi ve Sponsorluk taleplerinde yönetici onayıyla rol veriliyor.',
      'Oy Ver kanalı Top.gg butonuna geçti, Roller kanalına tüm roller yazıldı.',
    ],
  },
];
