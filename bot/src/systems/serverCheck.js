// Otomatik kanal kontrolü: açılışta, saatte bir ve bir kanal değişince çalışır.
// Sadece aşağıdaki kuralları uygular; rol izinleri gibi sunucu geneli kararları değiştirmez, loga yazar.
import { e } from '../utils/emojis.js';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import guideEntries from '../channelGuide.js';
import { getSetting, setSetting, SETTINGS } from '../core/settings.js';
import { sendLog } from '../utils/logger.js';
import { fit } from '../utils/style.js';
import { findGuideChannel } from './guide.js';
import { isTempChannel } from './tempvoice.js';
import { ticketPanel, rolePanel, getRoleMenu } from './panels.js';
import { db } from '../core/database.js';

const REASON = 'Karia otomatik kanal kontrolü';
const HOUR = 3_600_000;
const DEBOUNCE = 30_000;

// Ayar boşsa ya da kanal silinmişse adına göre yeniden bağlanır
const BINDINGS = { rules_channel: 'kurallar', roles_channel: 'roller', boost_channel: 'takviyeler', media_channel: 'galeri', welcome_channel: 'sohbet', suggestion_channel: 'oy-ver' };
const PRIVATE_KEYS = [...Object.keys(SETTINGS).filter((k) => k.startsWith('log_')), 'jail_channel', 'ticket_category'];

// #roller boşken bir kez doldurulur; sonrası /rol-menu ile yönetilir (silinen rol geri eklenmez)
const DEFAULT_ROLE_MENU = [
  ['Duyuru Bildirimi', 'megafon', 'Duyurularda etiketlen'],
  ['Güncelleme Bildirimi', 'roket', 'Güncellemelerde etiketlen'],
  ['Haber Bildirimi', 'televizyon', 'Haberlerde etiketlen'],
  ['JavaScript', 'kod', 'JavaScript ile ilgileniyorum'],
  ['HTML-CSS-JS', 'kod', 'Web arayüzü ile ilgileniyorum'],
  ['Python', 'kod', 'Python ile ilgileniyorum'],
  ['Java', 'kod', 'Java ile ilgileniyorum'],
  ['Go', 'kod', 'Go ile ilgileniyorum'],
  ['Rust', 'kod', 'Rust ile ilgileniyorum'],
  ['Hosting', 'araclar', 'Hosting ve sunucu işleri'],
  ['DataBase', 'pano', 'Veritabanları ile ilgileniyorum'],
  ['Other', 'soru', 'Diğer alanlar'],
];
const insertRoleMenu = db.prepare('INSERT OR IGNORE INTO role_menu (guild_id, role_id, emoji, description) VALUES (?, ?, ?, ?)');

function seedRoleMenu(guild) {
  if (getSetting(guild.id, 'role_menu_seeded') || getRoleMenu(guild.id).length) return false;
  let added = 0;
  for (const [name, icon, description] of DEFAULT_ROLE_MENU) {
    const role = guild.roles.cache.find((r) => r.name === name);
    if (!role?.editable) continue;
    insertRoleMenu.run(guild.id, role.id, e(icon, '') || null, description);
    added++;
  }
  setSetting(guild.id, 'role_menu_seeded', Date.now());
  return added > 0;
}

/** Botun panelini kanalda arar: yoksa gönderir, metni eskiyse günceller. */
async function refreshPanel(guild, attempt, { guideKey, customId, build, label }) {
  const channel = findGuideChannel(guild, guideKey);
  if (!channel) return;
  const payload = build(guild);
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return;
  const panel = messages.find(
    (m) => m.author.id === guild.members.me.id && m.components.some((row) => row.components.some((c) => c.customId === customId)),
  );
  if (!panel) return attempt(`${channel} kanalına ${label} gönderildi`, () => channel.send(payload));
  if (panel.content !== payload.content) await attempt(`${channel} ${label} güncellendi`, () => panel.edit(payload));
}

export async function checkServer(guild) {
  const fixes = [];
  const warnings = [];
  const attempt = async (label, action) => {
    try {
      await action();
      fixes.push(label);
    } catch (error) {
      warnings.push(`${label}: yapılamadı (${error.message})`);
    }
  };
  const { me } = guild.members;
  const everyone = guild.roles.everyone;
  const memberRole = guild.roles.cache.get(getSetting(guild.id, 'member_role'));
  const jailRole = guild.roles.cache.get(getSetting(guild.id, 'jail_role'));

  if (!me.permissions.has(P.Administrator)) warnings.push('Karia Local rolünde Yönetici izni yok.');
  const blocked = ['member_role', 'bot_role', 'jail_role'].map((k) => guild.roles.cache.get(getSetting(guild.id, k))).filter((r) => r && !r.editable);
  if (blocked.length) warnings.push(`Karia Local rolü şu rollerin altında kaldığı için onları veremiyor: ${blocked.map((r) => r.name).join(', ')}. Rolü listede yukarı taşı.`);

  const untouchable = guild.roles.cache.filter((r) => !r.managed && r.permissions.has(P.Administrator) && !r.editable);
  if (untouchable.size) {
    warnings.push(`Toplu saldırı koruması şu rollerdeki hesapları durduramaz çünkü rol Karia'nın üstünde: ${untouchable.map((r) => r.name).join(', ')}.`);
  }

  for (const [key, guideKey] of Object.entries(BINDINGS)) {
    if (guild.channels.cache.has(getSetting(guild.id, key))) continue;
    const channel = findGuideChannel(guild, guideKey);
    if (channel) await attempt(`${SETTINGS[key].label} ${channel} olarak ayarlandı`, async () => setSetting(guild.id, key, channel.id));
  }

  for (const entry of guideEntries) {
    const channel = findGuideChannel(guild, entry.key);
    if (!channel) continue;
    // Elle yazılmış açıklamalara dokunulmaz; sadece boş olanlar ve eski otomatik açıklamalar yazılır
    const emoji = guild.emojis.cache.find((x) => x.name === `Karia_${entry.icon}`)?.toString() ?? e(entry.icon, '');
    if (emoji && (!channel.topic || channel.topic === `${entry.legacy} ${entry.about}`)) {
      await attempt(`${channel} kanalının açıklaması güncellendi`, () => channel.setTopic(`${emoji} ${entry.about}`, REASON));
    }
    if (!entry.readOnly) continue;
    for (const role of [everyone, memberRole].filter(Boolean)) {
      if (channel.permissionsFor(role)?.has([P.ViewChannel, P.SendMessages])) {
        await attempt(`${channel} kanalında ${role.name} için yazma kapatıldı`, () => channel.permissionOverwrites.edit(role, { SendMessages: false }, { reason: REASON }));
      }
    }
  }

  const privateChannels = PRIVATE_KEYS.map((k) => guild.channels.cache.get(getSetting(guild.id, k))).filter(Boolean);
  for (const channel of privateChannels) {
    for (const role of [everyone, memberRole].filter(Boolean)) {
      if (channel.permissionsFor(role)?.has(P.ViewChannel)) {
        await attempt(`${channel} ${role.name} rolüne gizlendi`, () => channel.permissionOverwrites.edit(role, { ViewChannel: false }, { reason: REASON }));
      }
    }
  }

  if (jailRole) {
    const jailChannel = getSetting(guild.id, 'jail_channel');
    for (const channel of guild.channels.cache.values()) {
      if (channel.isThread() || channel.id === jailChannel || isTempChannel(channel.id)) continue;
      if (channel.permissionsFor(jailRole)?.has(P.ViewChannel)) {
        const label = channel.type === ChannelType.GuildCategory ? `${channel.name} kategorisi` : `${channel}`;
        await attempt(`${label} Jail rolüne gizlendi`, () => channel.permissionOverwrites.edit(jailRole, { ViewChannel: false }, { reason: REASON }));
      }
    }
  }

  if (getSetting(guild.id, 'ticket_category')) {
    await refreshPanel(guild, attempt, { guideKey: 'destek', customId: 'ticket:ac', build: ticketPanel, label: 'destek paneli' });
  }
  if (seedRoleMenu(guild)) fixes.push('Rol menüsü bildirim ve ilgi alanı rolleriyle dolduruldu');
  if (getRoleMenu(guild.id).length) {
    await refreshPanel(guild, attempt, { guideKey: 'roller', customId: 'roller:sec', build: rolePanel, label: 'rol paneli' });
  }
  return { fixes, warnings };
}

const running = new Set();
const timers = new Map();
const lastWarnings = new Map();

export async function runServerCheck(guild) {
  if (running.has(guild.id)) return;
  running.add(guild.id);
  try {
    const { fixes, warnings } = await checkServer(guild);
    // Aynı uyarılar her saat tekrar loga düşmesin
    const warningText = warnings.join('\n');
    const newWarnings = warningText !== (lastWarnings.get(guild.id) ?? '');
    lastWarnings.set(guild.id, warningText);
    if (!fixes.length && !(newWarnings && warnings.length)) return;
    const parts = [];
    if (fixes.length) parts.push(`### ${e('araclar', '🛠️')} Otomatik Düzeltme\n${fixes.map((f) => `> - ${f}`).join('\n')}`);
    if (warnings.length) parts.push(`### ${e('unlem', '⚠️')} Elle Yapılması Gerekenler\n${warnings.map((w) => `> - ${w}`).join('\n')}`);
    await sendLog(guild, 'log_staff', { content: fit(parts.join('\n\n')) });
    console.log(`✔ Kanal kontrolü: ${fixes.length} düzeltme, ${warnings.length} uyarı.`);
  } catch (error) {
    console.error('[Kanal kontrolü]', error.message);
  } finally {
    running.delete(guild.id);
  }
}

/** Kanal değişikliklerinde art arda çalışmasın diye bekletir. */
export function scheduleServerCheck(guild) {
  clearTimeout(timers.get(guild.id));
  timers.set(guild.id, setTimeout(() => runServerCheck(guild), DEBOUNCE));
}

export function startServerCheck(guild) {
  runServerCheck(guild);
  setInterval(() => runServerCheck(guild), HOUR);
}
