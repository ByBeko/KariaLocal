import { SlashCommandBuilder, ChannelType } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { brandEmbed } from '../../utils/embeds.js';
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

  const embed = brandEmbed()
    .setAuthor({ name: `${member?.displayName ?? user.username}${user.bot ? ' (bot)' : ''}`, iconURL: user.displayAvatarURL() })
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .addFields({ name: `${e('kullanici', '🪪')} Hesap`, value: `${user}\nAçılış: ${relativeTime(user.createdTimestamp)}`, inline: true });
  if (!member) return embed.setFooter({ text: 'Bu kişi sunucuda değil' });

  embed.addFields({
    name: `${e('ev', '🏠')} Sunucu`,
    value: `Katılma: ${relativeTime(member.joinedTimestamp)}\nYetki: **${LevelName[getLevel(member)]}**${member.premiumSince ? `\n${e('roket', '💜')} Takviyeci` : ''}`,
    inline: true,
  });
  if (!user.bot) {
    const level = getProfile(guild.id, user.id);
    const stats = userStats(guild.id, user.id, 0);
    embed.addFields({
      name: `${e('yildiz', '⭐')} Karia`,
      value: `Seviye **${level.level}**${level.rank ? ` • #${level.rank}` : ''}\n${stats.messages} mesaj • ${formatVoice(stats.voiceSeconds)} ses\n${getBalance(guild.id, user.id).toLocaleString('tr-TR')} ${currency()}`,
    });
  }

  const roles = [...member.roles.cache.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position).values()];
  const more = roles.length > LISTED_ROLES ? ` +${roles.length - LISTED_ROLES}` : '';
  embed.addFields({ name: `${e('rozet', '🎭')} Roller (${roles.length})`, value: `${roles.slice(0, LISTED_ROLES).join(' ')}${more}` || 'yok' });

  if (!user.bot && isStaff(interaction.member)) {
    embed.addFields({ name: `${e('kalkan', '🛡️')} Moderasyon`, value: `Aktif uyarı: **${countActiveWarns(guild.id, user.id)}** • Jail: ${isJailed(guild.id, user.id) ? '**evet**' : 'hayır'}` });
  }
  return embed;
}

async function serverView(guild) {
  const owner = await guild.fetchOwner().catch(() => null);
  const bots = guild.members.cache.filter((m) => m.user.bot).size;
  const count = (...types) => guild.channels.cache.filter((c) => types.includes(c.type)).size;

  const embed = brandEmbed()
    .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
    .setThumbnail(guild.iconURL({ size: 256 }))
    .addFields(
      { name: `${e('tac', '👑')} Sahip`, value: owner ? `${owner}` : 'bilinmiyor', inline: true },
      { name: `${e('takvim', '📅')} Kuruluş`, value: relativeTime(guild.createdTimestamp), inline: true },
      { name: `${e('arkadaslar', '👥')} Üyeler`, value: `${guild.memberCount - bots} üye • ${bots} bot`, inline: true },
      { name: `${e('mesaj', '💬')} Kanallar`, value: `${count(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)} yazı • ${count(ChannelType.GuildVoice, ChannelType.GuildStageVoice)} ses`, inline: true },
      { name: `${e('roket', '💜')} Takviye`, value: `Seviye ${guild.premiumTier} • ${guild.premiumSubscriptionCount ?? 0} takviye`, inline: true },
      { name: `${e('rozet', '🎭')} Roller ve Emojiler`, value: `${guild.roles.cache.size - 1} rol • ${guild.emojis.cache.size} emoji`, inline: true },
    );
  if (guild.description) embed.setDescription(guild.description);
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
    const embed = interaction.options.getSubcommand() === 'sunucu' ? await serverView(interaction.guild) : await userView(interaction);
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
