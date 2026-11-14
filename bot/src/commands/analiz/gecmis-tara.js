import { e } from '../../utils/emojis.js';
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { backfill } from '../../systems/backfill.js';
import { replySuccess, kariaEmbed } from '../../utils/embeds.js';

export default {
  level: Level.ADMIN,
  data: new SlashCommandBuilder()
    .setName('gecmis-tara')
    .setDescription('Bot kurulmadan önceki mesajları tarayıp istatistiklere ekler (tek seferlik).')
    .addIntegerOption((o) => o.setName('gun').setDescription('Kaç gün geriye? (varsayılan 30, en fazla 365)').setMinValue(1).setMaxValue(365))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const days = interaction.options.getInteger('gun') ?? 30;
    await interaction.deferReply();
    const progress = (done, total, messages) =>
      interaction
        .editReply({ embeds: [kariaEmbed(null, 'Geçmiş Tarama').setDescription(`${e('hedef', '🔎')} Taranıyor... **${done}/${total}** kanal • ${messages} mesaj bulundu`)] })
        .catch(() => {});

    const result = await backfill(interaction.guild, days, progress);
    await replySuccess(
      interaction,
      `Son **${days} gün** tarandı: **${result.channels}** kanal, **${result.messages}** mesaj ve **${result.joins}** katılım istatistiklere eklendi. Artık \`/analiz\` ile bakabilirsin.`,
      false,
    );
  },
};
