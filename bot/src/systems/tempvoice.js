import {
  ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { db } from '../core/database.js';
import { getSetting } from '../core/settings.js';
import { brandEmbed } from '../utils/embeds.js';
import { e } from '../utils/emojis.js';

const insertStmt = db.prepare('INSERT OR REPLACE INTO temp_channels (channel_id, guild_id, owner_id) VALUES (?, ?, ?)');
const getStmt = db.prepare('SELECT * FROM temp_channels WHERE channel_id = ?');
const byOwnerStmt = db.prepare('SELECT * FROM temp_channels WHERE guild_id = ? AND owner_id = ?');
const deleteStmt = db.prepare('DELETE FROM temp_channels WHERE channel_id = ?');
const setOwnerStmt = db.prepare('UPDATE temp_channels SET owner_id = ? WHERE channel_id = ?');
const allStmt = db.prepare('SELECT * FROM temp_channels WHERE guild_id = ?');

export const getTempChannel = (channelId) => getStmt.get(channelId);
export const isTempChannel = (channelId) => Boolean(getStmt.get(channelId));
export const setTempOwner = (channelId, ownerId) => setOwnerStmt.run(ownerId, channelId);

export function controlPanel() {
  const embed = brandEmbed()
    .setTitle(`${e('ayarlar', '🎛️')} Oda Kontrol Paneli`)
    .setDescription(
      'Bu oda senin! Aşağıdaki butonlarla yönetebilirsin.\nHerkes çıkınca oda otomatik silinir.\n\n' +
        `${e('kilit', '🔒')} Kilitle / Aç • ${e('televizyon', '👁️')} Gizle / Göster • ${e('arkadaslar', '👥')} Kişi limiti\n${e('kalem', '✏️')} İsim değiştir • ${e('carpi', '👢')} Birini at • ${e('tac', '👑')} Sahipsiz odayı devral`,
    );
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('oda:kilit').setEmoji(e('kilit', '🔒')).setLabel('Kilitle / Aç').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('oda:gizle').setEmoji(e('televizyon', '👁️')).setLabel('Gizle / Göster').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('oda:limit').setEmoji(e('arkadaslar', '👥')).setLabel('Limit').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('oda:isim').setEmoji(e('kalem', '✏️')).setLabel('İsim').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('oda:at').setEmoji(e('carpi', '👢')).setLabel('At').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('oda:devral').setEmoji(e('tac', '👑')).setLabel('Devral').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row1, row2] };
}

async function createRoom(state) {
  const { member, guild, channel: createChannel } = state;

  // Zaten odası varsa oraya taşı
  const existing = byOwnerStmt.get(guild.id, member.id);
  const existingChannel = existing && guild.channels.cache.get(existing.channel_id);
  if (existingChannel) return member.voice.setChannel(existingChannel).catch(() => {});
  if (existing) deleteStmt.run(existing.channel_id);

  const parentId = getSetting(guild.id, 'tempvoice_category') || createChannel.parentId;
  const parent = parentId ? guild.channels.cache.get(parentId) : null;

  // Kategorinin izinlerini kopyala + oda sahibine izin ver
  const overwrites = parent
    ? parent.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }))
    : [];
  overwrites.push({
    id: member.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream],
  });

  const room = await guild.channels.create({
    name: `🔊 ${member.displayName}`.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: parent?.id,
    permissionOverwrites: overwrites,
    reason: `${member.user.tag} için özel oda`,
  });
  insertStmt.run(room.id, guild.id, member.id);

  try {
    await member.voice.setChannel(room);
  } catch {
    deleteStmt.run(room.id); // kullanıcı bu arada çıktı
    return room.delete().catch(() => {});
  }
  await room.send({ content: `${member}`, ...controlPanel() }).catch(() => {});
}

export async function handleTempVoice(oldState, newState) {
  const { guild } = newState;
  const createId = getSetting(guild.id, 'tempvoice_create');

  if (createId && newState.channelId === createId && oldState.channelId !== createId && !newState.member?.user.bot) {
    await createRoom(newState).catch((e) => console.error('[Özel oda]', e.message));
  }

  // Boşalan özel odayı sil
  if (oldState.channelId && oldState.channelId !== newState.channelId && isTempChannel(oldState.channelId)) {
    const room = oldState.channel;
    // Botlar (ör. müzik) sayılmaz: son insan çıkınca oda silinir
    if (!room || room.members.filter((m) => !m.user.bot).size === 0) {
      deleteStmt.run(oldState.channelId);
      await room?.delete('Özel oda boşaldı').catch(() => {});
    }
  }
}

/** Bot kapalıyken boşalan / silinen odaları temizler. */
export async function cleanupTempChannels(guild) {
  for (const row of allStmt.all(guild.id)) {
    const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
    if (!channel || channel.members.size === 0) {
      deleteStmt.run(row.channel_id);
      await channel?.delete('Özel oda boş').catch(() => {});
    }
  }
}
