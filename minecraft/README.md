# Karia Kurucu

Karia modlu Minecraft sunucusu (`karia.live`, NeoForge 1.21.1 + Arclight) için oyuncu kurucusu ve mod listesi araçları.

- **`kurucu/`**: `KariaKurucu.exe`'nin kaynağı. Resmi Minecraft Launcher'a Java 21, NeoForge ve modları kurar, "Karia" profilini ekler. Ayrıntılar: [kurucu/BENIOKU.md](kurucu/BENIOKU.md)
- **`modpaket/`**: Mod listesini (`paket.json`) üreten ve güncelleyen araçlar, sunucu uyumluluk veri paketi. Ayrıntılar: [modpaket/BENIOKU.md](modpaket/BENIOKU.md)

## Hızlı başlangıç (geliştirme)
```
cd kurucu
python -m venv venv
venv\Scripts\pip install pyinstaller==6.16.0 certifi
venv\Scripts\python karia_kurucu.py          # arayüzle çalıştır
```

## Mod listesini güncellemek
1. `modpaket/araclar/sec.py` → `birlestir.py` (gerekirse `bagimlilik.py <modid>`)
2. `python modpaket/araclar/bagimlilik_denetle.py <mods klasörü> client` ile eksik bağımlılık kontrolü
3. `python modpaket/araclar/kurucu_manifest.py modpaket <karia.live>/public/kurucu/manifest.json <yeni-sürüm>`
4. Manifest'i karia.live'a yükle; oyuncular kurucuyu tekrar çalıştırınca güncellenir.

## Kurallar
- Sırlar (şifre, token, API anahtarı) depoya girmez.
- Korsan (çevrimdışı) giriş kurucuya eklenmez; giriş resmi Minecraft Launcher'da kalır.
