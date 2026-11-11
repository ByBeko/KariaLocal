import { e } from '../../utils/emojis.js';
import {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, EmbedBuilder,
} from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { runAudit, SEVERITY } from '../../systems/audit.js';
import { COLORS, kariaEmbed } from '../../utils/embeds.js';

const FIX_BUTTONS = {
  'uye-rolu': () => new ButtonBuilder().setCustomId('denetim:uye-rolu').setLabel('Eksik üye rollerini ver').setEmoji(e('araclar', '🛠️')).setStyle(ButtonStyle.Primary),
};

export default {
  level: Level.ADMIN,
  aliases: ['guvenlik'],
  data: new SlashCommandBuilder()
    .setName('denetim')
    .setDescription('Sunucuyu tarar: tehlikeli izinler, rol/kanal sorunları, eksik ayarlar.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild } = interaction;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await guild.members.fetch();
    const { score, findings } = runAudit(guild);

    const color = score >= 80 ? COLORS.success : score >= 50 ? COLORS.warning : COLORS.error;
    const counts = Object.entries(SEVERITY)
      .map(([k, s]) => `${findings.filter((f) => f.severity === k).length} ${s.label}`) // alt bilgide özel emoji görünmez
      .join('  ');

    // Bulguları 4000 karakterlik embed'lere böl
    const blocks = findings.map((f) => `${SEVERITY[f.severity].emoji} **${f.title}**\n${f.detail}`);
    const embeds = [];
    let current = '';
    for (const block of blocks.length ? blocks : [`${e('onayli', '✅')} Sorun bulunamadı.`]) {
      if ((current + block).length > 3900) {
        embeds.push(current);
        current = '';
      }
      current += `${block}\n\n`;
    }
    embeds.push(current);

    const built = embeds.slice(0, 9).map((text, i) => {
      const embed = kariaEmbed(interaction.client, `Sunucu Denetimi${embeds.length > 1 ? ` · ${i + 1}/${embeds.length}` : ''}`, { icon: guild.iconURL() ?? undefined, footer: counts }).setColor(color).setDescription(text.trim());
      if (i === 0) embed.setTitle(`${e('kalkan', '🛡️')} Puan: ${score}/100`).setThumbnail(guild.iconURL({ size: 256 }));
      return embed;
    });

    // Discord: mesaj başına embed'lerin toplamı en fazla 6000 karakter → her embed ayrı mesaj
    const fixes = [...new Set(findings.map((f) => f.fix).filter(Boolean))].map((k) => FIX_BUTTONS[k]());
    const components = fixes.length ? [new ActionRowBuilder().addComponents(fixes)] : [];
    await interaction.editReply({ embeds: [built[0]], components: built.length === 1 ? components : [] });
    for (let i = 1; i < built.length; i++) {
      await interaction.followUp({ embeds: [built[i]], components: i === built.length - 1 ? components : [], flags: MessageFlags.Ephemeral });
    }
  },
};
