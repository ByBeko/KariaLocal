// Oyundan gelen destek talebi (/destek), öneri (/oneri) ve rapor (/rapor). KariaEkonomi eklentisi → karia.live /api/mc → bu uçlar.
// Talepler Discord'daki normal talep sistemine (tickets tablosu, "Minecraft Sorunu" türü) açılır; yetkililerin talep kanalına
// yazdığı yanıtlar mc_ticket_replies'e düşer ve eklenti /mc/ticket-replies ile çekip oyuncuya oyunda gösterir.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { db } from '../core/database.js';
import { getSetting, setSetting } from '../core/settings.js';
import { brandEmbed } from '../utils/embeds.js';
import { isStaff, staffRoleIds } from '../utils/permissions.js';
import { UserError } from '../utils/errors.js';
import { sendLog } from '../utils/logger.js';
import { ruleText, fit } from '../utils/style.js';
import { e } from '../utils/emojis.js';
import { addReport } from './reports.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS mc_tickets (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS mc_tickets_uuid ON mc_tickets (guild_id, uuid);
  CREATE TABLE IF NOT EXISTS mc_ticket_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    uuid TEXT NOT NULL,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL,
    delivered_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS mc_ticket_replies_uuid ON mc_ticket_replies (guild_id, uuid, delivered_at);
`);

const q = {
  link: db.prepare('SELECT user_id FROM mc_links WHERE guild_id = ? AND uuid = ?'),
  openByUuid: db.prepare(`SELECT t.* FROM mc_tickets m JOIN tickets t ON t.channel_id = m.channel_id
    WHERE m.guild_id = ? AND m.uuid = ? AND t.closed_at IS NULL ORDER BY t.created_at DESC LIMIT 1`),
  byChannel: db.prepare('SELECT * FROM mc_tickets WHERE channel_id = ?'),
  addMc: db.prepare('INSERT INTO mc_tickets (channel_id, guild_id, uuid, name, created_at) VALUES (?, ?, ?, ?, ?)'),
  addTicket: db.prepare('INSERT INTO tickets (channel_id, guild_id, user_id, number, category, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  closeTicket: db.prepare('UPDATE tickets SET closed_at = ? WHERE channel_id = ?'),
  addReply: db.prepare('INSERT INTO mc_ticket_replies (guild_id, uuid, author, text, at) VALUES (?, ?, ?, ?, ?)'),
  pending: db.prepare('SELECT * FROM mc_ticket_replies WHERE guild_id = ? AND uuid = ? AND delivered_at IS NULL ORDER BY id LIMIT 20'),
  deliver: db.prepare('UPDATE mc_ticket_replies SET delivered_at = ? WHERE id = ?'),
  purge: db.prepare('DELETE FROM mc_ticket_replies WHERE at < ?'),
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME_RE = /^\.?[A-Za-z0-9_]{1,16}$/;
const VIEW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];
const NEW_TICKETS_PER_HOUR = 30;

/** Oyuncu metni: kontrol karakterleri ve Minecraft renk kodları gider, tek satır olur. */
const clean = (v, max) => String(v ?? '').replace(/[\p{Cc}§]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function player(body) {
  const uuid = String(body.uuid ?? '').toLowerCase();
  const name = String(body.name ?? '');
  if (!UUID_RE.test(uuid) || !NAME_RE.test(name)) throw new UserError('Geçersiz oyuncu.');
  return { uuid, name };
}

/** "dünya x, y, z" ya da boş */
function where(body) {
  const n = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
  const [x, y, z] = [n(body.x), n(body.y), n(body.z)];
  const world = clean(body.world, 40);
  return world && x !== null && y !== null && z !== null ? `${world} ${x}, ${y}, ${z}` : '';
}

const last = new Map();
/** Bekleme süresindeyse kalan saniye, değilse 0 (ve süreyi başlatır). */
function cooldown(kind, uuid, ms) {
  const key = `${kind}:${uuid}`;
  const now = Date.now();
  const at = last.get(key) ?? 0;
  if (now - at < ms) return Math.ceil((ms - (now - at)) / 1000);
  if (last.size > 5000) last.clear();
  last.set(key, now);
  return 0;
}

const newTickets = [];
function ticketLimited() {
  const now = Date.now();
  while (newTickets.length && now - newTickets[0] > 3_600_000) newTickets.shift();
  if (newTickets.length >= NEW_TICKETS_PER_HOUR) return true;
  newTickets.push(now);
  return false;
}

async function linkedMember(guild, uuid) {
  const row = q.link.get(guild.id, uuid);
  if (!row) return null;
  return guild.members.cache.get(row.user_id) ?? (await guild.members.fetch(row.user_id).catch(() => null));
}

// ── /destek ──────────────────────────────────────────────────────────────

export async function mcTicket(guild, body) {
  const { uuid, name } = player(body);
  const text = clean(body.text, 1500);
  if (text.length < 3) throw new UserError('Mesajın çok kısa.');
  const wait = cooldown('destek', uuid, 20_000);
  if (wait) return { __status: 429, wait };

  const member = await linkedMember(guild, uuid);
  const place = where(body);
  const message = brandEmbed()
    .setAuthor({ name: `${name} (oyunda)` })
    .setDescription(text)
    .setFooter({ text: place ? `Minecraft • ${place}` : 'Minecraft' })
    .setTimestamp();

  const open = q.openByUuid.get(guild.id, uuid);
  const openChannel = open && guild.channels.cache.get(open.channel_id);
  if (openChannel) {
    await openChannel.send({ embeds: [message], allowedMentions: { parse: [] } });
    return { created: false, number: Number(open.number) };
  }
  if (open) q.closeTicket.run(Date.now(), open.channel_id); // kanal elle silinmiş
  if (ticketLimited()) return { __status: 429, wait: 600 };

  const number = (Number(getSetting(guild.id, 'ticket_counter')) || 0) + 1;
  setSetting(guild.id, 'ticket_counter', number);
  const parentId = getSetting(guild.id, 'ticket_category');
  const channel = await guild.channels.create({
    name: `talep-${String(number).padStart(4, '0')}-mc-${name.replace(/^\./, '')}`.toLowerCase().slice(0, 100),
    type: ChannelType.GuildText,
    parent: parentId && guild.channels.cache.has(parentId) ? parentId : null,
    topic: `Minecraft • ${name} (${uuid})`,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...(member ? [{ id: member.id, allow: VIEW }] : []),
      { id: guild.client.user.id, allow: [...VIEW, PermissionFlagsBits.ManageChannels] },
      ...staffRoleIds(guild.id).map((id) => ({ id, allow: VIEW })),
    ],
  });
  q.addTicket.run(channel.id, guild.id, member?.id ?? guild.client.user.id, number, 'minecraft', Date.now());
  q.addMc.run(channel.id, guild.id, uuid, name, Date.now());

  const info = brandEmbed()
    .setTitle(`${e('kazma', '⛏️')} Minecraft Sorunu • Talep #${number}`)
    .setDescription([
      `**${name}** oyun içinden destek istedi.${member ? ` Discord hesabı: ${member}` : ' Discord hesabı bağlı değil.'}`,
      '',
      'Bu kanala yazılan her mesaj oyuncuya **oyunda** iletilir; çevrimdışıysa girince görür.',
      'Oyuncu `/destek <mesaj>` ile buraya cevap yazar.',
    ].join('\n'))
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:ustlen').setLabel('Üstlen').setEmoji(e('kullanici', '🙋')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:kapat').setLabel('Kapat').setEmoji(e('kilit', '🔒')).setStyle(ButtonStyle.Danger),
  );
  const pings = staffRoleIds(guild.id).map((id) => `<@&${id}>`).join(' ');
  await channel.send({
    content: `${member ? `${member} ` : ''}${pings}`.trim() || undefined,
    embeds: [info, message],
    components: [row],
    allowedMentions: { users: member ? [member.id] : [], roles: staffRoleIds(guild.id) },
  });
  return { created: true, number };
}

// ── /oneri ───────────────────────────────────────────────────────────────

export async function mcSuggestion(guild, body) {
  const { uuid, name } = player(body);
  const text = clean(body.text, 1500);
  if (text.length < 10) throw new UserError('Önerin en az 10 karakter olmalı.');
  const channel = guild.channels.cache.get(getSetting(guild.id, 'suggestion_channel'));
  if (!channel?.isTextBased()) throw new UserError('Öneri kanalı henüz ayarlanmamış.');
  const wait = cooldown('oneri', uuid, 5 * 60_000);
  if (wait) return { __status: 429, wait };

  const member = await linkedMember(guild, uuid);
  const shown = member?.displayName ?? name;
  // Yönetim panelindeki öneri listesi yazarı "... önerdi" olan gömüleri okur
  const embed = brandEmbed()
    .setAuthor({ name: `${shown} önerdi`, iconURL: member?.user.displayAvatarURL() })
    .setDescription(text)
    .setFooter({ text: `Minecraft'tan • ${name} • Tepkilerle oy ver` })
    .setTimestamp();
  const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  await message.react(e('begeni', '👍')).catch(() => message.react('👍')).catch(() => {});
  await message.react(e('begenmeme', '👎')).catch(() => message.react('👎')).catch(() => {});
  await message.startThread({ name: `Öneri • ${shown}`.slice(0, 100) }).catch(() => {});
  return { ok: true };
}

// ── /rapor ───────────────────────────────────────────────────────────────

export async function mcReport(guild, body) {
  const { uuid, name } = player(body);
  const target = String(body.target ?? '');
  if (!NAME_RE.test(target)) throw new UserError('Geçersiz oyuncu adı.');
  if (target.toLowerCase() === name.toLowerCase()) throw new UserError('Kendini raporlayamazsın.');
  const reason = clean(body.reason, 500);
  if (reason.length < 5) throw new UserError('Sebep en az 5 karakter olmalı.');
  const key = getSetting(guild.id, 'report_channel') ? 'report_channel' : 'log_mod';
  if (!guild.channels.cache.has(getSetting(guild.id, key))) throw new UserError('Rapor kanalı ayarlı değil. Yetkililere sohbetten haber ver.');
  const wait = cooldown('rapor', uuid, 5 * 60_000);
  if (wait) return { __status: 429, wait };

  const member = await linkedMember(guild, uuid);
  const place = where(body);
  const details = [
    `**Raporlanan:** \`${target}\` (Minecraft)`,
    `**Bildiren:** \`${name}\`${member ? ` • ${member}` : ''}`,
    '**Kaynak:** Minecraft sunucusu',
  ];
  if (place) details.push(`**Bildirenin konumu:** ${place}`);
  const report = ruleText({
    icon: e('bayrak', '🚩'),
    title: 'Oyuncu Raporu (Minecraft)',
    sections: [
      { icon: e('kullanici', '👤'), title: 'Bilgiler', body: details.join('\n') },
      { icon: e('unlem', '⚠️'), title: 'Sebep', body: reason },
    ],
  });
  const staffRole = getSetting(guild.id, 'staff_role');
  await sendLog(guild, key, {
    content: fit(`${staffRole ? `<@&${staffRole}>\n` : ''}${report}`),
    allowedMentions: { roles: staffRole ? [staffRole] : [] },
  });
  addReport(guild.id, { reporterId: member?.id ?? `mc:${name}`, targetId: `mc:${target}`, reason, link: null, channelId: getSetting(guild.id, key) });
  return { ok: true };
}

// ── yanıtların oyuna aktarımı ────────────────────────────────────────────

/** Discord biçimini oyunda okunur düz metne çevirir. */
function plainText(guild, text) {
  return String(text ?? '')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<@!?(\d+)>/g, (_, id) => `@${guild.members.cache.get(id)?.displayName ?? 'üye'}`)
    .replace(/<@&(\d+)>/g, (_, id) => `@${guild.roles.cache.get(id)?.name ?? 'rol'}`)
    .replace(/<#(\d+)>/g, (_, id) => `#${guild.channels.cache.get(id)?.name ?? 'kanal'}`)
    .replace(/[*_~`|]/g, '')
    .replace(/[\p{Cc}§]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

function relay(message) {
  if (!message.inGuild()) return;
  const mc = q.byChannel.get(message.channelId);
  if (!mc) return;
  let author;
  let text;
  if (message.author.id === message.client.user.id) {
    if (message.content.startsWith('Bu kanal 5 saniye içinde silinecek')) {
      author = 'Karia';
      text = 'Destek talebin kapatıldı. Yeni bir sorun için /destek <mesaj>';
    } else {
      const m = message.content.match(/^\*\*(.{1,64}?):\*\* ([\s\S]+)$/); // yönetim panelinden yanıt
      if (!m) return;
      [, author, text] = m;
    }
  } else {
    if (message.author.bot || !isStaff(message.member)) return; // oyuncunun kendi mesajı geri gönderilmez
    author = message.member?.displayName ?? message.author.username;
    text = message.content + (message.attachments.size ? ` [${message.attachments.size} dosya Discord'da]` : '');
  }
  const out = plainText(message.guild, text);
  if (!out) return;
  q.addReply.run(message.guildId, mc.uuid, clean(author, 32) || 'Yetkili', out, Date.now());
}

/** Eklenti çevrimiçi oyuncular için bekleyen yanıtları çeker; çekilen yanıt teslim edilmiş sayılır. */
export function mcTicketReplies(guild, raw) {
  const uuids = String(raw ?? '').toLowerCase().split(',').filter((u) => UUID_RE.test(u)).slice(0, 100);
  const now = Date.now();
  const replies = [];
  for (const uuid of uuids) {
    for (const r of q.pending.all(guild.id, uuid)) {
      q.deliver.run(now, r.id);
      replies.push({ uuid, author: r.author, text: r.text, at: Number(r.at) });
    }
  }
  return { replies };
}

let started = false;
export function startMcSupport(client) {
  if (started) return;
  started = true;
  client.on('messageCreate', (message) => {
    try {
      relay(message);
    } catch (error) {
      console.error('[MC destek]', error.message);
    }
  });
  // Teslim edilmemiş eski yanıtlar 30 gün sonra silinir
  setInterval(() => q.purge.run(Date.now() - 30 * 86_400_000), 6 * 3_600_000).unref?.();
}
