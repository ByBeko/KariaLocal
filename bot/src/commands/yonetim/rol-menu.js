import { e } from '../../utils/emojis.js';
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { db } from '../../core/database.js';
import { getRoleMenu } from '../../systems/panels.js';
import { kariaEmbed, replyError, replySuccess } from '../../utils/embeds.js';

const upsertStmt = db.prepare(
  'INSERT INTO role_menu (guild_id, role_id, emoji, description) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, role_id) DO UPDATE SET emoji = excluded.emoji, description = excluded.description',
);
const deleteStmt = db.prepare('DELETE FROM role_menu WHERE guild_id = ? AND role_id = ?');

// Unicode emoji veya <:ad:id> biçiminde özel emoji
const EMOJI_RE = /^(<a?:\w+:\d+>|\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*)$/u;

export default {
  level: Level.ADMIN,
  data: new SlashCommandBuilder()
    .setName('rol-menu')
    .setDescription('Rol seçim panelindeki rolleri yönetir.')
    .addSubcommand((s) =>
      s.setName('ekle').setDescription('Menüye rol ekler (ya da günceller)')
        .addRoleOption((o) => o.setName('rol').setDescription('Rol').setRequired(true))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji'))
        .addStringOption((o) => o.setName('aciklama').setDescription('Kısa açıklama').setMaxLength(100)),
    )
    .addSubcommand((s) =>
      s.setName('cikar').setDescription('Menüden rol çıkarır').addRoleOption((o) => o.setName('rol').setDescription('Rol').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('liste').setDescription('Menüdeki rolleri gösterir'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'liste') {
      const items = getRoleMenu(guildId);
      const embed = kariaEmbed(interaction.client, 'Rol Menüsü', { footer: 'Sonra /panel tur:Rol seçimi' })
        .setTitle(`${items.length} rol`)
        .setDescription(items.map((r) => `${r.emoji ?? '•'} <@&${r.role_id}>${r.description ? ` — ${r.description}` : ''}`).join('\n') || 'Boş.');
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const role = interaction.options.getRole('rol', true);
    if (sub === 'cikar') {
      deleteStmt.run(guildId, role.id);
      return replySuccess(interaction, `${role} menüden çıkarıldı. Paneli yeniden göndermeyi unutma.`);
    }

    if (role.managed || role.id === guildId) return replyError(interaction, 'Bu rol menüye eklenemez.');
    if (!role.editable) return replyError(interaction, 'Bu rol benim rolümden yüksekte, veremem. Bot rolünü yukarı taşı.');
    if (role.permissions.has(PermissionFlagsBits.ManageMessages) || role.permissions.has(PermissionFlagsBits.Administrator)) {
      return replyError(interaction, 'Yetkili izinleri olan bir rolü herkesin seçebileceği menüye ekleyemezsin.');
    }
    if (getRoleMenu(guildId).length >= 25 && !getRoleMenu(guildId).some((r) => r.role_id === role.id)) {
      return replyError(interaction, 'Menüde en fazla 25 rol olabilir.');
    }
    const emoji = interaction.options.getString('emoji')?.trim() || null;
    if (emoji && !EMOJI_RE.test(emoji)) return replyError(interaction, 'Geçersiz emoji. Tek bir emoji gir.');

    upsertStmt.run(guildId, role.id, emoji, interaction.options.getString('aciklama'));
    await replySuccess(interaction, `${role} menüye eklendi. Paneli göndermek için \`/panel tur:Rol seçimi\`.`);
  },
};
