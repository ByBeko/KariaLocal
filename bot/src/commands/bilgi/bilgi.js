import { SlashCommandBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { staffRows } from '../../components/bilgi.js';
import { e } from '../../utils/emojis.js';
import { kariaEmbed, label } from '../../utils/embeds.js';
import { relativeTime } from '../../utils/time.js';
import { getLevel, LevelName, isStaff } from '../../utils/permissions.js';
import { userStats, formatVoice } from '../../systems/stats.js';
import { getProfile } from '../../systems/levels.js';
import { countActiveWarns, isJailed } from '../../systems/moderation.js';
import { getBalance, currency } from '../../systems/economy.js';

const LISTED_ROLES = 12;

async function userView(interaction) {
  const { guild } = interaction;
  const user = interaction.options.getUser('kullanici') ?? interaction.user;
  const member = guild.members.cache.get(user.id) ?? (await guild.members.fetch(user.id).catch(() => null));

  const embed = kariaEmbed(interaction.client, 'Kullanıcı Bilgileri', { icon: user.displayAvatarURL() })
    .setTitle(`${member?.displayName ?? user.username}${user.bot ? ' (bot)' : ''}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription(`${user} · \`${user.username}\``)
    .addFields({ name: label('kullanici', '🪪', 'Hesap'), value: `Açılış ${relativeTime(user.createdTimestamp)}`, inline: true });
  if (!member) return embed.setFooter({ text: 'Karia Local | Bu kişi sunucuda değil' });

  embed.addFields({
    name: label('ev', '🏠', 'Sunucu'),
    value: `Katılma ${relativeTime(member.joinedTimestamp)}\nYetki **${LevelName[getLevel(member)]}**${member.premiumSince ? `\n${e('roket', '💜')} Takviyeci` : ''}`,
    inline: true,
  });
  if (!user.bot) {
    const level = getProfile(guild.id, user.id);
    const stats = userStats(guild.id, user.id, 0);
    embed.addFields({
      name: label('yildiz', '⭐', 'Karia'),
      value: `Seviye **${level.level}**${level.rank ? ` · #${level.rank}` : ''}\n**${stats.messages}** mesaj\n**${formatVoice(stats.voiceSeconds)}** ses\n**${getBalance(guild.id, user.id).toLocaleString('tr-TR')}** ${currency()}`,
      inline: true,
    });
  }

  const roles = [...member.roles.cache.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position).values()];
  const more = roles.length > LISTED_ROLES ? ` +${roles.length - LISTED_ROLES}` : '';
  embed.addFields({ name: label('rozet', '🎭', `Roller (${roles.length})`), value: `${roles.slice(0, LISTED_ROLES).join(' ')}${more}` || 'yok' });

  if (!user.bot && isStaff(interaction.member)) {
    embed.addFields({ name: label('kalkan', '🛡️', 'Moderasyon'), value: `Aktif uyarı **${countActiveWarns(guild.id, user.id)}** · Jail ${isJailed(guild.id, user.id) ? '**evet**' : 'hayır'}` });
  }
  return embed;
}

async function serverView(guild, client) {
  const owner = await guild.fetchOwner().catch(() => null);
  const bots = guild.members.cache.filter((m) => m.user.bot).size;
  const online = guild.members.cache.filter((m) => !m.user.bot && m.presence && m.presence.status !== 'offline').size;
  const count = (...types) => guild.channels.cache.filter((c) => types.includes(c.type)).size;

  const embed = kariaEmbed(client, 'Sunucu Bilgileri', { icon: guild.iconURL() ?? undefined })
    .setTitle(guild.name)
    .setThumbnail(guild.iconURL({ size: 256 }))
    .setDescription([
      guild.description,
      `${e('tac', '👑')} **Sahip** ${owner ?? 'bilinmiyor'} · ${e('takvim', '📅')} ${relativeTime(guild.createdTimestamp)} kuruldu`,
    ].filter(Boolean).join('\n'))
    .addFields(
      { name: label('arkadaslar', '👥', 'Üyeler'), value: `**${guild.memberCount - bots}** üye\n**${bots}** bot${online ? `\n**${online}** çevrimiçi` : ''}`, inline: true },
      { name: label('mesaj', '💬', 'Kanallar'), value: `**${count(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)}** yazı\n**${count(ChannelType.GuildVoice, ChannelType.GuildStageVoice)}** ses\n**${count(ChannelType.GuildCategory)}** kategori`, inline: true },
      { name: label('roket', '💜', 'Takviye'), value: `Seviye **${guild.premiumTier}**\n**${guild.premiumSubscriptionCount ?? 0}** takviye`, inline: true },
      { name: label('rozet', '🎭', 'Roller'), value: `**${guild.roles.cache.size - 1}** rol\n**${guild.emojis.cache.size}** emoji\n**${guild.stickers.cache.size}** çıkartma`, inline: true },
      { name: label('kalkan', '🛡️', 'Güvenlik'), value: `Doğrulama **${guild.verificationLevel}**/4\n2FA ${guild.mfaLevel ? '**açık**' : 'kapalı'}`, inline: true },
      { name: label('kod', '🆔', 'Kimlik'), value: `\`${guild.id}\``, inline: true },
    );
  if (guild.bannerURL()) embed.setImage(guild.bannerURL({ size: 1024 }));
  return embed;
}

// Butonlar components/bilgi.js'e gider; yanıtları butona basana özel (gizli) gelir
const button = (id, text, key, fallback) =>
  new ButtonBuilder().setCustomId(`bilgi:${id}`).setLabel(text).setEmoji(e(key, fallback)).setStyle(ButtonStyle.Secondary);

function serverButtons() {
  return [
    new ActionRowBuilder().addComponents(
      button('roller', 'Roller', 'rozet', '🎭'),
      button('emoji', 'Emojiler', 'parilti', '😀'),
      button('baglantilar', 'Bağlantılar', 'zincir', '🔗'),
    ),
  ];
}

function userButtons(user) {
  const rows = [
    new ActionRowBuilder().addComponents(
      button(`avatar:${user.id}`, 'Avatar', 'foto', '🖼️'),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Discord Profili').setURL(`https://discord.com/users/${user.id}`).setEmoji(e('kullanici', '👤')),
    ),
  ];
  if (!user.bot) {
    rows.push(
      new ActionRowBuilder().addComponents(
        button(`kart:${user.id}`, 'Seviye Kartı', 'yildiz', '⭐'),
        button('oduller', 'Seviye Ödülleri', 'kupa', '🏆'),
        button(`istatistik:${user.id}`, 'İstatistik', 'istatistik', '📈'),
        button('siralama', 'Sıralama', 'kupa', '📊'),
      ),
    );
  }
  return rows;
}

export default {
  aliases: ['profil', 'kb', 'userinfo'],
  defaultSub: 'kullanici',
  data: new SlashCommandBuilder()
    .setName('bilgi')
    .setDescription('Bir üyenin ya da sunucunun bilgilerini gösterir.')
    .addSubcommand((s) =>
      s.setName('kullanici').setDescription('Üye bilgileri')
        .addUserOption((o) => o.setName('kullanici').setDescription('Kim? (boşsa sen)')),
    )
    .addSubcommand((s) => s.setName('sunucu').setDescription('Sunucu bilgileri')),

  async execute(interaction) {
    const server = interaction.options.getSubcommand() === 'sunucu';
    const embed = server ? await serverView(interaction.guild, interaction.client) : await userView(interaction);
    const components = server ? serverButtons() : userButtons(interaction.options.getUser('kullanici') ?? interaction.user);
    await interaction.reply({ embeds: [embed], components, allowedMentions: { parse: [] } });

    // Yetkiliye, sadece kendisinin göreceği ceza butonları (uyar, sustur, jail, ban...) ayrıca gelir
    const target = interaction.options.getUser('kullanici') ?? interaction.user;
    if (server || target.bot || !isStaff(interaction.member)) return;
    if (interaction.isPrefix) {
      const open = new ButtonBuilder().setCustomId(`bilgi:yetkili:${target.id}`).setLabel('Yetkili İşlemleri').setEmoji(e('kalkan2', '🛡️')).setStyle(ButtonStyle.Secondary);
      return interaction.followUp({ content: `${e('kalkan2', '🛡️')} Yetkili işlemleri sadece sana görünür, butona bas:`, components: [new ActionRowBuilder().addComponents(open)] }).catch(() => {});
    }
    const rows = staffRows(interaction.member, target.id);
    if (rows.length) {
      await interaction
        .followUp({ content: `${e('kalkan2', '🛡️')} **${target.username}** için yetkili işlemleri (sadece sen görürsün):`, components: rows, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  },
};
