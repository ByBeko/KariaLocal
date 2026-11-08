import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, MessageFlags } from 'discord.js';
import { Level, staffRoleIds } from '../../utils/permissions.js';
import { getSetting, setSetting } from '../../core/settings.js';
import { replySuccess } from '../../utils/embeds.js';

/** Herkese kapalı, yetkililere açık izinler */
function privateOverwrites(guild) {
  return [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
    ...staffRoleIds(guild.id).map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] })),
  ];
}

export const LOG_CHANNELS = [
  ['log_member', 'giriş-çıkış-log'],
  ['log_mod', 'ceza-log'],
  ['log_ad', 'reklam-log'],
  ['log_level', 'seviye-log'],
  ['log_message', 'mesaj-log'],
  ['log_nick', 'isim-log'],
  ['log_ban', 'ban-log'],
  ['log_staff', 'mod-log'],
  ['log_invite', 'davet-log'],
  ['log_voice', 'ses-log'],
  ['log_role', 'rol-log'],
  ['log_ticket', 'talep-log'],
];

/** Eksik log kanallarını oluşturur. Var olanlara dokunmaz, tekrar çalıştırılabilir. */
export async function setupLogs(guild) {
  const existing = LOG_CHANNELS.map(([key]) => guild.channels.cache.get(getSetting(guild.id, key))).find(Boolean);
  const category =
    existing?.parent ??
    (await guild.channels.create({ name: '📁 Karia Log', type: ChannelType.GuildCategory, permissionOverwrites: privateOverwrites(guild) }));

  const created = [];
  for (const [index, [key, name]] of LOG_CHANNELS.entries()) {
    let channel = guild.channels.cache.get(getSetting(guild.id, key));
    if (!channel) {
      channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, permissionOverwrites: privateOverwrites(guild) });
      setSetting(guild.id, key, channel.id);
      created.push(`${channel}`);
    }
    if (key === 'log_member' && channel.name === 'üye-log') await channel.setName(name).catch(() => {}); // eski kurulum
    if (channel.parentId === category.id) await channel.setPosition(index).catch(() => {});
  }
  return created.length ? `Yeni log kanalları: ${created.join(' ')}` : 'Tüm log kanalları zaten kurulu.';
}

export async function setupJail(guild) {
  let role = guild.roles.cache.get(getSetting(guild.id, 'jail_role'));
  if (!role) {
    role = await guild.roles.create({ name: 'Jail', colors: { primaryColor: 0x2f3136 }, permissions: [], reason: 'Karia jail kurulumu' });
    setSetting(guild.id, 'jail_role', role.id);
  }

  let jailChannel = guild.channels.cache.get(getSetting(guild.id, 'jail_channel'));
  if (!jailChannel) {
    jailChannel = await guild.channels.create({
      name: 'jail',
      type: ChannelType.GuildText,
      topic: 'Ceza süren dolana kadar buradasın. Kurallara uymayı unutma.',
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ...staffRoleIds(guild.id).map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] })),
      ],
    });
    setSetting(guild.id, 'jail_channel', jailChannel.id);
  }

  // Jail rolü diğer tüm kanalları göremesin
  let count = 0;
  for (const channel of guild.channels.cache.values()) {
    if (channel.id === jailChannel.id || channel.isThread()) continue;
    await channel.permissionOverwrites.edit(role, { ViewChannel: false }, { reason: 'Jail kurulumu' }).then(() => count++).catch(() => {});
  }
  return `Jail hazır: ${role} rolü ve ${jailChannel} kanalı. ${count} kanalda jail rolü gizlendi.`;
}

export async function setupTickets(guild) {
  const category = await guild.channels.create({
    name: '🎫 Destek Talepleri',
    type: ChannelType.GuildCategory,
    permissionOverwrites: privateOverwrites(guild),
  });
  setSetting(guild.id, 'ticket_category', category.id);
  return `Talep kategorisi oluşturuldu: **${category.name}**. Şimdi talep kanalında \`/panel tur:Destek talebi\` çalıştır.`;
}

export default {
  level: Level.ADMIN,
  data: new SlashCommandBuilder()
    .setName('kurulum')
    .setDescription('Gerekli kanal ve rolleri otomatik oluşturur.')
    .addSubcommand((s) => s.setName('loglar').setDescription('Gizli log kategorisini ve eksik log kanallarını oluşturur'))
    .addSubcommand((s) => s.setName('jail').setDescription('Jail rolü ve kanalını oluşturur, diğer kanalları jail rolüne gizler'))
    .addSubcommand((s) => s.setName('talep').setDescription('Destek talepleri için gizli kategori oluşturur'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    const run = { loglar: setupLogs, jail: setupJail, talep: setupTickets }[sub];
    const result = await run(interaction.guild);
    await replySuccess(interaction, result);
  },
};
