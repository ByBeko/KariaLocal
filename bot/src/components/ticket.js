import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, AttachmentBuilder, EmbedBuilder, MessageFlags,
} from 'discord.js';
import { db } from '../core/database.js';
import { getSetting, setSetting } from '../core/settings.js';
import config from '../config.js';
import { brandEmbed, replyError, replySuccess } from '../utils/embeds.js';
import { isStaff, staffRoleIds } from '../utils/permissions.js';
import { sendLog } from '../utils/logger.js';
import { relativeTime } from '../utils/time.js';
import { e } from '../utils/emojis.js';

const insertStmt = db.prepare(
  'INSERT INTO tickets (channel_id, guild_id, user_id, number, category, created_at) VALUES (?, ?, ?, ?, ?, ?)',
);
const getStmt = db.prepare('SELECT * FROM tickets WHERE channel_id = ?');
const openByUserStmt = db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND closed_at IS NULL');
const claimStmt = db.prepare('UPDATE tickets SET claimed_by = ? WHERE channel_id = ?');
const closeStmt = db.prepare('UPDATE tickets SET closed_at = ? WHERE channel_id = ?');

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

  const embed = brandEmbed()
    .setTitle(`${e(category.icon, category.emoji)} ${category.label} • Talep #${number}`)
    .setDescription(
      `Merhaba ${user}! Talebin oluşturuldu.\n\nSorununu **detaylıca** yaz, varsa ekran görüntüsü ekle. Yetkililer en kısa sürede dönecek.`,
    )
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:ustlen').setLabel('Üstlen').setEmoji(e('kullanici', '🙋')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket:kapat').setLabel('Kapat').setEmoji(e('kilit', '🔒')).setStyle(ButtonStyle.Danger),
  );
  const pings = staffRoleIds(guild.id).map((id) => `<@&${id}>`).join(' ');
  await channel.send({
    content: `${user} ${pings}`,
    embeds: [embed],
    components: [row],
    allowedMentions: { users: [user.id], roles: staffRoleIds(guild.id) },
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
export async function finishTicket(channel, ticket, user) {
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
    )
    .setTimestamp();
  await sendLog(guild, 'log_ticket', { embeds: [embed], files: [file] });

  await channel.send('Bu kanal 5 saniye içinde silinecek.').catch(() => {});
  setTimeout(() => channel.delete(`Talep kapatıldı: ${user.tag}`).catch(() => {}), 5_000);
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

      case 'vazgec':
        return interaction.update({ content: 'Vazgeçildi.', components: [] });
    }
  },
};
