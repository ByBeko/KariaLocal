import { db } from './database.js';
import { e } from '../utils/emojis.js';

// /ayarla komutuyla değiştirilebilen ayarlar.
// kind: kanal ayarlarında hangi tür kanal kabul edileceği (text | voice | category)
export const SETTINGS = {
  // ── Kanallar ──
  welcome_channel: { type: 'channel', kind: 'text', label: 'Hoş geldin kanalı' },
  rules_channel: { type: 'channel', kind: 'text', label: 'Kurallar kanalı' },
  roles_channel: { type: 'channel', kind: 'text', label: 'Roller kanalı' },
  boost_channel: { type: 'channel', kind: 'text', label: 'Takviye teşekkür kanalı' },
  suggestion_channel: { type: 'channel', kind: 'text', label: 'Öneri kanalı' },
  media_channel: { type: 'channel', kind: 'text', label: 'Sadece medya kanalı (galeri)' },
  mc_status_channel: { type: 'channel', kind: 'text', label: 'MC sunucu durumu kanalı' },
  jail_channel: { type: 'channel', kind: 'text', label: 'Jail kanalı' },
  ticket_category: { type: 'channel', kind: 'category', label: 'Destek talebi kategorisi' },
  tempvoice_create: { type: 'channel', kind: 'voice', label: 'Özel Oda Oluştur ses kanalı' },
  tempvoice_category: { type: 'channel', kind: 'category', label: 'Özel odaların açılacağı kategori' },
  log_member: { type: 'channel', kind: 'text', label: 'Log: giriş-çıkış (+ hangi davetle)' },
  log_mod: { type: 'channel', kind: 'text', label: 'Log: ceza (uyarı/mute/jail/kick)' },
  log_ad: { type: 'channel', kind: 'text', label: 'Log: reklam/link/küfür koruması' },
  log_message: { type: 'channel', kind: 'text', label: 'Log: mesaj silme/düzenleme' },
  log_nick: { type: 'channel', kind: 'text', label: 'Log: isim / takma ad değişimi' },
  log_ban: { type: 'channel', kind: 'text', label: 'Log: ban / ban kaldırma' },
  log_staff: { type: 'channel', kind: 'text', label: 'Log: mod (yetkili komutları, kanal/rol/sunucu değişiklikleri)' },
  log_invite: { type: 'channel', kind: 'text', label: 'Log: davet oluşturma/silme' },
  log_voice: { type: 'channel', kind: 'text', label: 'Log: ses kanalları' },
  log_role: { type: 'channel', kind: 'text', label: 'Log: rol verme/alma' },
  log_ticket: { type: 'channel', kind: 'text', label: 'Log: destek talebi dökümleri' },
  log_level: { type: 'channel', kind: 'text', label: 'Log: seviye atlama / XP değişimi' },
  level_channel: { type: 'channel', kind: 'text', label: 'Seviye atlama duyuru kanalı (boşsa yazdığı kanal)' },
  report_channel: { type: 'channel', kind: 'text', label: 'Üye raporları kanalı (boşsa ceza logu)' },

  // ── Roller ──
  member_role: { type: 'role', label: 'Üye rolü (Sunucu Üyesi)' },
  bot_role: { type: 'role', label: 'Bot rolü (Botlar)' },
  jail_role: { type: 'role', label: 'Jail rolü' },
  staff_role: { type: 'role', label: 'Yetki: Personel' },
  mod_role: { type: 'role', label: 'Yetki: Moderatör' },
  admin_role: { type: 'role', label: 'Yetki: Yönetici' },

  // ── Aç / Kapat ──
  verify_enabled: { type: 'bool', default: false, label: 'Doğrulama (üye rolü butonla verilir)' },
  anti_spam: { type: 'bool', default: true, label: 'Koruma: spam / flood' },
  anti_invite: { type: 'bool', default: true, label: 'Koruma: başka sunucu davetleri' },
  anti_link: { type: 'bool', default: true, label: 'Koruma: izinsiz linkler' },
  anti_nuke: { type: 'bool', default: true, label: 'Koruma: toplu saldırı (kanal/rol silme, toplu ban)' },
  anti_mention: { type: 'bool', default: true, label: 'Koruma: toplu etiket' },
  anti_profanity: { type: 'bool', default: true, label: 'Koruma: küfür' },
  anti_raid: { type: 'bool', default: true, label: 'Koruma: raid (toplu giriş)' },
  level_enabled: { type: 'bool', default: true, label: 'Seviye sistemi (mesaj/ses ile XP)' },
  level_announce: { type: 'bool', default: true, label: 'Seviye atlayınca tebrik mesajı' },
  autoresponse_enabled: { type: 'bool', default: true, label: 'Oto cevaplar' },
  economy_enabled: { type: 'bool', default: true, label: 'Ekonomi ve oyunlar' },

  // ── Değerler ──
  min_account_age: { type: 'number', default: 3, label: 'Min. hesap yaşı (gün, 0 = kapalı)' },
  raid_threshold: { type: 'number', default: 5, label: 'Raid eşiği (10 sn içinde giriş sayısı)' },
  warn_limit: { type: 'number', default: 3, label: 'Kaç uyarıda otomatik 1 saat mute (0 = kapalı)' },
  welcome_message: {
    type: 'text',
    default: 'Hoş geldin {user}!|Aramıza hoş geldin {user}!|Selam {user}, hoş geldin!|{user} geldi, hoş geldin!|Hoş geldin {user}, iyi eğlenceler!',
    label: 'Hoş geldin mesajları (| ile ayır, biri rastgele seçilir. {user} {server} {count})',
  },
  link_whitelist: {
    type: 'text',
    default: 'youtube.com,youtu.be,tenor.com,giphy.com,imgur.com,spotify.com,discordapp.com,discordapp.net,github.com,gitlab.com,stackoverflow.com,npmjs.com,pypi.org,minecraft.net,top.gg,disboard.org',
    label: 'İzinli link alan adları (virgülle)',
  },
  bad_words: { type: 'text', default: '', label: 'Yasaklı kelimeler (virgülle)' },
};

const cache = new Map();
const selectStmt = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?');
const upsertStmt = db.prepare(
  'INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?) ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value',
);
const deleteStmt = db.prepare('DELETE FROM settings WHERE guild_id = ? AND key = ?');

function getRaw(guildId, key) {
  const ck = `${guildId}:${key}`;
  if (!cache.has(ck)) cache.set(ck, selectStmt.get(guildId, key)?.value ?? null);
  return cache.get(ck);
}

/** Ayarı tipine göre döndürür (bool/number dönüştürülür). Tanımsız anahtarlar ham string döner. */
export function getSetting(guildId, key) {
  const raw = getRaw(guildId, key);
  const def = SETTINGS[key];
  if (raw === null) return def?.default ?? null;
  if (def?.type === 'bool') return raw === 'true';
  if (def?.type === 'number') return Number(raw);
  return raw;
}

/** value null/undefined ise ayar sıfırlanır (varsayılana döner). */
export function setSetting(guildId, key, value) {
  const ck = `${guildId}:${key}`;
  if (value === null || value === undefined) {
    deleteStmt.run(guildId, key);
    cache.set(ck, null);
  } else {
    upsertStmt.run(guildId, key, String(value));
    cache.set(ck, String(value));
  }
}

export function settingsOfType(type) {
  return Object.entries(SETTINGS).filter(([, s]) => s.type === type);
}

export function formatSetting(guildId, key) {
  const def = SETTINGS[key];
  const value = getSetting(guildId, key);
  if (value === null || value === '') return '`ayarlanmadı`';
  if (def.type === 'channel') return `<#${value}>`;
  if (def.type === 'role') return `<@&${value}>`;
  if (def.type === 'bool') return value ? `${e('onayli', '✅')} Açık` : `${e('carpi', '❌')} Kapalı`;
  if (def.type === 'number') return `\`${value}\``;
  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}
