import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { settingsOfType, formatSetting } from '../../core/settings.js';
import { kariaEmbed } from '../../utils/embeds.js';
import { e } from '../../utils/emojis.js';

const groups = () => [
  ['channel', `${e('pano', '📁')} Kanallar`],
  ['role', `${e('rozet', '🎭')} Roller`],
  ['bool', `${e('ayarlar', '🔘')} Özellikler`],
  ['number', `${e('hedef', '🔢')} Sayılar`],
  ['text', `${e('kalem', '📝')} Yazılar`],
];

export default {
  level: Level.ADMIN,
  data: new SlashCommandBuilder()
    .setName('ayarlar')
    .setDescription('Botun tüm ayarlarını gösterir.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const embed = kariaEmbed(interaction.client, 'Bot Ayarları', { footer: 'Değiştirmek için /ayarla' })
      .setTitle(interaction.guild.name)
      .setThumbnail(interaction.guild.iconURL({ size: 256 }));
    for (const [type, title] of groups()) {
      const lines = settingsOfType(type).map(([key, s]) => `**${s.label}:** ${formatSetting(guildId, key)}`);
      embed.addFields({ name: title, value: lines.join('\n').slice(0, 1024) });
    }
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
