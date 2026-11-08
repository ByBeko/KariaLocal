// Sunucu denetimi: izinler, roller, kanallar, sunucu ayarları ve Karia ayarlarındaki sorunları bulur.

import { PermissionFlagsBits as P, GuildVerificationLevel, GuildExplicitContentFilter, GuildDefaultMessageNotifications, GuildMFALevel } from 'discord.js';
import { getSetting, SETTINGS } from '../core/settings.js';
import config from '../config.js';
import { e } from '../utils/emojis.js';

export const SEVERITY = {
  critical: { get emoji() { return e('nokta_kirmizi', '🔴'); }, label: 'Kritik', penalty: 20 },
  warn: { get emoji() { return e('nokta_sari', '🟡'); }, label: 'Uyarı', penalty: 7 },
  info: { get emoji() { return e('bilgi', '🔵'); }, label: 'Bilgi', penalty: 0 },
};

const DANGEROUS = {
  Administrator: 'Yönetici',
  ManageGuild: 'Sunucuyu Yönet',
  ManageRoles: 'Rolleri Yönet',
  ManageChannels: 'Kanalları Yönet',
  ManageWebhooks: 'Webhook Yönet',
  BanMembers: 'Üyeleri Yasakla',
  KickMembers: 'Üyeleri At',
  ModerateMembers: 'Zaman Aşımı',
  ManageMessages: 'Mesajları Yönet',
  MentionEveryone: '@everyone Etiketle',
  ManageGuildExpressions: 'İfadeleri Yönet',
};

const dangerousOf = (permissions) => Object.keys(DANGEROUS).filter((k) => permissions.has(P[k])).map((k) => DANGEROUS[k]);
const isSeparator = (role) => /-{3,}|─{3,}|・-/.test(role.name);
const INFO_CHANNEL_RE = /kural|duyuru|ba[gğ]lant|roller|sss|takviye/i;

export function runAudit(guild) {
  const findings = [];
  const add = (severity, title, detail, fix) => findings.push({ severity, title, detail, fix });
  const me = guild.members.me;
  const everyone = guild.roles.everyone;
  const memberRole = guild.roles.cache.get(getSetting(guild.id, 'member_role'));

  // ── Herkese açık roller ──
  for (const role of [everyone, memberRole].filter(Boolean)) {
    const bad = dangerousOf(role.permissions);
    if (bad.length) add('critical', `${role.name} rolünde tehlikeli izinler var`, `Herkeste olan bu rolde: **${bad.join(', ')}**. Bunları hemen kaldır.`);
  }

  // ── Yönetici izni olan roller ──
  const adminRoles = guild.roles.cache.filter((r) => !r.managed && r.id !== everyone.id && r.permissions.has(P.Administrator));
  for (const role of adminRoles.values()) {
    if (role.members.size > 3) add('warn', `${role.name} rolünde ${role.members.size} kişi Yönetici`, 'Yönetici izni çok fazla kişide. Hesabı çalınan biri sunucuyu silebilir; sadece güvendiğin 1-3 kişide olsun.');
  }
  if (adminRoles.size) {
    add('info', 'Yönetici izni olan roller', adminRoles.map((r) => `${r} (${r.members.size} kişi)`).join(', '));
  }

  // ── Botlar ──
  const bots = guild.members.cache.filter((m) => m.user.bot && m.id !== me.id);
  const adminBots = bots.filter((b) => b.permissions.has(P.Administrator));
  if (adminBots.size) {
    add('warn', `${adminBots.size} botta Yönetici izni var`, `${adminBots.map((b) => b.user.username).join(', ')} — bir bot ele geçirilirse sunucu tehlikeye girer. Botlara sadece ihtiyaç duydukları izinleri ver.`);
  }
  if (bots.size) {
    add('info', `Sunucuda ${bots.size} başka bot var`, `${bots.map((b) => b.user.username).join(', ')} — hoş geldin, oto rol, otomatik moderasyon veya log özellikleri açıksa Karia ile çakışır (çift mesaj, çift ceza). Aynı işi yapan özellikleri tek botta bırak.`);
  }

  // ── Bot rolü hiyerarşisi ──
  for (const key of ['member_role', 'bot_role', 'jail_role']) {
    const role = guild.roles.cache.get(getSetting(guild.id, key));
    if (role && !role.editable) add('critical', `Karia ${role.name} rolünü veremiyor`, 'Bot rolünü rol listesinde bu rolün üstüne taşı.');
  }
  for (const key of ['staff_role', 'mod_role']) {
    const role = guild.roles.cache.get(getSetting(guild.id, key));
    if (role && role.position >= me.roles.highest.position) {
      add('info', `${role.name} rolü bot rolünden yüksekte`, 'Bot bu roldeki kişilere ceza uygulayamaz (bu bilinçli bir tercih olabilir).');
    }
  }

  // ── Yetkili rollerinin Discord izinleri (slash komutların görünmesi için) ──
  const staffNeeds = { staff_role: ['ModerateMembers', 'ManageMessages'], mod_role: ['ModerateMembers', 'KickMembers', 'BanMembers'] };
  for (const [key, perms] of Object.entries(staffNeeds)) {
    const role = guild.roles.cache.get(getSetting(guild.id, key));
    if (!role) continue;
    const missing = perms.filter((p) => !role.permissions.has(P[p]));
    if (missing.length) {
      add('warn', `${role.name} rolünde bazı izinler eksik`, `Eksik: **${missing.map((p) => DANGEROUS[p]).join(', ')}**. Bu izinler olmadan ilgili \`/\` komutları onlara görünmez (\`${config.prefix}\` ile yine kullanabilirler).`);
    }
  }

  // ── Üye rolü olmayan üyeler ──
  if (memberRole && !getSetting(guild.id, 'verify_enabled')) {
    const missing = membersWithoutRole(guild);
    if (missing.size) add('warn', `${missing.size} üyede ${memberRole.name} rolü yok`, 'Bunlar muhtemelen bot kurulmadan önce gelenler. Aşağıdaki butonla hepsine verebilirsin.', 'uye-rolu');
  }

  // ── Boş roller ──
  const empty = guild.roles.cache.filter((r) => !r.managed && r.id !== everyone.id && !isSeparator(r) && r.members.size === 0);
  if (empty.size) add('info', `${empty.size} rol boş (kimsede yok)`, empty.map((r) => r.name).slice(0, 25).join(', '));

  // ── Bilgi kanallarına herkes yazabiliyor mu ──
  const writable = guild.channels.cache.filter(
    (c) => c.isTextBased() && !c.isThread() && INFO_CHANNEL_RE.test(c.name) &&
      [everyone, memberRole].filter(Boolean).some((r) => c.permissionsFor(r)?.has([P.ViewChannel, P.SendMessages])),
  );
  if (writable.size) add('warn', 'Bilgi kanallarına herkes yazabiliyor', `${writable.map((c) => `${c}`).join(' ')} — bu kanallarda üyelerin Mesaj Gönder iznini kapat.`);

  // ── Sunucu ayarları ──
  if (guild.verificationLevel < GuildVerificationLevel.Medium) {
    add('warn', 'Doğrulama seviyesi düşük', 'Sunucu Ayarları → Güvenlik: en az **Orta** (5 dakikadan eski hesap) önerilir; spam botlarını azaltır.');
  }
  if (guild.explicitContentFilter === GuildExplicitContentFilter.Disabled) {
    add('warn', 'Uygunsuz içerik filtresi kapalı', 'Sunucu Ayarları → Güvenlik → Uygunsuz medya içeriği filtresini **tüm üyeler** için aç.');
  }
  if (guild.defaultMessageNotifications === GuildDefaultMessageNotifications.AllMessages) {
    add('info', 'Varsayılan bildirim: tüm mesajlar', 'Yeni üyelere her mesajda bildirim gidiyor. **Sadece @bahsetmeler** yapmak sunucudan çıkışları azaltır.');
  }
  if (guild.mfaLevel === GuildMFALevel.None) {
    add('info', 'Moderasyon için 2FA zorunlu değil', 'Sunucu Ayarları → Güvenlik → yetkililer için iki adımlı doğrulamayı zorunlu yap; hesap çalınmalarına karşı korur.');
  }

  // ── Karia ayarları ──
  const important = ['log_mod', 'log_message', 'welcome_channel', 'member_role', 'staff_role', 'mod_role', 'jail_role', 'ticket_category'];
  const unset = important.filter((k) => !getSetting(guild.id, k));
  if (unset.length) add('warn', 'Karia ayarlarında eksikler var', unset.map((k) => SETTINGS[k].label).join(', ') + ' — `/ayarla` ile tamamla.');
  if (!config.minecraft.host) add('info', 'Minecraft IP ayarlı değil', '`src/config.js` → `minecraft.host`. Ayarlanınca `/ip` ve oyuncu sayısı çalışır.');
  const emptyLinks = Object.entries(config.links).filter(([, v]) => !v).map(([k]) => k);
  if (emptyLinks.length) add('info', 'Bazı linkler boş', `${emptyLinks.join(', ')} — \`src/config.js\` → \`links\`.`);

  const score = Math.max(0, 100 - findings.reduce((sum, f) => sum + SEVERITY[f.severity].penalty, 0));
  const order = { critical: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { score, findings };
}

/** Üye rolü olmayan (ve jail'de olmayan) insan üyeler */
export function membersWithoutRole(guild) {
  const memberRole = getSetting(guild.id, 'member_role');
  const jailRole = getSetting(guild.id, 'jail_role');
  return guild.members.cache.filter((m) => !m.user.bot && !m.roles.cache.has(memberRole) && !m.roles.cache.has(jailRole));
}
