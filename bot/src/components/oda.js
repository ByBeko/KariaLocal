import {
  ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import { getSetting } from '../core/settings.js';
import { getTempChannel, setTempOwner } from '../systems/tempvoice.js';
import { replyError, replySuccess } from '../utils/embeds.js';
import { e } from '../utils/emojis.js';

const renames = new Map(); // channelId -> [zaman damgaları]

/** @everyone ve üye rolü için bir izni aç/kapat. Yeni durumu (kapalı mı) döner. */
async function toggle(channel, permission) {
  const { guild } = channel;
  const everyone = channel.permissionOverwrites.cache.get(guild.id);
  const closed = Boolean(everyone?.deny.has(permission));
  const targets = [guild.id, getSetting(guild.id, 'member_role')].filter(Boolean);
  for (const id of targets) {
    await channel.permissionOverwrites.edit(id, { [permission]: closed ? null : false });
  }
  return !closed;
}

function textModal(id, title, label, placeholder, maxLength) {
  return new ModalBuilder()
    .setCustomId(`oda:${id}`)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('deger')
          .setLabel(label)
          .setPlaceholder(placeholder)
          .setStyle(TextInputStyle.Short)
          .setMaxLength(maxLength)
          .setRequired(true),
      ),
    );
}

export default {
  prefix: 'oda',
  async execute(interaction, [action]) {
    const room = getTempChannel(interaction.channelId);
    const channel = interaction.channel;
    if (!room || !channel) return replyError(interaction, 'Bu oda artık yok.');

    if (action === 'devral') {
      if (room.owner_id === interaction.user.id) return replyError(interaction, 'Oda zaten senin.');
      if (channel.members.has(room.owner_id)) return replyError(interaction, 'Oda sahibi hâlâ odada.');
      if (!channel.members.has(interaction.user.id)) return replyError(interaction, 'Devralmak için odada olmalısın.');
      await channel.permissionOverwrites.delete(room.owner_id).catch(() => {});
      await channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, Connect: true, Speak: true, Stream: true });
      setTempOwner(channel.id, interaction.user.id);
      return interaction.reply({ content: `${e('tac', '👑')} ${interaction.user} artık bu odanın sahibi.` });
    }

    if (room.owner_id !== interaction.user.id) return replyError(interaction, 'Bu paneli sadece oda sahibi kullanabilir.');

    switch (action) {
      case 'kilit': {
        const locked = await toggle(channel, 'Connect');
        return replySuccess(interaction, locked ? `${e('kilit', '🔒')} Oda kilitlendi, kimse giremez.` : `${e('kilit_acik', '🔓')} Odanın kilidi açıldı.`);
      }
      case 'gizle': {
        const hidden = await toggle(channel, 'ViewChannel');
        return replySuccess(interaction, hidden ? `${e('televizyon', '👁️')} Oda gizlendi.` : `${e('televizyon', '👁️')} Oda tekrar görünür.`);
      }
      case 'limit':
        return interaction.showModal(textModal('limitkaydet', 'Kişi limiti', 'Limit (0 = sınırsız, en fazla 99)', '5', 2));
      case 'isim':
        return interaction.showModal(textModal('isimkaydet', 'Oda ismi', 'Yeni isim', 'Kafa dengi muhabbet', 100));
      case 'at':
        return interaction.reply({
          content: 'Odadan atmak istediğin kişileri seç (tekrar giremezler):',
          components: [
            new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder().setCustomId('oda:atsec').setPlaceholder('Kişi seç').setMinValues(1).setMaxValues(5),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      case 'atsec': {
        const kicked = [];
        for (const userId of interaction.values) {
          if (userId === interaction.user.id) continue;
          await channel.permissionOverwrites.edit(userId, { Connect: false });
          const member = channel.members.get(userId);
          if (member) await member.voice.disconnect('Oda sahibi attı').catch(() => {});
          kicked.push(`<@${userId}>`);
        }
        return interaction.update({ content: kicked.length ? `${e('carpi', '👢')} Atıldı: ${kicked.join(', ')}` : 'Kimse atılmadı.', components: [] });
      }
      case 'limitkaydet': {
        const limit = Number(interaction.fields.getTextInputValue('deger'));
        if (!Number.isInteger(limit) || limit < 0 || limit > 99) return replyError(interaction, '0 ile 99 arası bir sayı gir.');
        await channel.setUserLimit(limit);
        return replySuccess(interaction, limit ? `${e('arkadaslar', '👥')} Limit **${limit}** kişi yapıldı.` : `${e('arkadaslar', '👥')} Limit kaldırıldı.`);
      }
      case 'isimkaydet': {
        const name = interaction.fields.getTextInputValue('deger').trim();
        // Discord kanal başına 10 dakikada 2 isim değişikliğine izin verir
        const now = Date.now();
        const recent = (renames.get(channel.id) ?? []).filter((t) => now - t < 600_000);
        if (recent.length >= 2) {
          const wait = Math.ceil((600_000 - (now - recent[0])) / 60_000);
          return replyError(interaction, `Discord isim değişikliğini 10 dakikada 2 kez ile sınırlıyor. ~${wait} dakika sonra tekrar dene.`);
        }
        renames.set(channel.id, [...recent, now]);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await channel.setName(name);
        return replySuccess(interaction, `${e('kalem', '✏️')} Oda adı **${name}** yapıldı.`);
      }
    }
  },
};
