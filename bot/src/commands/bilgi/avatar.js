import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { brandEmbed } from '../../utils/embeds.js';

export default {
  aliases: ['pp', 'av'],
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Bir kullanıcının profil fotoğrafını ve afişini büyük gösterir.')
    .addUserOption((o) => o.setName('kullanici').setDescription('Kimin? (boşsa sen)')),

  async execute(interaction) {
    const base = interaction.options.getUser('kullanici') ?? interaction.user;
    const user = await base.fetch(true).catch(() => base); // afiş için tam profil
    const member = interaction.guild.members.cache.get(user.id);
    const global = user.displayAvatarURL({ size: 1024 });
    const server = member?.avatar ? member.displayAvatarURL({ size: 1024 }) : null;
    const banner = user.bannerURL({ size: 1024 });

    const embeds = [brandEmbed().setAuthor({ name: `${user.username} • ${server ? 'Sunucu avatarı' : 'Avatar'}` }).setImage(server ?? global)];
    if (server) embeds.push(brandEmbed().setDescription('Genel profil fotoğrafı').setImage(global));
    if (banner) embeds.push(brandEmbed().setDescription('Profil afişi').setImage(banner));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Tarayıcıda aç').setURL(server ?? global),
      ...(banner ? [new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Afiş').setURL(banner)] : []),
    );
    await interaction.reply({ embeds, components: [row] });
  },
};
