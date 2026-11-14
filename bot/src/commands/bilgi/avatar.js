import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { brandEmbed, kariaEmbed } from '../../utils/embeds.js';
import { e } from '../../utils/emojis.js';

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

    const embeds = [
      kariaEmbed(interaction.client, server ? 'Sunucu Avatarı' : 'Avatar', { icon: user.displayAvatarURL() })
        .setTitle(member?.displayName ?? user.username)
        .setDescription(`${user} · \`${user.username}\``)
        .setImage(server ?? global),
    ];
    if (server) embeds.push(brandEmbed().setAuthor({ name: 'Genel profil fotoğrafı' }).setImage(global));
    if (banner) embeds.push(brandEmbed().setAuthor({ name: 'Profil afişi' }).setImage(banner));

    const link = (text, url, key, fallback) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(text).setURL(url).setEmoji(e(key, fallback));
    const row = new ActionRowBuilder().addComponents(
      link('Tarayıcıda Aç', server ?? global, 'foto', '🖼️'),
      ...(server ? [link('Genel Avatar', global, 'kullanici', '👤')] : []),
      ...(banner ? [link('Afiş', banner, 'parilti', '✨')] : []),
    );
    await interaction.reply({ embeds, components: [row] });
  },
};
