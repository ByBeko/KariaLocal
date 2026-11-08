import { e } from '../../utils/emojis.js';
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { collectMetrics, deriveFindings, collectSignals, LEVEL_EMOJI } from '../../systems/insights.js';
import { developmentPlan, aiModelName } from '../../systems/ai.js';
import { brandEmbed, COLORS } from '../../utils/embeds.js';
import { UserError } from '../../utils/errors.js';

export default {
  level: Level.ADMIN,
  aliases: ['gelistir', 'oneriler'],
  data: new SlashCommandBuilder()
    .setName('gelisim')
    .setDescription('Sunucuyu neyin geliştireceğine dair rapor: tespitler + yapay zeka gelişim planı.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild } = interaction;
    await interaction.deferReply();
    await guild.members.fetch();

    const m = collectMetrics(guild);
    const findings = deriveFindings(m);
    const trend = m.mesaj_onceki_7g ? ` (önceki hafta ${m.mesaj_onceki_7g})` : '';

    const facts = brandEmbed()
      .setAuthor({ name: `${guild.name} • Gelişim Raporu`, iconURL: guild.iconURL() ?? undefined })
      .setTitle(`${e('istatistik', '📊')} Tespitler`)
      .addFields(
        { name: `${e('mesaj', '💬')} Mesaj`, value: `30 gün: **${m.mesaj_30g}**\n7 gün: **${m.mesaj_7g}**${trend}`, inline: true },
        { name: `${e('arkadaslar', '👥')} Aktiflik`, value: `**${m.aktif_uye_30g}/${m.uyeler}** üye (%${m.aktif_orani})\nİlk 3 kişinin payı: **%${m.ilk3_payi}**`, inline: true },
        { name: `${e('roket', '🌱')} Büyüme (30g)`, value: `+${m.katilan_30g} / -${m.ayrilan_30g}\nHiç yazmayan yeni: **${m.hic_yazmayan_yeni}/${m.yeni_uye_30g}**`, inline: true },
      )
      .setDescription(findings.map((f) => `${LEVEL_EMOJI[f.level]} **${f.area}:** ${f.text}`).join('\n\n').slice(0, 4000) || 'Belirgin bir sorun yok.')
      .setFooter({ text: `Veri başlangıcı: ${m.veri_baslangici ?? '—'} • Plan hazırlanıyor...` });
    await interaction.editReply({ embeds: [facts] });

    // Topluluk sinyalleri + yapay zeka planı
    const signals = await collectSignals(guild);
    const signalText = `${signals.oneriler.length} öneri, ${signals.forumlar.reduce((a, f) => a + f.basliklar.length, 0)} forum başlığı, ${signals.sohbet.length} sohbet mesajı incelendi`;

    let plan;
    try {
      plan = await developmentPlan(guild, m, findings, signals);
    } catch (error) {
      facts.setFooter({ text: `Veri başlangıcı: ${m.veri_baslangici ?? '—'}` });
      await interaction.editReply({ embeds: [facts] });
      if (error instanceof UserError) {
        return interaction.followUp({ embeds: [brandEmbed().setColor(COLORS.warning).setDescription(`${e('unlem', '⚠️')} Yapay zeka planı hazırlanamadı: ${error.message}`)] });
      }
      throw error;
    }

    facts.setFooter({ text: `Veri başlangıcı: ${m.veri_baslangici ?? '—'}` });
    await interaction.editReply({ embeds: [facts] });
    await interaction.followUp({
      embeds: [
        brandEmbed()
          .setTitle(`${e('ok', '🧭')} Gelişim Planı`)
          .setDescription(plan.slice(0, 4000) || 'Plan üretilemedi.')
          .setFooter({ text: `Karia AI • ${aiModelName} • ${signalText}. Öneriler yanlış olabilir, son karar sizin.` }),
      ],
      allowedMentions: { parse: [] },
    });
  },
};
