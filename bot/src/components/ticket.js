import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, AttachmentBuilder, EmbedBuilder, MessageFlags,
} from 'discord.js';
import { db } from '../core/database.js';
import { getSetting, setSetting } from '../core/settings.js';
import config from '../config.js';
import { brandEmbed, replyError, replySuccess } from '../utils/embeds.js';
import { isStaff, staffRoleIds, getLevel, Level } from '../utils/permissions.js';
import { UserError } from '../utils/errors.js';
import { sendLog } from '../utils/logger.js';
import { relativeTime } from '../utils/time.js';
import { e } from '../utils/emojis.js';
import { ticketAnswer } from '../systems/ai.js';

const insertStmt = db.prepare(
  'INSERT INTO tickets (channel_id, guild_id, user_id, number, category, created_at) VALUES (?, ?, ?, ?, ?, ?)',
);
const getStmt = db.prepare('SELECT * FROM tickets WHERE channel_id = ?');
const openByUserStmt = db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND closed_at IS NULL');
const claimStmt = db.prepare('UPDATE tickets SET claimed_by = ? WHERE channel_id = ?');
const closeStmt = db.prepare('UPDATE tickets SET closed_at = ? WHERE channel_id = ?');

// Yönetici onaylarsa talebi açan üyeye verilecek rozetler
const APPROVAL_ROLES = {
  hata: { id: '1568323512693821650', name: 'Hata Avcısı' },
  sponsor: { id: '1568323512702214299', name: 'Sponsor' },
};
export const approvalRoleName = (category) => APPROVAL_ROLES[category]?.name ?? null;

const VIEW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

async function openTicket(interaction) {
  const { guild, user } = interaction;
  const category = config.ticketCategories.find((c) => c.value === interaction.values[0]);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Kullanıcının hâlâ açık bir talebi var mı?
  for (const row of openByUserStmt.all(guild.id, user.id)) {
    if (guild.channels.cache.has(row.channel_id)) {
      return replyError(interaction, `Zaten açık bir talebin var: <#${row.channel_id}>`);
    }
    closeStmt.run(Date.now(), row.channel_id); // kanal elle silinmiş
  }

  const number = (getSetting(guild.id, 'ticket_counter') ? Number(getSetting(guild.id, 'ticket_counter')) : 0) + 1;
  setSetting(guild.id, 'ticket_counter', number);

  const parentId = getSetting(guild.id, 'ticket_category');
  const channel = await guild.channels.create({
    name: `talep-${String(number).padStart(4, '0')}-${user.username}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: parentId && guild.channels.cache.has(parentId) ? parentId : null,
    topic: `${category.label} • ${user.tag} (${user.id})`,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: user.id, allow: VIEW },
      { id: guild.client.user.id, allow: [...VIEW, PermissionFlagsBits.ManageChannels] },
      ...staffRoleIds(guild.id).map((id) => ({ id, allow: VIEW })),
    ],
  });
  insertStmt.run(channel.id, guild.id, user.id, number, category.value, Date.now());

  // Yetkililer açılışta etiketlenmez: önce Karia Local cevaplar, çözemezse ya da üye isterse yetkilileri çağırır
  const embed = brandEmbed()
    .setTitle(`${e(category.icon, category.emoji)} ${category.label} • Talep #${number}`)
    .setDescription(
      [
        `Merhaba ${user}! Talebin oluşturuldu.`,
        '',
        'Sorununu **detaylıca** yaz, varsa ekran görüntüsü ekle. **Karia Local** hemen yardımcı olmaya çalışacak; çözemezse yetkilileri çağırır.',
        `Doğrudan bir yetkiliyle konuşmak istersen **Yetkili Çağır** butonuna bas.`,
      ].join('\n'),
    )
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:yetkili').setLabel('Yetkili Çağır').setEmoji(e('zil', '🔔')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:ustlen').setLabel('Üstlen').setEmoji(e('kullanici', '🙋')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket:kapat').setLabel('Kapat').setEmoji(e('kilit', '🔒')).setStyle(ButtonStyle.Danger),
  );
  if (APPROVAL_ROLES[category.value]) {
    row.addComponents(new ButtonBuilder().setCustomId('ticket:rolonay').setLabel(`Onayla: ${APPROVAL_ROLES[category.value].name}`).setEmoji(e('onayli', '✅')).setStyle(ButtonStyle.Success));
  }
  await channel.send({
    content: `${user}`,
    embeds: [embed],
    components: [row],
    allowedMentions: { users: [user.id] },
  });

  await replySuccess(interaction, `Talebin açıldı: ${channel}`);
}

async function buildTranscript(channel) {
  const messages = [];
  let before;
  while (messages.length < 2000) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
  }
  return messages
    .reverse()
    .map((m) => {
      const time = new Date(m.createdTimestamp).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
      const embedText = m.embeds.map((e) => `[embed] ${e.title ?? ''} ${e.description ?? ''}`.trim()).join(' ');
      const files = m.attachments.map((a) => a.url).join(' ');
      return `[${time}] ${m.author.tag}: ${[m.content, embedText, files].filter(Boolean).join(' ')}`;
    })
    .join('\n');
}

async function closeTicket(interaction, ticket) {
  await interaction.update({ content: `${e('kumsaati', '🔒')} Talep kapatılıyor...`, components: [] });
  await finishTicket(interaction.channel, ticket, interaction.user);
}

/** Dökümü log kanalına gönderir ve talep kanalını siler (buton ve yönetim paneli ortak kullanır) */
export async function finishTicket(channel, ticket, user, approvedRole = null) {
  const { guild } = channel;
  closeStmt.run(Date.now(), channel.id);
  const transcript = await buildTranscript(channel);
  const file = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: `${channel.name}.txt` });
  const category = config.ticketCategories.find((c) => c.value === ticket.category);

  const embed = new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle(`${e('kilit', '🔒')} Talep #${ticket.number} kapatıldı`)
    .addFields(
      { name: 'Açan', value: `<@${ticket.user_id}>`, inline: true },
      { name: 'Kapatan', value: `${user}`, inline: true },
      { name: 'Üstlenen', value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'yok', inline: true },
      { name: 'Konu', value: category?.label ?? ticket.category, inline: true },
      { name: 'Açılış', value: relativeTime(ticket.created_at), inline: true },
      ...(approvedRole ? [{ name: 'Onay', value: `${approvedRole} rolü verildi`, inline: true }] : []),
    )
    .setTimestamp();
  await sendLog(guild, 'log_ticket', { embeds: [embed], files: [file] });

  await channel.send('Bu kanal 5 saniye içinde silinecek.').catch(() => {});
  setTimeout(() => channel.delete(`Talep kapatıldı: ${user.tag}`).catch(() => {}), 5_000);
}

/** Yönetici onayı: açan üyeye rozeti verir, sonra talebi kapatır (buton ve yönetim paneli ortak kullanır) */
export async function approveTicket(channel, ticket, adminUser) {
  const { guild } = channel;
  const reward = APPROVAL_ROLES[ticket.category];
  if (!reward) throw new UserError('Bu talep türünde rol onayı yok.');
  const member = await guild.members.fetch(ticket.user_id).catch(() => null);
  if (!member) throw new UserError('Talebi açan üye artık sunucuda değil.');
  const role = guild.roles.cache.get(reward.id);
  if (!role?.editable) throw new UserError(`${reward.name} rolü verilemiyor.`);
  await member.roles.add(role, `Talep #${ticket.number} onayı: ${adminUser.tag}`);
  await channel.send({ content: `${e('onayli', '✅')} Talebin onaylandı, <@${member.id}> artık **${reward.name}**!`, allowedMentions: { users: [member.id] } }).catch(() => {});
  await finishTicket(channel, ticket, adminUser, reward.name);
}

const mailInsert = db.prepare('INSERT INTO mail_tickets (channel_id, from_addr, from_name, subject, created_at) VALUES (?, ?, ?, ?, ?)');
const mailGet = db.prepare('SELECT * FROM mail_tickets WHERE channel_id = ?');
const mailOpenStmt = db.prepare(`SELECT t.* FROM mail_tickets m JOIN tickets t ON t.channel_id = m.channel_id
  WHERE t.guild_id = ? AND m.from_addr = ? AND t.closed_at IS NULL ORDER BY t.created_at DESC LIMIT 1`);
export const mailInfo = (channelId) => mailGet.get(channelId) ?? null;

const MAIL_PER_SENDER = 5; // Bir adresten saatte en çok
const MAIL_PER_HOUR = 30; // Toplam yeni talep sınırı
const mailHits = new Map();

function mailLimited(address) {
  const now = Date.now();
  const hit = (key, max) => {
    const fresh = (mailHits.get(key) ?? []).filter((at) => now - at < 3_600_000);
    fresh.push(now);
    mailHits.set(key, fresh);
    return fresh.length > max;
  };
  if (mailHits.size > 2000) mailHits.clear();
  return hit(`from:${address}`, MAIL_PER_SENDER);
}

function mailEmbed(mail) {
  const embed = brandEmbed()
    .setAuthor({ name: (mail.fromName || mail.from).slice(0, 200) })
    .setDescription((mail.text || '(Boş mesaj)').slice(0, 3900))
    .addFields({ name: 'Gönderen', value: mail.from.slice(0, 200), inline: true }, { name: 'Konu', value: mail.subject.slice(0, 200), inline: true })
    .setFooter({ text: 'E-posta' })
    .setTimestamp();
  if (mail.attachments) embed.addFields({ name: 'Ek', value: `${mail.attachments} dosya (Discord'a aktarılmaz)`, inline: true });
  return embed;
}

/** Gelen maili aynı adresin açık talebine ekler, yoksa yeni talep açar. */
export async function receiveSupportMail(guild, raw) {
  const from = String(raw.from ?? '').trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)) throw new UserError('Geçersiz gönderici.');
  const mail = { from, fromName: String(raw.fromName ?? '').trim().slice(0, 100), subject: String(raw.subject ?? '').trim().slice(0, 200) || 'Konu yok', text: String(raw.text ?? '').trim().slice(0, 6000), attachments: Math.max(0, Number(raw.attachments) || 0) };
  if (mailLimited(from)) return { __status: 429, limited: true };

  const open = mailOpenStmt.get(guild.id, from);
  const openChannel = open && guild.channels.cache.get(open.channel_id);
  if (openChannel) {
    await openChannel.send({ embeds: [mailEmbed(mail)], allowedMentions: { parse: [] } });
    return { created: false, number: open.number };
  }
  if (open) closeStmt.run(Date.now(), open.channel_id); // kanal elle silinmiş

  const opened = [...(mailHits.get('all') ?? [])].filter((at) => Date.now() - at < 3_600_000);
  if (opened.length >= MAIL_PER_HOUR) return { __status: 429, limited: true };
  mailHits.set('all', [...opened, Date.now()]);

  const number = (Number(getSetting(guild.id, 'ticket_counter')) || 0) + 1;
  setSetting(guild.id, 'ticket_counter', number);
  const parentId = getSetting(guild.id, 'ticket_category');
  const channel = await guild.channels.create({
    name: `talep-${String(number).padStart(4, '0')}-eposta`,
    type: ChannelType.GuildText,
    parent: parentId && guild.channels.cache.has(parentId) ? parentId : null,
    topic: `E-posta • ${mail.from}`.slice(0, 1000),
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: guild.client.user.id, allow: [...VIEW, PermissionFlagsBits.ManageChannels] },
      ...staffRoleIds(guild.id).map((id) => ({ id, allow: VIEW })),
    ],
  });
  insertStmt.run(channel.id, guild.id, guild.client.user.id, number, 'eposta', Date.now());
  mailInsert.run(channel.id, mail.from, mail.fromName, mail.subject, Date.now());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:ustlen').setLabel('Üstlen').setEmoji(e('kullanici', '🙋')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:kapat').setLabel('Kapat').setEmoji(e('kilit', '🔒')).setStyle(ButtonStyle.Danger),
  );
  const pings = staffRoleIds(guild.id).map((id) => `<@&${id}>`).join(' ');
  await channel.send({ content: `${e('mesaj', '✉️')} **E-posta • Talep #${number}** ${pings}`, embeds: [mailEmbed(mail)], components: [row], allowedMentions: { roles: staffRoleIds(guild.id) } });
  return { created: true, number };
}

// ───────────────────────── Karia Local talep asistanı ─────────────────────────
// Talebi açan üyenin her mesajına yapay zeka cevap verir. Yetkili çağrılınca, bir yetkili yazınca
// ya da talep üstlenilince o talepte susar. Yetkililerin mesajlarına hiç cevap vermez.

const aiStateStmt = db.prepare('SELECT * FROM ticket_ai WHERE channel_id = ?');
const aiStopStmt = db.prepare('INSERT OR REPLACE INTO ticket_ai (channel_id, reason, at) VALUES (?, ?, ?)');
const AI_DEBOUNCE = 3_500; // üye art arda yazarsa son mesajdan sonra tek cevap
const AI_MAX_REPLIES = 12; // bu kadar cevaptan sonra hâlâ sürüyorsa yetkili çağrılır
const AI_HISTORY = 40;
const aiTimers = new Map(); // kanal -> zamanlayıcı

const stopAI = (channelId, reason) => aiStopStmt.run(channelId, reason, Date.now());
const aiStopped = (channelId) => aiStateStmt.get(channelId) ?? null;
/** Panelden yetkili cevabı gibi bot adıyla yazılan yetkili mesajlarında çağrılır; çağrı kaydını ezmez */
export const pauseTicketAI = (channelId) => aiStopped(channelId) || stopAI(channelId, 'yetkili');
/** Karia Local'in talepteki cevapları: düz metin, embed ve buton yok */
const isAiReply = (m) => m.author.id === m.client.user.id && m.content && !m.embeds.length && !m.components.length;

/** Yetkilileri etiketler ve o talepte yapay zekayı susturur. Zaten çağrıldıysa false. */
export async function callStaff(channel, reason) {
  if (aiStopped(channel.id)?.reason === 'cagri') return false;
  stopAI(channel.id, 'cagri');
  const roles = staffRoleIds(channel.guild.id);
  await channel.send({
    content: roles.map((id) => `<@&${id}>`).join(' ') || null,
    embeds: [brandEmbed().setDescription(`${e('zil', '🔔')} **Yetkili çağrıldı.** ${reason}\nBir yetkili en kısa sürede burada olacak.`)],
    allowedMentions: { roles },
  });
  return true;
}

function ticketText(m) {
  const files = m.attachments.size ? `(${m.attachments.size} dosya/görsel ekledi)` : '';
  return [m.cleanContent, files].filter(Boolean).join(' ').trim();
}

/** Kanal geçmişini modelin beklediği sohbete çevirir: üye → user, Karia Local → assistant */
function conversationOf(messages, ticket) {
  const out = [];
  for (const m of messages) {
    const role = m.author.id === ticket.user_id ? 'user' : isAiReply(m) ? 'assistant' : null;
    const content = role === 'user' ? ticketText(m) : m.content;
    if (!role || !content) continue;
    if (!out.length && role === 'assistant') continue; // sohbet üyeyle başlamalı
    if (out.at(-1)?.role === role) out.at(-1).content += `\n${content}`;
    else out.push({ role, content: content.slice(0, 2000) });
  }
  return out;
}

async function answerTicket(channel) {
  aiTimers.delete(channel.id);
  const ticket = getOpenTicket(channel.id);
  if (!ticket || ticket.claimed_by || aiStopped(channel.id)) return;

  const fetched = await channel.messages.fetch({ limit: AI_HISTORY }).catch(() => null);
  if (!fetched?.size) return;
  const messages = [...fetched.values()].reverse();
  // Daha önce bir yetkili yazdıysa (ör. bu sistemden önce açılmış talepler) karışmaz
  if (messages.some((m) => !m.author.bot && m.author.id !== ticket.user_id && isStaff(m.member))) return void stopAI(channel.id, 'yetkili');
  // Üyenin son mesajı; ondan sonra zaten cevap verildiyse tekrar cevaplanmaz
  const last = messages.findLast((m) => m.author.id === ticket.user_id);
  if (!last || messages.slice(messages.indexOf(last)).some(isAiReply)) return;
  if (messages.filter(isAiReply).length >= AI_MAX_REPLIES) {
    await callStaff(channel, 'Karia Local bu talepte bir süredir yardım ediyor ama sorun çözülmedi.');
    return;
  }

  const member = last.member ?? (await channel.guild.members.fetch(ticket.user_id).catch(() => null));
  if (!member) return;
  const category = config.ticketCategories.find((c) => c.value === ticket.category);
  await channel.sendTyping().catch(() => {});
  const typing = setInterval(() => channel.sendTyping().catch(() => {}), 8_000);
  let result;
  try {
    result = await ticketAnswer(channel.guild, member, category, conversationOf(messages, ticket));
  } catch (error) {
    if (!(error instanceof UserError)) console.error('[Talep asistanı]', error);
    await callStaff(channel, 'Karia Local şu an cevap veremiyor.').catch(() => {});
    return;
  } finally {
    clearInterval(typing);
  }
  // Bu arada üye yeni mesaj yazdıysa (yeni zamanlayıcı kuruldu) güncel cevabı o verir; yetkili geldiyse susar
  if (aiTimers.has(channel.id) || aiStopped(channel.id) || getOpenTicket(channel.id)?.claimed_by) return;
  if (result.answer) await last.reply({ content: result.answer, allowedMentions: { parse: [], repliedUser: false } });
  if (result.escalate) await callStaff(channel, 'Karia Local bu konuda bir yetkilinin bakması gerektiğini düşünüyor.');
}

/**
 * Talep kanalındaki mesaj: talep kanalıysa true döner (diğer otomatik cevaplar çalışmasın diye).
 * Yetkili yazınca o talepte asistan susar; talebi açan üyenin mesajına kısa bir beklemeden sonra cevap verilir.
 */
export function handleTicketMessage(message) {
  const ticket = getOpenTicket(message.channelId);
  if (!ticket || ticket.guild_id !== message.guild.id) return false;
  if (message.author.id !== ticket.user_id) {
    if (isStaff(message.member) && !aiStopped(message.channelId)) stopAI(message.channelId, 'yetkili');
    return true;
  }
  if (isStaff(message.member) || ticket.claimed_by || aiStopped(message.channelId)) return true;

  clearTimeout(aiTimers.get(message.channelId));
  aiTimers.set(
    message.channelId,
    setTimeout(() => answerTicket(message.channel).catch((error) => console.error('[Talep asistanı]', error)), AI_DEBOUNCE),
  );
  return true;
}

export const getOpenTicket = (channelId) => {
  const row = getStmt.get(channelId);
  return row && !row.closed_at ? row : null;
};
export const claimTicket = (channelId, userId) => claimStmt.run(userId, channelId);
export const markTicketClosed = (channelId) => closeStmt.run(Date.now(), channelId);

export default {
  prefix: 'ticket',
  async execute(interaction, [action]) {
    if (action === 'ac') return openTicket(interaction);

    const ticket = getStmt.get(interaction.channelId);
    if (!ticket || ticket.closed_at) return replyError(interaction, 'Bu kanal açık bir destek talebi değil.');
    const staff = isStaff(interaction.member);

    switch (action) {
      case 'yetkili':
        if (!staff && ticket.user_id !== interaction.user.id) return replyError(interaction, 'Yetkiliyi sadece talebi açan üye çağırabilir.');
        if (!(await callStaff(interaction.channel, `${interaction.user} bir yetkiliyle konuşmak istiyor.`))) {
          return replyError(interaction, 'Yetkililer zaten çağrıldı, birazdan burada olacaklar.');
        }
        return replySuccess(interaction, 'Yetkililer çağrıldı.');

      case 'ustlen':
        if (!staff) return replyError(interaction, 'Talepleri sadece yetkililer üstlenebilir.');
        if (ticket.claimed_by) return replyError(interaction, `Bu talep zaten <@${ticket.claimed_by}> tarafından üstlenildi.`);
        claimStmt.run(interaction.user.id, interaction.channelId);
        return interaction.reply({ embeds: [brandEmbed().setDescription(`${e('kullanici', '🙋')} Bu talep ${interaction.user} tarafından üstlenildi.`)] });

      case 'kapat':
        if (!staff && ticket.user_id !== interaction.user.id) return replyError(interaction, 'Bu talebi kapatamazsın.');
        return interaction.reply({
          content: 'Talebi kapatmak istediğine emin misin?',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('ticket:onayla').setLabel('Evet, kapat').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId('ticket:vazgec').setLabel('Vazgeç').setStyle(ButtonStyle.Secondary),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });

      case 'onayla':
        if (!staff && ticket.user_id !== interaction.user.id) return replyError(interaction, 'Bu talebi kapatamazsın.');
        return closeTicket(interaction, ticket);

      case 'rolonay':
        if (getLevel(interaction.member) < Level.ADMIN) return replyError(interaction, 'Bu talebi sadece yöneticiler onaylayabilir.');
        return interaction.reply({
          content: `<@${ticket.user_id}> üyesine **${APPROVAL_ROLES[ticket.category].name}** rolü verilsin ve talep kapatılsın mı?`,
          allowedMentions: { parse: [] },
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('ticket:rolver').setLabel('Evet, onayla').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId('ticket:vazgec').setLabel('Vazgeç').setStyle(ButtonStyle.Secondary),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });

      case 'rolver':
        if (getLevel(interaction.member) < Level.ADMIN) return replyError(interaction, 'Bu talebi sadece yöneticiler onaylayabilir.');
        await interaction.update({ content: `${e('kumsaati', '⏳')} Onaylanıyor...`, components: [] });
        return approveTicket(interaction.channel, ticket, interaction.user);

      case 'vazgec':
        return interaction.update({ content: 'Vazgeçildi.', components: [] });
    }
  },
};
