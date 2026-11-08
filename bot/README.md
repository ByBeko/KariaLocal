# Karia Bot

Karia Discord sunucusuna özel bot. discord.js v14, Node.js 22.13+ ve yerleşik SQLite (`data/karia.db`) kullanır.

## 1. Discord Developer Portal

1. https://discord.com/developers/applications → **New Application** → adı `Karia`
2. **Bot** sekmesi:
   - **Reset Token** → token'ı kopyala (kimseye verme!)
   - **Privileged Gateway Intents** altında **Server Members Intent** ve **Message Content Intent** açık olmalı
3. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`, izin olarak `Administrator` → çıkan linkle botu sunucuya ekle
4. Sunucu Ayarları → Roller: **bot rolünü listenin en üstüne yakın** taşı (Moderatör, Personel, Sunucu Üyesi, Jail gibi rollerin üstünde olmalı, yoksa bu rolleri veremez)

## 2. Çalıştırma

```bash
npm install
cp .env.example .env    # sonra .env içine DISCORD_TOKEN ve GUILD_ID yaz
npm start               # geliştirirken: npm run dev (dosya değişince yeniden başlar)
```

`npm run check`: Discord'a bağlanmadan tüm komutların yüklendiğini kontrol eder.

MC IP'si, website ve sosyal medya linkleri `src/config.js` dosyasından ayarlanır.

## 3. Discord içinde ilk kurulum

```
/ayarla rol ayar:Yetki: Personel   rol:@Personel
/ayarla rol ayar:Yetki: Moderatör  rol:@Moderatör
/ayarla rol ayar:Üye rolü          rol:@Sunucu Üyesi
/ayarla rol ayar:Bot rolü          rol:@Botlar

/kurulum loglar      → gizli log kategorisi + 11 log kanalı (eksikleri tamamlar)
/kurulum jail        → Jail rolü + #jail kanalı (diğer kanallar jail rolüne gizlenir)
/kurulum talep       → gizli talep kategorisi

/ayarla kanal ayar:Hoş geldin kanalı            kanal:#sohbet
/ayarla kanal ayar:Kurallar kanalı              kanal:#kurallar
/ayarla kanal ayar:Roller kanalı                kanal:#roller
/ayarla kanal ayar:Takviye teşekkür kanalı      kanal:#takviyeler
/ayarla kanal ayar:Öneri kanalı                 kanal:#öneriler
/ayarla kanal ayar:Sadece medya kanalı (galeri) kanal:#galeri
/ayarla kanal ayar:Özel Oda Oluştur ses kanalı  kanal:🔊Özel Oda Oluştur

/panel tur:Destek talebi   (#destek-talebi kanalında)
/panel tur:Bağlantılar     (#bağlantılar kanalında)
/rol-menu ekle rol:@Duyuru emoji:📢 aciklama:Duyurularda etiketlen
/panel tur:Rol seçimi      (#roller kanalında)
```

Tüm ayarları görmek için `/ayarlar` kullan.

**Doğrulama (isteğe bağlı):** `/ayarla ac-kapat ayar:Doğrulama durum:True` ve `#kurallar` kanalında `/panel tur:Doğrulama`. Bu açıkken yeni gelenler üye rolünü butona basınca alır. Bunun işe yaraması için @everyone rolünün kanalları göremediği, Sunucu Üyesi rolünün görebildiği bir izin düzeni gerekir.

## Analiz ve yapay zeka

- **İstatistik:** Bot mesaj sayılarını (içerik değil), ses sürelerini (sağırlaştırılmış/AFK hariç) ve giriş/çıkışları kaydeder.
  `/istatistik`, `/siralama`, `/analiz` (Personel+). Bot kurulmadan önceki mesajlar için tek seferlik `/gecmis-tara`.
- **Denetim:** `/denetim` (Yönetici) izin, rol, kanal ve ayar sorunlarını puanlayarak listeler; bazılarını butonla düzeltir.
- **Yapay zeka:** `/sor` veya `@Karia soru`. Ollama üzerinde çalışan **Qwen3.5** (`qwen3.5:4b`) kullanır (yerel, ücretsiz). Sunucunun kanallarını, rollerini,
  #kurallar ve #sss içeriğini bilir; istatistik/sıralama/MC durumu için kendi araçlarını çağırır, yetkililere denetim sonuçlarını da yorumlar.

### Ollama kurulumu (yapay zeka için)

1. https://ollama.com/download adresinden Windows sürümünü kur (arka planda kendiliğinden çalışır).
2. Modeli indir (~3.3 GB, RTX 3060 6 GB ekran kartına tamamen sığar):
   ```bash
   ollama pull qwen3.5:4b
   ```
3. Bot yeniden başlatmaya gerek olmadan `/sor` çalışmaya başlar. Farklı model/adres için `.env` → `AI_MODEL`, `AI_URL`.

Bot bir sunucuya (VPS) taşınırsa Ollama'nın da orada çalışması (ve tercihen GPU) gerekir; ya da `AI_URL` ile Ollama'nın çalıştığı makineye bağlanılır.

## Topluluk sistemleri

- **Seviye (rank):** Mesaj (dakikada bir 10-20 XP) ve ses (en az 2 kişiyken dakikada 3 XP) ile XP. `/seviye` (kart, siralama, oduller), `/seviye-ayar` (ödül rolü, XP ver/al, sıfırla).
  İlk açılışta mevcut mesaj/ses istatistiklerinden başlangıç XP'si verilir. Seviye atlamalar `#seviye-log` kanalına düşer.
- **Ekonomi ve oyunlar:** `/bakiye`, `/gunluk`, `/calis`, `/gonder`, `/coinflip`, `/slot`, `/blackjack`; yönetim: `/ekonomi-ayar`. Sanal paradır, gerçek değeri yoktur.
- **Çekiliş:** `/cekilis baslat|bitir|yeniden|liste` (Personel+). Bot kapalıyken biten çekilişler açılınca sonuçlanır.
- **Müzik (YouTube):** `/cal`, `/gec`, `/duraklat`, `/dur`, `/sira`, `/simdi`, `/ses`, `/dongu`, `/karistir` + "şimdi çalıyor" panelindeki butonlar.
  Ses yt-dlp ile alınır (`npm install` sırasında `node_modules/youtube-dl-exec/bin` içine iner), ffmpeg `ffmpeg-static` paketinden gelir.
  YouTube değişiklik yaptıkça yt-dlp güncellenmelidir: `node_modules/youtube-dl-exec/bin/yt-dlp.exe -U`. Linux VPS'te yt-dlp için `python3` gerekir.
  Kalabalık kanalda şarkı geçme oylamayla, durdurma yetkililerle olur. Kanal boşalınca 1 dk, sıra bitince 3 dk sonra bot ayrılır.
- **Oto cevap:** `/oto-cevap ekle|sil|liste` (Yönetici).
- **Rol / süreli rol:** `/rol ver kullanici rol [sure]`, `/rol al` (Moderatör+).
- **Emoji / çıkartma:** üyeler `/emoji liste|bilgi` ve `/cikartma`; yetkililer `/ifade emoji-ekle|emoji-sil|cikartma-ekle|cikartma-sil`.
- **Yardım:** üyeler sadece kendi komutlarını görür; yetkililerde ek olarak sadece kendilerine görünen **Yetkili Paneli** (Personel / Moderatör / Yönetici) vardır.
- **Oto cevap:** tetik mesajın herhangi bir yerinde, Türkçe ekleriyle ("ip'si", "ipini") yakalanır. Değişkenler: `{user} {server} {count} {ip} {site}`.
- **Özel durum taraması:** `/durumtara` için Developer Portal → Bot → **Presence Intent** açılmalı (açık değilse bot yine çalışır, sadece bu komut uyarı verir).
- **Bilgi:** `/avatar`, `/kullanici-bilgi`, `/sunucu-bilgi`, `/bot-bilgi`, `/takviye`, `/siralama tur:seviye|para`.

## Otomatik sistemler

- **Rehber:** `/rehber` kanalları listeler. "yardım lazım", "nasıl rol alırım" gibi mesajlara ilgili kanalla cevap verilir. Kalıplar `src/systems/guide.js`, kanal açıklamaları `src/channelGuide.js` içindedir.
- **Haftalık güncelleme:** `#karia-bot` forumundaki tek başlığa her Pazar 20:00'de yazılır. Yeni maddeler `src/changelog.js` dosyasına eklenir (`id` bir artar), yeni komutlar kendiliğinden algılanır.
- **Kanal kontrolü:** Açılışta, saatte bir ve kanal değişince çalışır. Boş kanal açıklamalarını doldurur, bilgi kanallarını yazmaya kapatır, log kanallarını ve Jail'i gizler, destek panelini günceller. Yaptıklarını `#mod-log` kanalına yazar.

- **Toplu saldırı koruması:** `src/systems/antinuke.js`. Bir hesap 1 dakikada 3 kanal veya rol siler ya da 5 kişiyi banlar/atarsa rolleri alınır, botsa atılır, banlar geri alınır. Sunucu sahibi muaftır. Silinen kanal ve roller geri gelmez.

## Ön ekler: `kari`, `kl`, `k`

Komut olmayan bir şey yazılırsa yapay zeka sohbet eder: `kari naber`, `kl minecraft'ta elmas nerede çıkar`. Botun yapay zeka cevabına yanıt vererek sohbete devam edilir. Yasa dışı/zararlı istekler ön kontrolde reddedilir. Tek harfli `k` ile sohbet için en az 2 kelime gerekir ("k tamam" yakalanmasın).

Her slash komutu mesajla da çalışır (ön ek `src/config.js` içindeki `prefix`):

```
kl yardim                      kl yardim ban
kl ban @kişi reklam yaptı 7    kl mute @kişi 10dk küfür
kl sil 20                      kl ayarla ac-kapat anti_link evet
kl ayarla deger welcome_message "Hoş geldin {user}!"
kl emoji-yukle                 (mesaja .zip eklenerek)
```

Boşluklu bir değeri sonraki seçeneklerden ayırmak için "tırnak" kullan. Yeni yazılan komutlar ek kod gerekmeden `kl` ile de çalışır, istenirse `aliases: ['kisa']` ile kısa yol eklenebilir.

## Yetki seviyeleri

| Seviye | Nasıl olunur | Komutlar |
|---|---|---|
| Personel | `staff_role` veya *Üyelere Zaman Aşımı Uygula* izni | mute, unmute, uyar, sicil, temizle, yavasmod |
| Moderatör | `mod_role` veya *Üyeleri Yasakla* izni | + ban, unban, kick, jail, unjail, kilit, uyari-sil, raid |
| Yönetici | `admin_role` veya *Yönetici* izni | + ayarla, ayarlar, kurulum, panel, rol-menu |

Komutlar varsayılan olarak ilgili Discord iznine sahip olanlara görünür. Farklı bir düzen için: Sunucu Ayarları → Entegrasyonlar → Karia.

## Klasör yapısı

```
src/
  index.js            giriş noktası
  config.js           MC IP, linkler, talep kategorileri
  core/               veritabanı, ayarlar, komut/olay yükleyici
  commands/<kategori> slash komutları (yeni dosya = yeni komut, otomatik yüklenir)
  components/         buton / menü / modal'lar (customId "prefix:aksiyon")
  events/             Discord olayları
  systems/            moderasyon, koruma, özel oda, minecraft, paneller
  utils/              embed, süre, yetki, log yardımcıları
```

### Yeni komut eklemek

`src/commands/<kategori>/komut.js`:

```js
import { SlashCommandBuilder } from 'discord.js';
import { Level } from '../../utils/permissions.js';

export default {
  level: Level.USER, // USER | STAFF | MOD | ADMIN
  data: new SlashCommandBuilder().setName('selam').setDescription('Selam verir.'),
  async execute(interaction) {
    await interaction.reply('Selam!');
  },
};
```

Bot yeniden başlayınca komut sunucuya otomatik yüklenir.
