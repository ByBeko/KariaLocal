# Sunucu değişiklikleri: 2026-11-14

Saganetwork paneli → sunucu `karia`. Sunucu kapalıyken dosyalar panelin dosya API'siyle düzenlendi. Değiştirilen her dosyanın yanında `<dosya>.karia-yedek-20261114` yedeği var. Geri almak için yedeği eski adına kopyala.

**Dünya adları (Arclight):** Ana dünyanın klasörü `world`, ama eklentilerdeki (Bukkit) adı **`hub`**. Ana oyun dünyası = `vahsi`. Multiverse, Arclight altında ana dünyayı yönetemiyor ("could NOT be loaded"). Bu durum daha önce de vardı. Bu yüzden hub ayarları WorldGuard, ConditionalEvents ve vanilla komutlarla yapıldı. `worlds.yml` içindeki `world` girdisine yapılan değişiklikler etkisiz.

## Hub
- **"Vahşi Dünya" yazısının kaynağı:** WorldGuard `hub` bölgesinin `farewell-title` başlığı. Başlık kaldırıldı.
- `plugins/WorldGuard/worlds/hub/regions.yml`: Hem `hub` bölgesi hem `__global__` (bütün dünya) korumalı.
  - Kapalı: hasar (düşme dahil), açlık, PvP, kırma/koyma, patlama, ateş, mob doğması, sandık açma.
  - Açık: kapı, buton, NPC tıklama, binme.
  - Sunucu konsolunda doğrulandı: 28 bayrağın hepsi tanındı.
- `plugins/ConditionalEvents/events/karia_events.yml`: `/hub`, `/spawn`, `/lobi` komutları ve her girişte `hub;0.43;100;0.516;-88.4;2.7` noktasına ışınlama (ses ve başlık efektiyle).
- Vanilla: `setworldspawn 0 100 0 -88.4` ve `spawnRadius 0`. Yatağı olmayan oyuncu hub'da doğar.
- Towny: `hub.txt` zaten `usingTowny=false` idi. `world.txt` düzenlemesi etkisiz (o adda dünya yok).
- `vahsi` için respawn dünyası `vahsi` olarak ayarlandı. **vahsi'nin doğma noktası `8 / -64 / 8`, oyun içinde düzeltilmeli.**

## Towny
- `plugins/Towny/settings/config.yml`: Kasaba ve ulus seviye unvanları Türkçeleştirildi:
  - Kasaba: Yerleşke → Mezra → Köy → Kasaba → Büyük Kasaba → Şehir → Büyük Şehir → Başkent.
  - Ulus: Beylik → Krallık → İmparatorluk.
- Ölünce kasaba doğma noktasında doğma açıldı (aynı dünyadaysa).
- Dil zaten `tr-TR`, ekonomi açık. **Ancak sunucuda ekonomi eklentisi yok** (aşağıya bak).

## TAB
- `plugins/TAB/config.yml`:
  - `use-online-uuid-in-tablist: false`: Çevrimdışı oyuncular tab listesinde düzgün görünür.
  - `proxy-support` kapatıldı (proxy yok).
  - Bossbar açıldı: 8 saniyede bir dönen duyurular. Oyuncular `/duyurubar` ile kapatabilir. Vanilla `/bossbar` ile çakışmasın diye komut değiştirildi.
- `plugins/TAB/animations.yml`: `karia-duyuru` animasyonu eklendi.
- Rütbe önekleri (`groups.yml`) zaten vardı, dokunulmadı.

## DeluxeMenus
- Menüler (`plugins/DeluxeMenus/gui_menus/`): `/menu` (`/karia`), `/bilgi`, `/ejderha`, `/krallik`, `/warp`. Tıklamalarda ses var. `config.yml` içinde kayıtlı.

## Performans
- `user_jvm_args.txt`: Aikar G1GC bayrakları eklendi. Panel sunucuyu `server.jar` ile başlatıyorsa bu dosya kullanılmaz.
- `view-distance=8`, `simulation-distance=6`, entity aktivasyon menzilleri zaten uygundu, değiştirilmedi.

## Eklentiler (ikinci tur)
- **KariaEkonomi 1.0.0** (Vault): Towny bunu kullanıyor (`Economy: KariaEkonomi via Vault`). `api.secret` boş olduğu için şimdilik herkes yerel cüzdan kullanıyor.
- **SkinsRestorer 15.12.6**: `/skin <isim>` komutu.
- **PhoenixCratesLite 6.8.0**: Örnek kasalar silindi.
  - `oy_sandigi` (anahtar: `oy_anahtari`)
  - `ejderha_sandigi` (anahtar: `ejderha_anahtari`)
  - Ödüller: elmas, altın elma, zümrüt, netherit, totem, elytra, büyülü elma ve `ekonomi ver` ile 250–3000 coin.
  - **Kasaların dünyaya yerleştirilmesi oyun içinden yapılmalı:** bloğa bakıp `/phoenixcrates attachCrate oy_sandigi`.
- **AzuVotifier 3.4.0** (NuVotifier yerine, Bukkit sürümü): Port `25697` (panelden ayrıldı, açılışta dinlediği doğrulandı). Oy sitelerine kayıt için token `plugins/Votifier/config.yml` içinde `tokens.default`.
- **VotingPlugin 7.1.1**:
  - Her oyda: 150 coin + 1 Oy Anahtarı (`SpecialRewards.yml` → `Cumulative.1`).
  - Günün ilk oyunda: ek olarak 1 Ejderha Anahtarı.
  - Oy siteleri ilk oy geldiğinde otomatik oluşturulur (`AutoCreateVoteSites`).
- **ajLeaderboards 2.11.0**: `vault_eco_balance`, `statistic_player_kills`, `statistic_hours_played` tabloları. PAPI eklentileri: Vault, Statistic.
- **DecentHolograms tabloları** (hub): `lb_zengin` (6.5/103.5/-7.5), `lb_oldurme` (6.5/103.5/8.5), `lb_aktiflik` (-4.5/103.5/0.5). Yerini değiştirmek için oyunda `/dh movehere <ad>`.
- **Kurulmayanlar:**
  - Geyser/Floodgate: NeoForge 1.21.1 için son Geyser 2.4.4 güncel Bedrock istemcilerini desteklemiyor.
  - Anti-cheat: Mod ve ejderha uçuşunda yanlış alarm veriyor.

## Üçüncü tur
- **LuckPerms:** Rütbe grupları (kurucu…kasif) zaten vardı. `0emry` kurucu grubunda.
- **Towny fiyatları (coin ekonomisine göre):**
  - Kurulum: kasaba 1500, ulus 7500, karakol 1000.
  - Toprak: claim 50, bonus blok 50.
  - Günlük bakım: kasaba 25, ulus 150.
  - Tarafsızlık: kasaba 200, ulus 500.
  - İsim değiştirme: 200 / 500.
  - Ölüm cezası: 0 (her ölümde bota işlem gitmesin diye).
- **Önemli düzeltme:** `vahsi` dünyasında sahipsiz arazide inşa, kırma, kapı/sandık ve eşya kullanımı kapalıydı (townyperms'de `towny.wild.*` yok). Dört ayar açıldı (`vahsi.txt` + `ta reload database`). Kasabalar korumalı kalıyor.
- **Kasaba sıralaması:** `lb_kasaba` hologramı (-4.5/103.5/-8.5), `%townyadvanced_top_town_residents_N%` ile.
- **/menu:** 36 slota çıkarıldı. Eklenen butonlar: Bakiyem, Oy Ver (`/vote`), Kasalar, Skin Seç, Sıralamalar (`/towny top`).

## Doğrulama
- Panel özeti "Çevrimdışı" gösterse de sunucu açıktı. Değişiklikler eklentiler yeniden yüklenerek uygulandı, sonra sunucu yeniden başlatıldı (23:45, açılış 14 sn).
- Konsolda hatasız yüklendi: Towny, TAB, DeluxeMenus (5 menü kayıtlı), ConditionalEvents, WorldGuard (hub bölgeleri).
- Oyun içi test yapılmadı (çevrimiçi oyuncu yoktu): `/hub` ve giriş ışınlaması, menüler, bossbar.
