import {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} from 'discord.js';
import { Level } from '../../utils/permissions.js';

export default {
  level: Level.ADMIN,
  data: new SlashCommandBuilder()
    .setName('duyuru')
    .setDescription('Kurallar düzeninde duyuru hazırlayıp gönderir.')
    .addChannelOption((o) => o.setName('kanal').setDescription('Hangi kanala? (boşsa burası)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption((o) => o.setName('etiket').setDescription('Duyuruda etiketlenecek rol (boşsa kimse etiketlenmez)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
    const role = interaction.options.getRole('etiket');
    const input = (id, label, style, max, required) =>
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setRequired(required));

    const body = input('metin', 'Metin', TextInputStyle.Paragraph, 1500, true);
    body.components[0].setPlaceholder('Bölümleri boş satırla ayır. Bölüm başlığı için satırı # ile başlat.');
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`duyuru:gonder:${channel.id}:${role?.id ?? '0'}`)
        .setTitle('Duyuru Hazırla')
        .addComponents(input('baslik', 'Başlık', TextInputStyle.Short, 80, true), body, input('not', 'Alt not (isteğe bağlı)', TextInputStyle.Short, 200, false)),
    );
  },
};
