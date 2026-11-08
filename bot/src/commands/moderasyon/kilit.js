import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { getSetting } from '../../core/settings.js';
import { brandEmbed } from '../../utils/embeds.js';
import { e } from '../../utils/emojis.js';

export default {
  level: Level.MOD,
  data: new SlashCommandBuilder()
    .setName('kilit')
    .setDescription('Kanalı mesaj gönderimine kapatır ya da açar.')
    .addSubcommand((s) => s.setName('kapat').setDescription('Kanalı kilitle').addStringOption((o) => o.setName('sebep').setDescription('Sebep')))
    .addSubcommand((s) => s.setName('ac').setDescription('Kanalın kilidini aç'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const lock = interaction.options.getSubcommand() === 'kapat';
    const { channel, guild } = interaction;

    // @everyone ve (varsa) üye rolü için mesaj iznini değiştir
    const targets = [guild.roles.everyone.id, getSetting(guild.id, 'member_role')].filter(Boolean);
    for (const id of targets) {
      await channel.permissionOverwrites.edit(id, { SendMessages: lock ? false : null }, { reason: `${interaction.user.tag}: kilit` });
    }

    const reason = interaction.options.getString('sebep');
    const embed = brandEmbed().setDescription(
      lock ? `${e('kilit', '🔒')} Kanal kilitlendi.${reason ? `\n**Sebep:** ${reason}` : ''}` : `${e('kilit_acik', '🔓')} Kanalın kilidi açıldı.`,
    );
    await interaction.reply({ embeds: [embed] });
  },
};
