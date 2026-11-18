# Lavalink (ses kanalı müziği)

Botun ses kanalındaki müziği Lavalink'te çalınır. Ses filtreleri (8D, Bass boost, Nightcore, Slowed) de orada uygulanır. Lavalink botla aynı makinede, sadece `127.0.0.1:2333` üzerinde çalışır. Bot ona `shoukaku` ile bağlanır (`src/systems/lavalink.js`).

```
Discord ses kanalı ◄── Lavalink (Java, pm2 "Lavalink") ◄── bot (pm2 "KariaLocal")
                        │  YouTube (youtube-source eklentisi)
                        └─ http://127.0.0.1:<rastgele>/relay/…  ◄── bot: yt-dlp + ffmpeg (köprü)
```

## Bot ne zaman neyi kullanır

| Durum | Ne olur |
|---|---|
| Lavalink açık | Aramalar ve linkler Lavalink'te çözülür, ses Lavalink'ten gider, filtreler çalışır. |
| YouTube Lavalink'e "bot musun" der (veri merkezi IP'lerinde sık görülür) | Şarkı bugünkü yolla alınır: yt-dlp + ffmpeg. Ses, sadece 127.0.0.1'de açık bir köprüden Lavalink'e verilir, filtreler yine çalışır. Bu durumda 20 dakika boyunca YouTube şarkıları doğrudan köprüden çalınır. yt-dlp de engellenirse aynı şarkı SoundCloud'da aranır. |
| SoundCloud linki | Lavalink 4.2.2'nin SoundCloud kaynağı SoundCloud'un yeni biçimlerini okuyamıyor, bu yüzden SoundCloud şarkıları hep köprüden çalınır. |
| Çalarken Lavalink kopar | 20 saniye beklenir. Lavalink dönerse (pm2 yeniden başlatır) şarkı kaldığı yerden sürer. Dönmezse sıra aynı kanalda eski yola (yt-dlp + @discordjs/voice) geçer, çalan şarkı baştan başlar ve filtre kapanır. Kanala da bunu söyleyen bir mesaj yazılır. |
| `LAVALINK_*` tanımlı değil ya da Lavalink kapalı | Yeni sıralar eski yolla çalar. `/filtre` "Filtreler şu an kullanılamıyor" der. |

Etkinliğin "burada dinle" modu (tarayıcıda çalma) Lavalink'i kullanmaz, her zaman yt-dlp ile çalışır.

Köprü bot içinde sadece 127.0.0.1'de açılır. Bu yüzden Lavalink botla aynı makinede olmalı; başka bir makineye taşınırsa köprüden çalınan şarkılar çalmaz.

## VM'e kurulum (Azure, Ubuntu)

Komutlar VM'de `azureuser` olarak çalıştırılır. Bot klasörü `~/KariaLocal/bot`.

### 1. Java 17 veya üstü

```bash
sudo apt update && sudo apt install -y openjdk-21-jre-headless
java -version
```

### 2. Lavalink ve yapılandırma

Bu klasördeki `application.example.yml` ile `ecosystem.config.cjs` dosyalarını VM'de `~/KariaLocal/bot/lavalink/` altına koy (deploy yamasıyla gelir). Sonra:

```bash
cd ~/KariaLocal/bot/lavalink
curl -L -o Lavalink.jar https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar
sha256sum Lavalink.jar   # 8cb801e591072c3689fafd71ccf571a95a4ead3cc35dfc045e157d763d89119a olmalı
cp application.example.yml application.yml
```

YouTube eklentisini (`youtube-plugin 1.18.2`) Lavalink ilk açılışta kendisi indirir ve `plugins/` klasörüne koyar.

### 3. Şifre: bot/.env

`~/KariaLocal/bot/.env` dosyasına ekle. Şifre uzun ve rastgele olmalı, örneğin `openssl rand -hex 24` ile üretilebilir:

```
LAVALINK_HOST=127.0.0.1
LAVALINK_PORT=2333
LAVALINK_PASSWORD=<rastgele uzun şifre>
```

Lavalink de şifreyi aynı dosyadan okur (`ecosystem.config.cjs`), yani şifre iki yerde tutulmaz. Azure'da 2333 numaralı porta dışarıdan izin verme: Lavalink sadece 127.0.0.1'de dinler.

### 4. pm2 ile başlat

```bash
cd ~/KariaLocal/bot/lavalink
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs Lavalink --lines 40
```

Günlükte `YouTube source initialised` ve `Lavalink is ready to accept connections.` satırları görünmeli. Hızlı deneme:

```bash
cd ~/KariaLocal/bot && set -a && . ./.env && set +a
curl -s -H "Authorization: $LAVALINK_PASSWORD" "http://127.0.0.1:2333/v4/loadtracks?identifier=ytsearch:tarkan%20kuzu%20kuzu" | head -c 300
```

### 5. Botu güncelle

```bash
cd ~/KariaLocal/bot
npm install           # yeni bağımlılık: shoukaku
pm2 restart KariaLocal
pm2 logs KariaLocal --lines 40
```

Açılışta `[Lavalink] Bağlandı (127.0.0.1:2333).` yazmalı. Discord'da `/cal` ile bir şarkı aç, `/filtre` ya da paneldeki "Ses filtresi" menüsüyle filtre değiştir.

## Bellek

Lavalink `-Xmx512m` ile başlar ve toplamda yaklaşık 400–600 MB kullanır. VM'in RAM'i azsa `ecosystem.config.cjs` içindeki `-Xmx` değerini düşür (en az 256m). Değişiklikten sonra `pm2 restart Lavalink` yap.

## YouTube Lavalink'i sürekli engellerse (isteğe bağlı)

Bot zaten köprüyle çalmaya devam eder, ama YouTube'u doğrudan Lavalink'te çalmak daha az CPU harcar. youtube-source için OAuth açılabilir. Bunun için **ana hesabını değil, ayrı bir Google hesabı** kullan, çünkü hesap kısıtlanabilir:

1. `application.yml` içinde `oauth:` bölümünün yorumlarını kaldır, `refreshToken` satırını şimdilik yorumda bırak.
2. `pm2 restart Lavalink && pm2 logs Lavalink`. Günlükte google.com/device adresi ve bir kod çıkar. Ayrı hesapla giriş yap.
3. Günlükte yazan refresh token'ı `bot/.env` dosyasına `LAVALINK_YT_REFRESH_TOKEN=` olarak ekle, `refreshToken` satırının yorumunu kaldır.
4. Bu klasörde `pm2 restart ecosystem.config.cjs --update-env && pm2 save` çalıştır. Böylece `.env` yeniden okunur.

## Geri alma

`bot/.env` içindeki `LAVALINK_HOST` satırını sil ya da yoruma al ve `pm2 restart KariaLocal` yap. Müzik eski yolla çalar. Lavalink'i durdurmak için `pm2 stop Lavalink`.

## Yerelde (Windows) deneme

```powershell
cd bot\lavalink
copy application.example.yml application.yml
$env:LAVALINK_PASSWORD = "<bot/.env ile aynı>"
java -Xmx512m -jar Lavalink.jar
```

`Lavalink.jar`, `plugins/`, `logs/` ve `application.yml` git'e girmez (`.gitignore`).
