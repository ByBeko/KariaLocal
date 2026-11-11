import { SlashCommandBuilder, MessageFlags, InteractionContextType, ApplicationIntegrationType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { homeView, commandView, staffView, staffButtonRow } from '../../systems/help.js';
import { checkAccess, isStaff } from '../../utils/permissions.js';
import { replyError } from '../../utils/embeds.js';
import { e } from '../../utils/emojis.js';

export default {
  aliases: ['help', 'komutlar', 'y', 'yardım'],
  global: true, // Discord'un "komut destekler" rozeti için en az bir global komut gerekir
  data: new SlashCommandBuilder()
    .setName('yardim')
    .setNameLocalization('tr', 'yardım')
    .setDescription('Komut listesi ve kullanım örnekleri (herkes görür).')
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .addStringOption((o) => o.setName('komut').setDescription('Detayını görmek istediğin komut (yetkililer: "yetkili" yazarsa panel açılır)')),

  async execute(interaction) {
    const { client, member } = interaction;
    const name = interaction.options.getString('komut')?.toLocaleLowerCase('tr').replace(/^\//, '');

    // Yetkili paneli her zaman sadece yetkilinin kendisine görünür
    if (name === 'yetkili' && isStaff(member)) {
      if (interaction.isPrefix) {
        return interaction.reply({ content: `${e('kalkan2', '🛡️')} Yetkili paneli sadece sana görünür, butona bas:`, components: [staffButtonRow()] });
      }
      return interaction.reply({ ...staffView(member, client), flags: MessageFlags.Ephemeral });
    }
    if (name) {
      const command = client.commands.get(name) ?? client.commands.find((c) => c.aliases?.includes(name));
      // Yetkisi olmayan, yetkili komutlarının varlığını da görmez
      if (!command || checkAccess(member, command)) return replyError(interaction, `\`${name}\` diye bir komut yok. Tüm komutlar: \`kari yardim\``);
      return interaction.reply({ embeds: [commandView(command)] });
    }

    // Herkese açık yardım menüsü
    const view = homeView(member, client, interaction.user.id);
    const siteRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('karia.live').setURL('https://karia.live'),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Oyunlar ve Müzik').setURL('https://activity.karia.live'),
    );
    await interaction.reply(view.components.length < 5 ? { ...view, components: [...view.components, siteRow] } : view);
    // Yetkiliye, sadece kendisinin göreceği panel butonu ayrıca gelir
    if (isStaff(member)) {
      await interaction
        .followUp({ content: `${e('kalkan2', '🛡️')} Yetkili komutların için (sadece sen görürsün):`, components: [staffButtonRow()], flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  },
};
