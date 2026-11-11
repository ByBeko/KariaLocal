import { SlashCommandBuilder, ChannelType } from 'discord.js';
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
    const embed = interaction.options.getSubcommand() === 'sunucu' ? await serverView(interaction.guild, interaction.client) : await userView(interaction);
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
