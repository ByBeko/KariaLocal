import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType } from 'discord.js';
import { getBalance, fmt, ensureEnabled } from '../../systems/economy.js';
import { kariaEmbed, label } from '../../utils/embeds.js';

export default {
  aliases: ['para', 'cuzdan', 'bal', 'cüzdan'],
  global: true, // profildeki "Komutlar" kutusunda görünmesi için
  data: new SlashCommandBuilder()
    .setName('bakiye')
    .setDescription('Karia coin bakiyeni gösterir.')
    .addUserOption((o) => o.setName('kullanici').setDescription('Başkasının bakiyesi'))
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),

  async execute(interaction) {
    ensureEnabled(interaction.guild.id);
    const user = interaction.options.getUser('kullanici') ?? interaction.user;
    const self = user.id === interaction.user.id;
    const embed = kariaEmbed(interaction.client, 'Cüzdan', { icon: user.displayAvatarURL() })
      .setTitle(self ? 'Bakiyen' : `${user.displayName} bakiyesi`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: label('coin', '🪙', 'Karia Coin'), value: fmt(getBalance(interaction.guild.id, user.id)), inline: true },
        { name: label('hediye', '🎁', 'Kazanmak için'), value: '`/gunluk` · `/slot`\n`/coinflip` · `/blackjack`', inline: true },
      );
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
