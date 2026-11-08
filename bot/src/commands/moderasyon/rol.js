import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { replySuccess } from '../../utils/embeds.js';
import { UserError } from '../../utils/errors.js';
import { parseDuration, formatDuration, relativeTime } from '../../utils/time.js';
import { scheduleRoleRemoval, cancelRoleRemoval } from '../../systems/timers.js';

const DANGEROUS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageWebhooks,
];

function checkRole(interaction, role) {
  const { guild, member } = interaction;
  if (role.id === guild.id) throw new UserError('@everyone rolü verilemez.');
  if (role.managed) throw new UserError('Bu rol bir bota/entegrasyona ait, elle verilemez.');
  if (!role.editable) throw new UserError('Bu rol benim rolümden yüksekte. Bot rolünü rol listesinde yukarı taşı.');
  if (member.id !== guild.ownerId) {
    if (role.position >= member.roles.highest.position) throw new UserError('Kendi en yüksek rolünle aynı ya da daha yüksek bir rolü veremezsin.');
    if (DANGEROUS.some((p) => role.permissions.has(p)) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
      throw new UserError('Bu rolde yönetim izinleri var; sadece yöneticiler verebilir.');
    }
  }
}

export default {
  level: Level.MOD,
  aliases: ['rolver'],
  defaultSub: 'ver', // "kl rol @ali @Rol 7g" = rol ver
  data: new SlashCommandBuilder()
    .setName('rol')
    .setDescription('Üyeye rol ver ya da al; istersen süreli ver.')
    .addSubcommand((s) =>
      s
        .setName('ver')
        .setDescription('Rol verir (süre yazılırsa süre dolunca otomatik alınır)')
        .addUserOption((o) => o.setName('kullanici').setDescription('Üye').setRequired(true))
        .addRoleOption((o) => o.setName('rol').setDescription('Rol').setRequired(true))
        .addStringOption((o) => o.setName('sure').setDescription('Süreli rol için: 30dk, 2sa, 7g ...')),
    )
    .addSubcommand((s) =>
      s
        .setName('al')
        .setDescription('Rolü alır')
        .addUserOption((o) => o.setName('kullanici').setDescription('Üye').setRequired(true))
        .addRoleOption((o) => o.setName('rol').setDescription('Rol').setRequired(true)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild } = interaction;
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('kullanici', true);
    const role = interaction.options.getRole('rol', true);
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) throw new UserError('Bu kişi sunucuda değil.');
    checkRole(interaction, role);
    const by = `${interaction.user.tag}`;

    if (sub === 'al') {
      if (!member.roles.cache.has(role.id)) throw new UserError(`${member} üyesinde ${role} rolü yok.`);
      await member.roles.remove(role, `${by}: rol al`);
      cancelRoleRemoval(guild.id, member.id, role.id);
      return replySuccess(interaction, `${member} üyesinden ${role} alındı.`, false);
    }

    const durationText = interaction.options.getString('sure');
    const duration = durationText ? parseDuration(durationText) : null;
    if (durationText && !duration) throw new UserError('Süreyi anlayamadım. Örnek: `30dk`, `2sa`, `7g`, `1hf`');
    if (!member.roles.cache.has(role.id)) await member.roles.add(role, `${by}: rol ver${duration ? ` (${formatDuration(duration)})` : ''}`);
    else if (!duration) throw new UserError(`${member} üyesinde ${role} rolü zaten var.`);

    if (duration) {
      const until = Date.now() + duration;
      scheduleRoleRemoval(guild.id, member.id, role.id, until, interaction.user.id);
      return replySuccess(interaction, `${member} üyesine ${role} verildi. **${formatDuration(duration)}** sonra (${relativeTime(until)}) otomatik alınacak.`, false);
    }
    cancelRoleRemoval(guild.id, member.id, role.id); // elle kalıcı verildiyse eski süre iptal
    await replySuccess(interaction, `${member} üyesine ${role} verildi.`, false);
  },
};
