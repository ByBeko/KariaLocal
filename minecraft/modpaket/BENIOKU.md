# Karia Berk — NeoForge 1.21.1 modpaketi

Claws of Berk (Forge 1.18.2, 152 mod) paketinin NeoForge 1.21.1'e taşınmış hâli.

## Oyuncular için
`dist/KariaBerk-1.21.1-1.0.0.zip` → CurseForge uygulaması → **Oluştur → İçe aktar** → zip'i seç.
En az 6 GB bellek ayır (CurseForge'da profil ayarları → Java belleği).

## Sunucu
- Yerel test sunucusu: `C:\Users\berke\karia-modlu\sunucu` (OneDrive dışında), JDK 21: `C:\Users\berke\karia-modlu\araclar`.
- Başlatma: `java -Xms4G -Xmx6G @libraries/net/neoforged/neoforge/21.1.265/win_args.txt nogui`
  (Linux'ta `unix_args.txt`).
- `world/datapacks/karia-uyum` (= `veri-paketi/`): Inferno'nun Book of Dragons yumurtalarına atıf yapan
  10 ganimet tablosunu düzeltir. Sunucuya gider, istemciye gerekmez.

## Araçlar (`araclar/`)
| Betik | Ne yapar |
|---|---|
| `sec.py` | Eski manifest'teki her mod için NeoForge 1.21.1 dosyası seçer → `secim.json`, `eksik.json` |
| `bagimlilik.py` | Eksik mod kimliğini CurseForge projesine çevirir → `ek_bagimlilik.json` |
| `birlestir.py` | Seçim + NeoForge karşılıkları + bağımlılıklar − çıkarılanlar → `paket.json` |
| `indir.py` | `paket.json`'daki modları indirir (`sunucu` kipinde istemciye özgüleri atlar) |
| `uyum_datapack.py` | Sunucu günlüğündeki bozuk ganimet tablolarını veri paketiyle düzeltir |
| `modpaket_olustur.py` | CurseForge içe aktarma zip'ini üretir |
| `rcon.py` | Yerel test sunucusuna komut gönderir |

Mod güncellemek: `sec.py` → `birlestir.py` → `indir.py` → sunucuyu dene → `modpaket_olustur.py <yeni sürüm>`.

## Dışarıda kalanlar
- Isle of Berk eklentileri ve kaynak paketleri (22): yalnızca 1.18.2, kaynak kapalı.
- Berk Adası haritası: 1.18.2 ve bu eklentilerin ejderhalarına bağlı.
- NeoForge 1.21.1 sürümü olmayanlar: Fairy Lights, ToroHealth, Friendly Fire, Alcocraft, Fantasy's Furniture,
  Biome Particle Weather, Connectible Chains, Pet Pass, No Chat Restrictions, Let Me Despawn.
- 1.21.1'de gereksiz/yerine geçilmiş: Embeddium ailesi, Oculus, Starlight, Fastload, MixinBooter, MemoryLeakFix vb.
  (yerlerine Sodium, Iris, ModernFix).
- Tam liste: `../mod-uyumluluk.csv`, `eksik.json`.
