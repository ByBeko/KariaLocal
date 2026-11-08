// Haftalık güncelleme yazısının kaynağı. Bot değiştikçe yeni bir kayıt ekle (id her seferinde bir artar).
// Yayınlanmamış kayıtlar bir sonraki haftalık yazıya girer. Yeni komutlar ayrıca otomatik algılanır.
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
      'Yazı tura, slot ve blackjack yeni görünümde. Yeni oyuncular 200 coin ile başlıyor, günlük ödül 10 coin.',
      'Yardım menüsü sadeleştirildi.',
      'Seviye atlamak artık daha zor; mevcut seviyeler korundu.',
      'Karia Etkinliği yenilendi: casino masası, slot makinesi, kürsülü sıralama ve müzik oynatıcısı.',
    ],
  },
];
