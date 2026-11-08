// Etkinlik içindeki Yönetim Paneli. Yetki burada her istekte yeniden kontrol edilir; tarayıcıdan gelen hiçbir değere güvenilmez.
// Komutlar normal komut yolundan (runCommand) çalışır: yetki kontrolü ve mod-log kaydı aynen geçerlidir.
import { ApplicationCommandOptionType as T, ChannelType } from 'discord.js';
import { SETTINGS, getSetting, setSetting, formatSetting } from '../core/settings.js';
import { PrefixInteraction } from '../core/prefix.js';
import { runCommand } from '../core/runner.js';
import { checkAccess, getLevel, Level } from '../utils/permissions.js';
import { UserError } from '../utils/errors.js';
import { sendLog } from '../utils/logger.js';
import { isStaffCommand } from '../systems/help.js';
import { KIND_CHECK, KIND_NAME } from '../commands/yonetim/ayarla.js';
import config from '../config.js';
import { db } from '../core/database.js';
import { serverStats, formatVoice } from '../systems/stats.js';
import { CASE_TYPES } from '../systems/moderation.js';
import { getQueue } from '../systems/music.js';
import { listReports, openReportCount, resolveReport } from '../systems/reports.js';
import { getOpenTicket, claimTicket, markTicketClosed, finishTicket } from '../components/ticket.js';

export const isPanelAdmin = (member) => getLevel(member) >= Level.ADMIN;

// Panelde çalışamayanlar: blackjack butonla oynanır (Etkinlikte zaten var), emoji-yukle dosya ister
const NOT_IN_PANEL = new Set(['blackjack', 'emoji-yukle']);
const COMMAND_TIMEOUT = 85_000;
const MAX_OUTPUT = 3500;

const DUYURU_OPTIONS = [
  { name: 'baslik', description: 'Başlık', type: T.String, required: true, max_length: 80 },
  { name: 'metin', description: 'Metin (bölümleri boş satırla ayır, başlık için satırı # ile başlat)', type: T.String, required: true, max_length: 1500, multiline: true },
  { name: 'not', description: 'Alt not', type: T.String, max_length: 200 },
  { name: 'etiket', description: 'Etiketlenecek rol', type: T.Role },
];

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildForum];

const optionView = (o) => ({
  name: o.name, description: o.description, type: o.type, required: Boolean(o.required), multiline: Boolean(o.multiline),
  choices: o.choices ?? null, min: o.min_value ?? null, max: o.max_value ?? null, maxLength: o.max_length ?? null, channelTypes: o.channel_types ?? null,
});
const visibleOptions = (options = []) => options.filter((o) => o.type !== T.Attachment);
const needsFile = (options = []) => options.some((o) => o.type === T.Attachment && o.required);

function commandViews(client, member) {
  const out = [];
  for (const command of client.commands.values()) {
    const json = command.data.toJSON();
    if (NOT_IN_PANEL.has(json.name) || checkAccess(member, command)) continue;
    const staff = isStaffCommand(command);
    const base = { name: json.name, description: json.description, category: command.category, staff };
    if (json.name === 'duyuru') {
      out.push({ ...base, subs: null, options: DUYURU_OPTIONS.map(optionView) });
      continue;
    }
    const subs = (json.options ?? []).filter((o) => o.type === T.Subcommand && !needsFile(o.options));
    if ((json.options ?? []).some((o) => o.type === T.Subcommand)) {
      if (subs.length) out.push({ ...base, subs: subs.map((s) => ({ name: s.name, description: s.description, options: visibleOptions(s.options).map(optionView) })), options: [] });
    } else if (!needsFile(json.options)) {
      out.push({ ...base, subs: null, options: visibleOptions(json.options).map(optionView) });
    }
  }
  return out.sort((a, b) => a.category.localeCompare(b.category, 'tr') || a.name.localeCompare(b.name, 'tr'));
}

function overview(client, guild, member) {
  const settings = Object.entries(SETTINGS).map(([key, s]) => ({ key, label: s.label, type: s.type, kind: s.kind ?? null, value: getSetting(guild.id, key) }));
  const channels = [...guild.channels.cache.values()]
    .filter((c) => !c.isThread())
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({ id: c.id, name: c.name, type: c.type }));
  const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, name: r.name, managed: r.managed }));
  const members = [...guild.members.cache.values()].slice(0, 1000).map((m) => ({ id: m.id, name: m.displayName, bot: m.user.bot })).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  return { settings, channels, roles, members, commands: commandViews(client, member) };
}

/** /ayarla ile aynı kurallar. Boş değer ayarı varsayılana döndürür. */
async function changeSetting(guild, member, body) {
  const key = String(body.key ?? '');
  const def = Object.hasOwn(SETTINGS, key) ? SETTINGS[key] : null;
  if (!def) throw new UserError('Böyle bir ayar yok.');
  const raw = body.value;
  const empty = raw === null || raw === undefined || raw === '';
  let value = null;

  if (def.type === 'bool') {
    if (typeof raw !== 'boolean') throw new UserError('Geçersiz değer.');
    value = raw;
  } else if (!empty && def.type === 'channel') {
    const channel = guild.channels.cache.get(String(raw));
    if (!channel) throw new UserError('Kanal bulunamadı.');
    if (!KIND_CHECK[def.kind](channel)) throw new UserError(`Bu ayar için bir ${KIND_NAME[def.kind]} seçmelisin.`);
    value = channel.id;
  } else if (!empty && def.type === 'role') {
    const role = guild.roles.cache.get(String(raw));
    if (!role || role.id === guild.id) throw new UserError('Rol bulunamadı.');
    if (role.managed) throw new UserError('Bot veya entegrasyon rolleri seçilemez.');
    if (['member_role', 'bot_role', 'jail_role'].includes(key) && !role.editable) throw new UserError('Bu rolü veremem çünkü benim rolümden yüksekte.');
    value = role.id;
  } else if (!empty && def.type === 'number') {
    value = Number(raw);
    if (!Number.isInteger(value) || value < 0) throw new UserError('Pozitif bir tam sayı girmelisin.');
  } else if (!empty) {
    value = String(raw);
    if (value.length > 1000) throw new UserError('En fazla 1000 karakter yazabilirsin.');
  }

  setSetting(guild.id, key, value);
  await sendLog(guild, 'log_staff', { content: `Yönetim Paneli • <@${member.id}> ayar değiştirdi: **${def.label}** → ${formatSetting(guild.id, key)}` });
  return { key, value: getSetting(guild.id, key) };
}

async function resolveValues(client, guild, options, input) {
  const values = new Map();
  for (const o of options) {
    if (o.type === T.Attachment) continue;
    const raw = input?.[o.name];
    if (raw === undefined || raw === null || raw === '') {
      if (o.required) throw new UserError(`"${o.description}" alanı zorunlu.`);
      continue;
    }
    const bad = () => new UserError(`"${o.description}" için geçersiz değer.`);
    switch (o.type) {
      case T.String: {
        const text = String(raw);
        if (o.choices && !o.choices.some((c) => c.value === text)) throw bad();
        if ((o.max_length && text.length > o.max_length) || (o.min_length && text.length < o.min_length)) throw bad();
        values.set(o.name, text);
        break;
      }
      case T.Integer:
      case T.Number: {
        const n = Number(raw);
        if (!Number.isFinite(n) || (o.type === T.Integer && !Number.isInteger(n))) throw bad();
        if ((o.min_value !== undefined && n < o.min_value) || (o.max_value !== undefined && n > o.max_value)) throw bad();
        if (o.choices && !o.choices.some((c) => c.value === n)) throw bad();
        values.set(o.name, n);
        break;
      }
      case T.Boolean:
        if (raw !== true && raw !== 'true' && raw !== false && raw !== 'false') throw bad();
        values.set(o.name, raw === true || raw === 'true');
        break;
      case T.User:
      case T.Mentionable: {
        if (!/^\d{17,20}$/.test(String(raw))) throw bad();
        const user = await client.users.fetch(String(raw)).catch(() => null);
        if (!user) throw bad();
        values.set(o.name, { user, member: await guild.members.fetch(user.id).catch(() => null) });
        break;
      }
      case T.Channel: {
        const channel = guild.channels.cache.get(String(raw));
        if (!channel || (o.channel_types?.length && !o.channel_types.includes(channel.type))) throw bad();
        values.set(o.name, channel);
        break;
      }
      case T.Role: {
        const role = guild.roles.cache.get(String(raw));
        if (!role) throw bad();
        values.set(o.name, role);
        break;
      }
      default:
        throw bad();
    }
  }
  return values;
}

/** Discord biçimlerini (emoji, etiket, zaman) okunur düz yazıya çevirir */
export function cleanText(guild, text) {
  const name = (map, id, prefix) => `${prefix}${map.get(id)?.name ?? id}`;
  return String(text ?? '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/<#(\d+)>/g, (_, id) => (guild.channels.cache.has(id) ? name(guild.channels.cache, id, '#') : ''))
    .replace(/<@&(\d+)>/g, (_, id) => name(guild.roles.cache, id, '@'))
    .replace(/<@!?(\d+)>/g, (_, id) => `@${guild.members.cache.get(id)?.displayName ?? id}`)
    .replace(/<\/([^:>]+):\d+>/g, '/$1')
    .replace(/<t:(\d+)(:\w)?>/g, (_, s) => new Date(Number(s) * 1000).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }))
    .replace(/\*\*|`|^#{1,3} |^> ?|^-# /gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Komutun Discord cevabını panelde gösterilecek düz yazıya çevirir */
function plainOutput(guild, payloads) {
  const clean = (text) => cleanText(guild, text);
  const parts = [];
  for (const payload of payloads) {
    if (typeof payload === 'string') { parts.push(clean(payload)); continue; }
    if (payload.content) parts.push(clean(payload.content));
    for (const embed of payload.embeds ?? []) {
      const j = embed.toJSON ? embed.toJSON() : embed;
      parts.push([clean(j.title), clean(j.description), ...(j.fields ?? []).map((f) => `${clean(f.name)}: ${clean(f.value)}`)].filter(Boolean).join('\n'));
    }
  }
  return parts.filter(Boolean).join('\n\n').slice(0, MAX_OUTPUT) || 'Komut çalıştı.';
}

class PanelInteraction extends PrefixInteraction {
  // Prefix sürümü ek cevapları kanala atar; panelde hepsi operatöre gösterilir
  async followUp(payload) { return this.message.reply(PrefixInteraction.clean(payload)); }
}

const describeValues = (values) =>
  [...values].map(([k, v]) => `${k}:${v?.user?.username ?? v?.name ?? v}`).join(' ');

function sink(payloads) {
  const handle = {
    id: '0',
    edit: async (p) => { payloads.push(p); return handle; },
    delete: async () => {},
    createMessageComponentCollector() { throw new UserError('Bu komut panelden kullanılamaz.'); },
  };
  return { reply: async (p) => { payloads.push(p); return handle; }, handle };
}

async function runDuyuru(client, guild, member, channel, values) {
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) throw new UserError('Duyuru için yazı ya da duyuru kanalı seç.');
  const payloads = [];
  const { reply } = sink(payloads);
  const ctx = {
    guild, member, client, user: member.user, deferred: false, replied: false, reply, followUp: reply,
    fields: { getTextInputValue: (k) => values.get(k) ?? '' },
  };
  await client.components.get('duyuru').execute(ctx, ['gonder', channel.id, values.get('etiket')?.id ?? '0']);
  await sendLog(guild, 'log_staff', { content: `Yönetim Paneli • <@${member.id}> ${channel} kanalına duyuru gönderdi: **${values.get('baslik')}**` });
  return payloads;
}

export async function runPanelCommand(client, guild, member, body) {
  const name = String(body.name ?? '');
  const command = client.commands.get(name);
  if (!command || NOT_IN_PANEL.has(name)) throw new UserError('Bu komut panelde yok.');
  const denied = checkAccess(member, command);
  if (denied) throw new UserError(denied.replace(/\*\*/g, ''));

  const channel = guild.channels.cache.get(String(body.channelId ?? ''));
  if (!channel || !channel.isTextBased() || !TEXT_CHANNELS.includes(channel.type)) throw new UserError('Komutun çalışacağı kanalı seç.');

  if (name === 'duyuru') {
    const values = await resolveValues(client, guild, DUYURU_OPTIONS, body.values);
    return { output: plainOutput(guild, await runDuyuru(client, guild, member, channel, values)) };
  }

  const json = command.data.toJSON();
  const subs = (json.options ?? []).filter((o) => o.type === T.Subcommand);
  let options = json.options ?? [];
  let subcommand = null;
  if (subs.length) {
    const sub = subs.find((s) => s.name === body.sub);
    if (!sub) throw new UserError('Alt komut seç.');
    subcommand = sub.name;
    options = sub.options ?? [];
  }
  if (needsFile(options)) throw new UserError('Bu komut dosya istediği için panelden kullanılamaz.');
  const values = await resolveValues(client, guild, options, body.values);

  const payloads = [];
  const { reply } = sink(payloads);
  const message = {
    client, guild, member, channel, channelId: channel.id, author: member.user, attachments: new Map(), createdTimestamp: Date.now(),
    content: `[Yönetim Paneli] /${name}${subcommand ? ` ${subcommand}` : ''} ${describeValues(values)}`.trim(),
    reply,
  };
  const ctx = new PanelInteraction(message, command, { subcommand, values });
  let timer;
  await Promise.race([
    runCommand(ctx, command, `panel /${name}`),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new UserError('Komut zaman aşımına uğradı.')), COMMAND_TIMEOUT); }),
  ]).finally(() => clearTimeout(timer));
  return { output: plainOutput(guild, payloads) };
}

// ───────────────────────── Kontrol paneli verileri ─────────────────────────

const q = {
  openTickets: db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND closed_at IS NULL ORDER BY created_at DESC'),
  recentCases: db.prepare('SELECT * FROM cases WHERE guild_id = ? ORDER BY id DESC LIMIT ?'),
  casesSince: db.prepare('SELECT count(*) n FROM cases WHERE guild_id = ? AND created_at >= ?'),
};
const nameOf = (guild, id) => guild.members.cache.get(id)?.displayName ?? 'ayrılmış üye';
const channelName = (guild, id) => guild.channels.cache.get(id)?.name ?? 'silinmiş kanal';
const jump = (guild, channelId, messageId) => `https://discord.com/channels/${guild.id}/${channelId}${messageId ? `/${messageId}` : ''}`;

function openTickets(guild) {
  const rows = [];
  for (const t of q.openTickets.all(guild.id)) {
    if (guild.channels.cache.has(t.channel_id)) rows.push(t);
    else markTicketClosed(t.channel_id); // kanal elle silinmiş
  }
  return rows;
}

function dashboard(client, guild, rawDays) {
  const days = [1, 7, 30].includes(rawDays) ? rawDays : 7;
  const s = serverStats(guild.id, days);
  const humans = guild.members.cache.filter((m) => !m.user.bot).size;
  const music = getQueue(guild.id);
  return {
    days,
    members: { humans, bots: guild.members.cache.size - humans },
    boosts: guild.premiumSubscriptionCount ?? 0,
    stats: { messages: s.messages, previous: s.previousMessages, voice: formatVoice(s.voiceSeconds), active: s.activeUsers, joins: s.joins, leaves: s.leaves },
    daily: s.daily,
    hours: s.hours,
    topUsers: s.topUsers.map((u) => ({ name: nameOf(guild, u.userId), value: u.value })),
    topVoice: s.topVoiceUsers.map((u) => ({ name: nameOf(guild, u.userId), value: formatVoice(u.value) })),
    topChannels: s.topChannels.slice(0, 5).map((c) => ({ name: channelName(guild, c.channelId), value: c.messages })),
    open: { tickets: openTickets(guild).length, reports: openReportCount(guild.id), cases: Number(q.casesSince.get(guild.id, Date.now() - 86_400_000).n) },
    bot: { ping: Number.isFinite(client.ws.ping) ? Math.round(client.ws.ping) : null, uptime: client.uptime ?? 0, commands: client.commands.size, music: music?.current?.title ?? null },
  };
}

function ticketList(guild) {
  return openTickets(guild).map((t) => ({
    id: t.channel_id, number: t.number,
    category: config.ticketCategories.find((c) => c.value === t.category)?.label ?? t.category,
    user: nameOf(guild, t.user_id), claimedBy: t.claimed_by ? nameOf(guild, t.claimed_by) : null, createdAt: t.created_at, url: jump(guild, t.channel_id),
  }));
}

function requireTicket(guild, channelId) {
  const ticket = getOpenTicket(channelId);
  const channel = guild.channels.cache.get(channelId);
  if (!ticket || ticket.guild_id !== guild.id || !channel) throw new UserError('Bu talep artık açık değil.');
  return { ticket, channel };
}

async function ticketMessages(guild, channelId) {
  const { channel } = requireTicket(guild, channelId);
  const batch = await channel.messages.fetch({ limit: 40 });
  return {
    messages: [...batch.values()].reverse().map((m) => ({
      id: m.id, author: m.member?.displayName ?? m.author.username, bot: m.author.bot, at: m.createdTimestamp,
      text: cleanText(guild, m.content || m.embeds[0]?.description || m.embeds[0]?.title || ''), files: m.attachments.size,
    })),
  };
}

async function ticketAction(guild, member, channelId, action, body) {
  const { ticket, channel } = requireTicket(guild, channelId);
  if (action === 'reply') {
    const text = String(body.text ?? '').trim();
    if (!text || text.length > 1500) throw new UserError('Mesaj 1 ile 1500 karakter arasında olmalı.');
    await channel.send({ content: `**${member.displayName}:** ${text}`, allowedMentions: { parse: [] } });
    return ticketMessages(guild, channelId);
  }
  if (action === 'claim') {
    if (ticket.claimed_by) throw new UserError(`Bu talebi ${nameOf(guild, ticket.claimed_by)} üstlendi.`);
    claimTicket(channelId, member.id);
    await channel.send({ content: `${member.displayName} bu talebi üstlendi.`, allowedMentions: { parse: [] } });
    return { tickets: ticketList(guild) };
  }
  if (action === 'close') {
    await finishTicket(channel, ticket, member.user);
    return { tickets: ticketList(guild) };
  }
  return { __status: 404, error: 'Bulunamadı.' };
}

const reportList = (guild) =>
  listReports(guild.id).map((r) => ({
    id: r.id, target: nameOf(guild, r.target_id), reporter: nameOf(guild, r.reporter_id), reason: r.reason, channel: channelName(guild, r.channel_id),
    link: r.link && r.link.startsWith('https://discord.com/channels/') ? r.link : null, createdAt: r.created_at,
    resolved: r.resolved_at ? { at: r.resolved_at, by: nameOf(guild, r.resolved_by) } : null,
  }));

async function suggestionMessages(guild) {
  const channel = guild.channels.cache.get(getSetting(guild.id, 'suggestion_channel'));
  if (!channel?.isTextBased()) return { channel: null, items: [] };
  const batch = await channel.messages.fetch({ limit: 100 });
  const votes = (m, ...names) => names.reduce((n, name) => n + Math.max(0, (m.reactions.cache.find((r) => r.emoji.name === name)?.count ?? 1) - 1), 0);
  const items = [...batch.values()]
    .filter((m) => m.author.id === guild.client.user.id && m.embeds[0]?.author?.name?.endsWith('önerdi'))
    .map((m) => ({
      id: m.id, author: m.embeds[0].author.name.replace(/ önerdi$/, ''), text: cleanText(guild, m.embeds[0].description ?? ''), at: m.createdTimestamp,
      up: votes(m, '👍', 'Karia_begeni'), down: votes(m, '👎', 'Karia_begenmeme'), url: jump(guild, channel.id, m.id),
    }));
  return { channel: channel.name, items };
}

async function deleteSuggestion(guild, member, id) {
  const channel = guild.channels.cache.get(getSetting(guild.id, 'suggestion_channel'));
  const message = channel?.isTextBased() ? await channel.messages.fetch(String(id)).catch(() => null) : null;
  if (!message || message.author.id !== guild.client.user.id || !message.embeds[0]?.author?.name?.endsWith('önerdi')) throw new UserError('Öneri bulunamadı.');
  await message.delete();
  await sendLog(guild, 'log_staff', { content: `Yönetim Paneli • <@${member.id}> bir öneriyi sildi: ${cleanText(guild, message.embeds[0].description ?? '').slice(0, 300)}` });
  return suggestionMessages(guild);
}

const caseList = (guild) =>
  q.recentCases.all(guild.id, 50).map((c) => ({
    id: Number(c.id), type: CASE_TYPES[c.type]?.label ?? c.type, kind: c.type, user: nameOf(guild, c.user_id), mod: nameOf(guild, c.mod_id), reason: c.reason, at: Number(c.created_at),
  }));

export async function adminRoute(client, guild, member, method, path, body) {
  if (!isPanelAdmin(member)) return { __status: 403, error: 'Bu bölüm sadece yöneticiler içindir.' };
  if (method === 'GET') {
    const dash = path.match(/^\/admin\/dashboard\/(\d+)$/);
    if (dash) return dashboard(client, guild, Number(dash[1]));
    if (path === '/admin/tickets') return { tickets: ticketList(guild) };
    const ticketRead = path.match(/^\/admin\/tickets\/(\d{17,20})$/);
    if (ticketRead) return ticketMessages(guild, ticketRead[1]);
    if (path === '/admin/reports') return { reports: reportList(guild) };
    if (path === '/admin/suggestions') return suggestionMessages(guild);
    if (path === '/admin/cases') return { cases: caseList(guild) };
  }
  if (method === 'POST') {
    const ticket = path.match(/^\/admin\/tickets\/(\d{17,20})\/(reply|claim|close)$/);
    if (ticket) return ticketAction(guild, member, ticket[1], ticket[2], body);
    const report = path.match(/^\/admin\/reports\/(\d+)\/resolve$/);
    if (report) {
      if (!resolveReport(guild.id, Number(report[1]), member.id)) throw new UserError('Rapor bulunamadı ya da zaten çözüldü.');
      return { reports: reportList(guild) };
    }
    const suggestion = path.match(/^\/admin\/suggestions\/(\d{17,20})\/delete$/);
    if (suggestion) return deleteSuggestion(guild, member, suggestion[1]);
  }
  if (method === 'GET' && path === '/admin/overview') return overview(client, guild, member);
  if (method === 'POST' && path === '/admin/setting') return changeSetting(guild, member, body);
  if (method === 'POST' && path === '/admin/run') return runPanelCommand(client, guild, member, body);
  return { __status: 404, error: 'Bulunamadı.' };
}
