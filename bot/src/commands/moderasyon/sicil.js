import { e } from '../../utils/emojis.js';
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { getUserCases, countActiveWarns, CASE_TYPES, isJailed } from '../../systems/moderation.js';
import { brandEmbed } from '../../utils/embeds.js';
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

    const embed = brandEmbed()
      .setAuthor({ name: `${user.tag} • Sicil`, iconURL: user.displayAvatarURL() })
      .setDescription(lines.join('\n') || `Temiz sicil. ${e('parilti', '✨')}`)
      .addFields(
        { name: 'Aktif uyarı', value: String(countActiveWarns(guild.id, user.id)), inline: true },
        { name: 'Jail', value: isJailed(guild.id, user.id) ? 'Evet' : 'Hayır', inline: true },
      )
      .setFooter({ text: 'Son 15 kayıt gösteriliyor' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
