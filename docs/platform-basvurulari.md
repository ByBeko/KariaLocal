# Platform başvuru metinleri

Panel: https://activity.karia.live (Yönetim > Sosyal Paylaşım). Yalnızca Karia yetkilileri kullanır.
Gizlilik: https://karia.live/yasal/gizlilik.html · Koşullar: https://karia.live/yasal/hizmet-kosullari.html
İletişim: medya@karia.live

## Google OAuth doğrulaması (Google Cloud > Karia Sosyal > Verification Center)

**Kapsamlar neden gerekli (youtube.upload, youtube.readonly):**

> Karia is a gaming community (karia.live). Our staff use a private admin panel at activity.karia.live to publish our own finished videos to our official YouTube channel "Karia". youtube.upload is used only to upload the video file with the title and description the staff member typed. youtube.readonly is used only once after sign-in to read the connected channel's name and ID so the panel can show which channel is connected. We never read, modify or delete other users' content, and we do not store any YouTube data other than the channel ID, channel name and the OAuth tokens (encrypted at rest).

**Tanıtım videosunda gösterilecekler (YouTube'a liste dışı yüklenip bağlantısı forma yazılır):**
1. activity.karia.live açılır, Yönetim > Sosyal Paylaşım.
2. YouTube kartında "Bağla" > Google onay ekranı (uygulama adı "Karia" ve istenen izinler görünür) > izin ver.
3. Panelde kanal adı "Karia" görünür.
4. Bir video seçilir, başlık ve açıklama yazılır, "Paylaş".
5. YouTube Studio'da videonun aynı başlıkla geldiği gösterilir.

## YouTube API Services Audit and Quota Extension formu

- Organization: Karia (karia.live) — gaming community
- Website: https://karia.live
- API client: activity.karia.live internal admin panel
- Number of users: internal staff only (under 10)
- Use case:

> We upload our own community videos (events, Minecraft server content) to our single official channel from an internal staff panel. One upload at a time, triggered manually by staff. No data is shown to the public, no third-party channels are accessed. Expected usage: a few uploads per day. We request an audit so uploads can be public; the default quota is enough.

## TikTok uygulama incelemesi (developers.tiktok.com > Karia > Production > Submit for review)

**Ürün ve izin açıklaması** (Production'a zaten yazıldı):

> Karia is a private admin panel at activity.karia.live used only by the Karia community staff. Login Kit (user.info.basic) connects the official Karia TikTok account once; the panel shows the connected account name. Content Posting API (video.publish) lets staff upload a finished video with a caption and publish it directly to that account, together with the same video on our YouTube and Instagram accounts. No other TikTok users' data is accessed.

**Tanıtım videosu (Sandbox ile çekilir, en fazla 50 MB mp4):**
1. activity.karia.live > Yönetim > Sosyal Paylaşım.
2. TikTok kartında "Bağla" > TikTok izin ekranı > izin ver > panelde hesap adı.
3. Video seçilir, açıklama yazılır; panel TikTok'un gizlilik seçeneklerini ve içerik onayını gösterir; "Paylaş".
   Panelde "TikTok ayarları" bölümü: hesap adı, varsayılansız gizlilik seçimi (creator_info'dan), işaretsiz yorum/düet/stitch (hesapta kapalıysa soluk), ticari içerik beyanı (Kendi markan / Markalı içerik; markalı içerikte "Yalnızca ben" kapalı), Müzik Kullanım Onayı ve Markalı İçerik Politikası bağlantıları, süre sınırı uyarısı. Videoda bu bölüm açıkça gösterilmeli.
4. TikTok uygulamasında videonun hesaba geldiği gösterilir.
