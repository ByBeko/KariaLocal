import { e } from '../../utils/emojis.js';
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { isRaidActive, setRaid, getRaidEnd } from '../../systems/protection.js';
import { kariaEmbed } from '../../utils/embeds.js';
import { sendLog } from '../../utils/logger.js';

export default {
  level: Level.MOD,
  data: new SlashCommandBuilder()
    .setName('raid')
    .setDescription('Raid modunu yönetir (açıkken yeni girenler atılır).')
    .addSubcommand((s) =>
      s.setName('ac').setDescription('Raid modunu elle aç')
        .addIntegerOption((o) => o.setName('dakika').setDescription('Kaç dakika? (varsayılan 15)').setMinValue(1).setMaxValue(1440)),
    )
    .addSubcommand((s) => s.setName('kapat').setDescription('Raid modunu kapat'))
    .addSubcommand((s) => s.setName('durum').setDescription('Raid modu açık mı?'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild } = interaction;
    const sub = interaction.options.getSubcommand();
    let text;

    if (sub === 'ac') {
      const minutes = interaction.options.getInteger('dakika') ?? 15;
      setRaid(guild.id, minutes * 60_000);
      text = `${e('unlem', '🚨')} Raid modu **${minutes} dakika** açıldı. Yeni girenler atılacak.`;
      await sendLog(guild, 'log_mod', { content: `${text} (${interaction.user})` });
    } else if (sub === 'kapat') {
      setRaid(guild.id, 0);
      text = `${e('onayli', '✅')} Raid modu kapatıldı.`;
      await sendLog(guild, 'log_mod', { content: `${text} (${interaction.user})` });
    } else {
      text = isRaidActive(guild.id)
        ? `${e('unlem', '🚨')} Raid modu **açık**, <t:${Math.floor(getRaidEnd(guild.id) / 1000)}:R> kapanacak.`
        : `${e('onayli', '✅')} Raid modu kapalı.`;
    }
    await interaction.reply({ embeds: [kariaEmbed(null, 'Raid Koruması').setDescription(text)] });
  },
};
