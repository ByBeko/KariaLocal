# Karia Kurucu

Oyuncuların Karia modlu sunucusuna girmesi için tek tıklık kurulum. İndirme: https://karia.live/kurucu/KariaKurucu.exe

## Oyuncu ne yapar
1. Resmi Minecraft Launcher kurulu olmalı ve en az bir kez açılmış olmalı (oyunu satın almış Microsoft hesabı).
2. Minecraft Launcher'ı kapatır, `KariaKurucu.exe`'yi çalıştırır, **Kur / Güncelle**'ye basar.
3. Launcher'ı açar, sol alttan **Karia** profilini seçer, **Oyna**. Sunucu listesinde `karia.live` hazır.
Güncelleme: kurucuyu tekrar çalıştırmak yeter.

## Ne yapar
- Java 21 (Eclipse Temurin JRE) → `%LOCALAPPDATA%\KariaKurucu\java21` (SHA256 doğrulamalı)
- NeoForge (sürüm manifest'te) resmi kurucusuyla `--install-client`
- Modlar/gölgelendiriciler → `%APPDATA%\.minecraft\karia\` (listede olmayan jar'lar `mods_eski`'ye taşınır, silinmez)
- `servers.dat` (yoksa) ve `options.txt` (yoksa, Türkçe)
- `launcher_profiles.json` (+ Microsoft Store sürümü) içine `karia` profili; ilk değişiklikte `.karia-yedek` kopyası
- Hesap/giriş bilgilerine dokunmaz.

## Güncelleme yayınlamak (mod listesi değişince)
1. `../modpaket` araçlarıyla `paket.json`'u güncelle.
2. `python ../modpaket/araclar/kurucu_manifest.py ../modpaket <karia.live>/public/kurucu/manifest.json <yeni-sürüm>`
3. VM'de `~/karia.live/public/kurucu/manifest.json`'u değiştir, `pm2 restart karia-live`.
Kurucunun yeniden derlenmesi gerekmez (manifest'i her açılışta okur).

## Derleme
```
python -m venv venv && venv\Scripts\pip install pyinstaller==6.16.0
venv\Scripts\python -m PyInstaller --onefile --windowed --name KariaKurucu --icon <tam yol>\karia.ico --add-data "<tam yol>\karia_ikon.png;." karia_kurucu.py
```
`--collect-data certifi` ekle (Windows'un eski sertifika zinciri karia.live/maven.neoforged.net'i "süresi dolmuş" sanıyor; kurucu güncel Mozilla kök listesini kullanır).
Yeni exe'yi VM'ye koyduktan sonra Cloudflare önbelleğinden `https://karia.live/kurucu/KariaKurucu.exe` adresini temizle (Caching → Custom Purge), yoksa eskisi iner.
İmzasız olduğu için Windows SmartScreen "bilinmeyen yayıncı" uyarısı verebilir (Ek bilgi → Yine de çalıştır).
