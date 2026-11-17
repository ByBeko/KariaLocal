# Sunucu Rehberi Doldurma Listesi

Discord bu sayfayı botların doldurmasına izin vermiyor. **Sunucu Ayarları → Onboarding → Sunucu Rehberi** bölümüne aşağıdakileri yaz. Kod bloklarındaki metni olduğu gibi (emojisiyle) kopyala.

Discord sınırları: karşılama mesajı 300, başlık 60, açıklama 200 karakter. Yapılacaklar en az 3 en fazla 5, kaynak sayfası en fazla 7. Aşağıdaki metinlerin hepsi bu sınırların içinde.

Kaynak sayfası açıklamaları sunucunun kendi Karia emojileriyle başlar: `<:Karia_ad:id>` yazısını olduğu gibi yapıştır, rehberde emoji olarak görünür (ayarlar listesinde yazı olarak kalır). Discord'un yapılacaklar penceresinde açıklama ve emoji alanı yok; orada sadece başlık, kanal ve küçük resim seçilir.

## 👋 Karşılama mesajı

Yazar olarak sunucu sahibini seç. `[@username]` yazan yere Discord yeni üyenin adını koyar.

```
Karia'ya hoş geldin [@username]! 👋 Yazılım, oyun ve Minecraft'ı bir araya getiren topluluğumuza katıldın. Aşağıdaki adımları tamamla, rollerini seç ve sohbete katıl. Seste Etkinlikler menüsünden Karia Local'i açıp oyunlara katılabilirsin. 🌐 karia.live
```

## ✅ Yeni üye yapılacaklar

| # | Kanal | Tür | Emoji | Başlık |
|---|---|---|---|---|
| 1 | #kurallar | Kanalı görüntüle | `Karia_kitap` / 📜 | Kuralları oku |
| 2 | #roller | Kanalı görüntüle | `Karia_rozet` / 🎭 | Rollerini seç |
| 3 | #duyurular | Kanalı görüntüle | `Karia_megafon` / 📢 | Duyuruları takip et |
| 4 | #sss | Kanalı görüntüle | `Karia_soru` / ❓ | Sık sorulanlara göz at |
| 5 | #sohbet | Mesaj gönder | `Karia_mesaj` / 💬 | Sohbete merhaba de |

**1. Kuralları oku**

```
📜 Sohbete başlamadan önce sunucu kurallarını oku. Kurallara uymak hem seni hem topluluğu korur; bilmemek kuralı çiğnemek için mazeret sayılmaz.
```

**2. Rollerini seç**

```
🎭 İlgi alanı ve bildirim rollerini seç, sadece ilgilendiğin duyurular sana gelsin. Seçmediğin rolleri istediğin zaman menüden geri alabilirsin.
```

**3. Duyuruları takip et**

```
📢 Etkinlikler, çekilişler, güncellemeler ve Karia ile ilgili resmi haberler ilk burada paylaşılır. Hiçbir gelişmeyi kaçırma!
```

**4. Sık sorulanlara göz at**

```
❓ Seviye, coin, üyelik kademeleri, Minecraft ve bot komutları hakkında aklına takılan çoğu sorunun cevabı burada. Sormadan önce bir göz at.
```

**5. Sohbete merhaba de**

```
💬 Kendini tanıt ve topluluğa katıl! Mesaj yazarak ve seste vakit geçirerek XP kazanırsın; 5. seviyeden 50. seviyeye kadar her 5 seviyede yeni bir rol açılır.
```

## 📚 Kaynak sayfaları

Her sayfanın ikonu `bot/assets/onboarding/kaynak-ikonlar/` klasöründe (512x512, yazısız, küçük boyutta da okunur). Sayfayı düzenle → ikonu değiştir ile yükle. Başlık yazılı eski görseller `bot/assets/onboarding/rehber/` klasöründe duruyor.

| # | Kanal | İkon | Başlık |
|---|---|---|---|
| 1 | #kurallar | `kurallar.png` (belge) | Kurallar |
| 2 | #sss | `sss.png` (soru balonu) | Sık Sorulan Sorular |
| 3 | #roller | `roller.png` (kişi + artı) | Rollerini Seç |
| 4 | #takviyeler | `takviyeler.png` (elmas) | Takviyeler |
| 5 | #bağlantılar | `baglantilar.png` (zincir) | Bağlantılar |
| 6 | #oy-ver | `oy-ver.png` (alev) | Oy Ver |
| 7 | #destek-talebi | `destek-talebi.png` (can simidi) | Destek Talebi |

**1. Kurallar**

```
<:Karia_kitap:1568696930400473202> Karia'nın temel kuralları. Saygılı ol, spam ve reklam yapma, kurallara uymayanlara uyarı ve ceza uygulanır. Sohbete başlamadan önce mutlaka oku.
```

**2. Sık Sorulan Sorular**

```
<:Karia_soru:1568696909755846680> Seviye ve XP, coin ödülleri, VIP'ten Prime'a üyelik kademeleri, Minecraft IP'si ve komutlar. En çok sorulan soruların cevapları tek sayfada.
```

**3. Rollerini Seç**

```
<:Karia_rozet:1568722560533925909> Menüden bildirim ve ilgi alanı rollerini seç; ruh halini ve rozetini de buradan ayarla. Seçmediğin roller üzerinden otomatik alınır.
```

**4. Takviyeler**

```
<:Karia_elmas:1568986769808957460> Takviye yapanlar ve ayrıcalıkları. İlk takviyende 2.500 coin kazanırsın, her ay takviye yapanlar arasından 1 kişiye 30 gün Prime ve 1.000 coin çıkar.
```

**5. Bağlantılar**

```
<:Karia_zincir:1568732258461024387> Resmi hesaplarımız: karia.live • Instagram ve TikTok: @karia.live • YouTube: @karialivemedya • Minecraft: karia.live/minecraft. Başkaları bize ait değil.
```

**6. Oy Ver**

```
<:Karia_alev:1568696770891088024> Top.gg'de 12 saatte bir oy ver, Disboard'da 2 saatte bir /bump yap. Sıralama her Pazar 20.00'de açıklanır, ayın en çok oy veren üyesi 30 gün Prime kazanır!
```

**7. Destek Talebi**

```
<:Karia_cankurtaran:1568696969659162775> Minecraft sorunu, hata bildirimi ya da sponsorluk için menüden talep aç; sadece sen ve yetkililerin gördüğü bir kanal açılır. Üye şikayeti için /rapor kullan.
```
