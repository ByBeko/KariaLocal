import { e } from '../../utils/emojis.js';
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { getUserCases, countActiveWarns, CASE_TYPES, isJailed } from '../../systems/moderation.js';
import { kariaEmbed, label } from '../../utils/embeds.js';
import { formatDuration, relativeTime } from '../../utils/time.js';

export default {
  level: Level.STAFF,
  aliases: ['uyarilar', 'gecmis', 'uyari-gecmisi'],
  data: new SlashCommandBuilder()
    .setName('sicil')
    .setDescription('Bir kullanıcının ceza geçmişini gösterir.')
    .addUserOption((o) => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const user = interaction.options.getUser('kullanici', true);
    const { guild } = interaction;
    const cases = getUserCases(guild.id, user.id, 15);

    const lines = cases.map((c) => {
      const t = CASE_TYPES[c.type];
      const removed = c.type === 'warn' && !c.active ? ' ~~(silindi)~~' : '';
      const dur = c.duration ? ` • ${formatDuration(c.duration)}` : '';
      return `\`#${c.id}\` ${t.emoji} **${t.label}**${dur} • ${relativeTime(c.created_at)} • <@${c.mod_id}>${removed}\n└ ${c.reason.slice(0, 120)}`;
    });

    const embed = kariaEmbed(interaction.client, 'Sicil', { icon: user.displayAvatarURL(), footer: 'Son 15 kayıt' })
      .setTitle(user.tag)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: label('unlem', '⚠️', 'Aktif uyarı'), value: `**${countActiveWarns(guild.id, user.id)}**`, inline: true },
        { name: label('kilit', '🔒', 'Jail'), value: isJailed(guild.id, user.id) ? '**Evet**' : 'Hayır', inline: true },
        { name: label('kitap', '📒', 'Kayıt'), value: `**${cases.length}** ceza`, inline: true },
      )
      .setDescription(lines.join('\n') || `Temiz sicil. ${e('parilti', '✨')}`);

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
