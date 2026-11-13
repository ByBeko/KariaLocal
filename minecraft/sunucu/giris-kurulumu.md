# Sunucu girişi: premium + çevrimdışı

Sunucu: Saganetwork paneli, sunucu `karia` (NeoForge 1.21.1 + Arclight). Durum 2026-11-14'te panelden kontrol edildi.

## Mevcut durum (zaten hazır)

- `server.properties`: `online-mode=false`, `enforce-secure-profile=false`.
- **MixAuth** modu (`mods/mixauth-1.21.1-1.3.3.jar`, ayarlar `config/mixauth-server.toml`, veritabanı `mixauth/`):
  - **Premium** oyuncu Mojang ile otomatik doğrulanır, şifre sormaz, gerçek UUID'sini korur.
  - **Çevrimdışı** oyuncu ilk girişte şifre belirler, sonraki girişlerde şifreyle girer (bcrypt, 3 yanlış denemede 5 dk blok, 24 saat güvenilir oturum).
- Karia Launcher'ın çevrimdışı modu (Hesaplar → Çevrimdışı oyuncu) bununla uyumlu.

**AuthMe kurma.** MixAuth aynı işi NeoForge tarafında yapıyor. İkisi birlikte çift giriş ekranı ve çakışma çıkarır.

## Bilinmesi gerekenler

- Çevrimdışı oyuncu, **premium bir hesaba ait kullanıcı adını** seçerse MixAuth onu premium sayar ve Mojang doğrulaması ister. Oyuncu giremez. Çevrimdışı oyuncular kimsenin almadığı bir ad seçmeli.
- MixAuth'un varsayılan dili `en_us`. `config/mixauth-server.toml` içinde `auto_detect_player_language = true` açık; Türkçe istemci dili olan oyuncular Türkçe mesaj görür (mod Türkçe çeviri içeriyorsa).

## İsteğe bağlı

- **Skin:** Çevrimdışı oyuncular Steve/Alex görünür. SkinsRestorer (`plugins/`) eklenirse `/skin <isim>` ile skin seçilebilir. Arclight uyumu kurulumdan sonra test edilmeli.
- **Bedrock (Geyser + Floodgate-NeoForge, `mods/`):** Deneysel. Modlu içerik Bedrock'ta görünmez; NeoForge sunucusu Bedrock oyuncusunu eksik mod diye reddedebilir. UDP 19132 portu panelin Port Yönetimi'nden açılmalı.

## Test listesi

- [ ] Premium hesapla gir → şifre sormadan girmeli.
- [ ] Karia Launcher → Hesaplar → Çevrimdışı oyuncu → yeni bir ad → Oyna → şifre belirle.
- [ ] Çık, tekrar gir → şifre (ya da 24 saat içinde aynı yerden ise otomatik) ile girmeli.
- [ ] Aynı çevrimdışı adla yanlış şifre → 3 denemede blok.
