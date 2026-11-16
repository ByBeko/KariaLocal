import { SlashCommandBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { staffRows } from '../../components/bilgi.js';
import { e } from '../../utils/emojis.js';
import { kariaEmbed, label, bar } from '../../utils/embeds.js';
import { relativeTime } from '../../utils/time.js';
import { getLevel, LevelName, isStaff } from '../../utils/permissions.js';
import { userStats, formatVoice } from '../../systems/stats.js';
import { getProfile } from '../../systems/levels.js';
import { countActiveWarns, isJailed } from '../../systems/moderation.js';
import { getBalance, currency, coinRank } from '../../systems/economy.js';
import { monthVotes } from '../../systems/monthlyGifts.js';
import { memberTier } from '../../systems/membership.js';

const LISTED_ROLES = 12;
const date = (ms) => `<t:${Math.floor(ms / 1000)}:D>\n${relativeTime(ms)}`;
const num = (n) => Number(n).toLocaleString('tr-TR');
const place = (rank) => (rank ? ` · \`#${rank}\`` : '');

// Discord profil rozetleri (UserFlags adı → emoji, Türkçe ad)
const FLAG_BADGES = [
  ['Staff', '🛠️', 'Discord Çalışanı'],
  ['Partner', '🤝', 'Discord Partneri'],
  ['CertifiedModerator', '🛡️', 'Sertifikalı Moderatör'],
  ['Hypesquad', '🎉', 'HypeSquad Etkinlikleri'],
  ['HypeSquadOnlineHouse1', '🟣', 'HypeSquad Bravery'],
  ['HypeSquadOnlineHouse2', '🔴', 'HypeSquad Brilliance'],
  ['HypeSquadOnlineHouse3', '🟢', 'HypeSquad Balance'],
  ['BugHunterLevel1', '🐛', 'Hata Avcısı'],
  ['BugHunterLevel2', '🐞', 'Altın Hata Avcısı'],
  ['PremiumEarlySupporter', '💎', 'Erken Destekçi'],
  ['VerifiedDeveloper', '🧑‍💻', 'Doğrulanmış Bot Geliştiricisi'],
  ['ActiveDeveloper', '💻', 'Aktif Geliştirici'],
];

// "Önemli yetkiler" listesinde gösterilenler; Yönetici varsa tek başına yazılır
const KEY_PERMS = [
  ['ManageGuild', 'Sunucuyu Yönet'],
  ['ManageRoles', 'Rolleri Yönet'],
  ['ManageChannels', 'Kanalları Yönet'],
  ['BanMembers', 'Yasakla'],
  ['KickMembers', 'At'],
  ['ModerateMembers', 'Zaman Aşımı'],
  ['ManageMessages', 'Mesajları Yönet'],
  ['MentionEveryone', '@everyone'],
];

function badges(guild, user, member) {
  const list = [];
  if (guild.ownerId === user.id) list.push(`${e('tac', '👑')} Sunucu Sahibi`);
  const flags = user.flags?.toArray() ?? [];
  for (const [flag, icon, name] of FLAG_BADGES) if (flags.includes(flag)) list.push(`${icon} ${name}`);
  // Nitro API'den okunamaz: hareketli avatar, profil banner'ı veya takviye Nitro gerektirir
  if (!user.bot && (user.avatar?.startsWith('a_') || user.banner || member?.premiumSince)) list.push(`${e('elmas', '💎')} Nitro`);
  if (member?.premiumSince) list.push(`${e('roket', '💜')} Sunucu Takviyecisi`);
  const tier = member && memberTier(guild, member);
  if (tier) list.push(`${e('yildiz', '⭐')} Karia ${tier.name}${tier.until ? ` (${relativeTime(tier.until)} bitiyor)` : ''}`);
  if (user.bot) list.push(`${e('bot', '🤖')} Bot`);
  return list;
}

async function userView(interaction) {
  const { guild } = interaction;
  const picked = interaction.options.getUser('kullanici') ?? interaction.user;
  // Banner ve rozetler için kullanıcı tam haliyle çekilir
  const user = await interaction.client.users.fetch(picked.id, { force: true }).catch(() => picked);
  const member = guild.members.cache.get(user.id) ?? (await guild.members.fetch(user.id).catch(() => null));

  const embed = kariaEmbed(interaction.client, user.username, { icon: user.displayAvatarURL() })
    .setTitle(member?.displayName ?? user.globalName ?? user.username)
    .setThumbnail(user.displayAvatarURL({ size: 256 }));
  if (user.banner) embed.setImage(user.bannerURL({ size: 1024 }));

  const badgeList = badges(guild, user, member);
  if (badgeList.length) embed.setDescription(`**Rozetler · ${badgeList.length}**\n${badgeList.join('\n')}`);

  embed.addFields(
    { name: label('kullanici', '🪪', 'Kimlik'), value: `\`${user.id}\`\n${user}`, inline: true },
    { name: label('takvim', '📅', 'Hesap Oluşturma'), value: date(user.createdTimestamp), inline: true },
  );
  if (!member) return embed.addFields({ name: '​', value: '*Bu kişi sunucuda değil.*', inline: true });
  embed.addFields({ name: label('arkadaslar', '👥', 'Sunucuya Katılma'), value: date(member.joinedTimestamp), inline: true });

  // Sıralama bilgileri
  if (!user.bot) {
    const level = getProfile(guild.id, user.id);
    const stats = userStats(guild.id, user.id, 0);
    const balance = getBalance(guild.id, user.id);
    const votes = monthVotes(guild.id, user.id);
    embed.addFields({
      name: label('kupa', '🏆', 'Sıralama'),
      value: [
        `${e('yildiz', '⭐')} **Seviye ${level.level}**${place(level.rank)} — ${bar(level.current / level.needed)} \`${num(level.current)}/${num(level.needed)} XP\``,
        `${currency()} **${num(balance)}** coin${place(coinRank(guild.id, user.id))}`,
        `${e('mesaj', '💬')} **${num(stats.messages)}** mesaj${place(stats.messageRank?.rank)}`,
        `${e('mikrofon', '🎙️')} **${formatVoice(stats.voiceSeconds)}** ses${place(stats.voiceRank?.rank)}`,
        `${e('alev', '🔥')} Bu ay **${votes}** oy`,
      ].join('\n'),
    });
  }

  const roles = [...member.roles.cache.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position).values()];
  const more = roles.length > LISTED_ROLES ? ` +${roles.length - LISTED_ROLES}` : '';
  embed.addFields({ name: label('rozet', '🏷️', `Roller · ${roles.length}`), value: `${roles.slice(0, LISTED_ROLES).join(' ')}${more}` || 'yok' });

  const perms = member.permissions.has('Administrator')
    ? 'Yönetici (tüm yetkiler)'
    : KEY_PERMS.filter(([p]) => member.permissions.has(p)).map(([, name]) => name).join(', ');
  if (perms) embed.addFields({ name: label('anahtar', '🔑', 'Önemli Yetkiler'), value: `${perms}\nBot yetkisi: **${LevelName[getLevel(member)]}**` });

  const here = [];
  if (member.premiumSince) here.push(`${e('roket', '💜')} **Takviye:** ${relativeTime(member.premiumSinceTimestamp)} beri`);
  const voice = member.voice;
  if (voice?.channel) {
    const mic = voice.mute ? 'mikrofon kapalı' : 'mikrofon açık';
    const sound = voice.deaf ? ' · sağır' : '';
    here.push(`${e('mikrofon', '🎧')} **Seste:** ${voice.channel}${voice.streaming ? ' · yayında' : ''} · ${mic}${sound}`);
  }
  if (here.length) embed.addFields({ name: label('ev', '🏠', 'Sunucuda'), value: here.join('\n') });

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

function userButtons(picked) {
  // userView kullanıcıyı tam haliyle çekti; banner bilgisi önbellekte
  const user = picked.client.users.cache.get(picked.id) ?? picked;
  const link = (text, url, key, fallback) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(text).setURL(url).setEmoji(e(key, fallback));
  const top = new ActionRowBuilder().addComponents(
    button(`avatar:${user.id}`, 'Avatar', 'foto', '🖼️'),
    link('Avatar (tam boy)', user.displayAvatarURL({ size: 4096 }), 'foto', '🖼️'),
  );
  if (user.banner) top.addComponents(link('Banner', user.bannerURL({ size: 4096 }), 'foto', '🎨'));
  top.addComponents(link('Discord Profili', `https://discord.com/users/${user.id}`, 'kullanici', '👤'));
  // Sıralama bilgileri artık mesajın içinde; ayrıca sadece seviye kartı butonu kalır
  if (!user.bot) top.addComponents(button(`kart:${user.id}`, 'Seviye Kartı', 'yildiz', '⭐'));
  return [top];
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
