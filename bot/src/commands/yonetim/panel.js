import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { verifyPanel, rolePanel, ticketPanel, linksPanel, bannerMessage } from '../../systems/panels.js';
import { replySuccess } from '../../utils/embeds.js';

const PANELS = {
  dogrulama: verifyPanel,
  roller: rolePanel,
  talep: ticketPanel,
  baglantilar: linksPanel,
};
// Panelden önce gönderilen kanal banner'ı (bot/assets/banners)
const BANNERS = { roller: 'roller', talep: 'destek-talebi', baglantilar: 'baglantilar' };

export default {
  level: Level.ADMIN,
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Butonlu/menülü bir paneli kanala gönderir.')
    .addStringOption((o) =>
      o.setName('tur').setDescription('Panel türü').setRequired(true).addChoices(
        { name: 'Doğrulama (kurallar)', value: 'dogrulama' },
        { name: 'Rol seçimi', value: 'roller' },
        { name: 'Destek talebi', value: 'talep' },
        { name: 'Bağlantılar', value: 'baglantilar' },
      ),
    )
    .addChannelOption((o) =>
      o.setName('kanal').setDescription('Hangi kanala? (boş = bu kanal)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addBooleanOption((o) => o.setName('banner').setDescription('Panelden önce kanal banner\'ı gönderilsin mi? (varsayılan: evet)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const type = interaction.options.getString('tur', true);
    const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
    const payload = PANELS[type](interaction.guild);
    if (BANNERS[type] && interaction.options.getBoolean('banner') !== false) await channel.send(bannerMessage(BANNERS[type]));
    await channel.send(payload);
    await replySuccess(interaction, `Panel ${channel} kanalına gönderildi.`);
  },
};
