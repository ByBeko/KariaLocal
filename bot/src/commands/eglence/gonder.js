import { SlashCommandBuilder } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { kariaEmbed, label } from '../../utils/embeds.js';
import { takeMoney, addMoney, fmt, ensureEnabled } from '../../systems/economy.js';
import { UserError } from '../../utils/errors.js';

export default {
  aliases: ['pay', 'transfer', 'gönder', 'paragonder'],
  data: new SlashCommandBuilder()
    .setName('gonder')
    .setDescription('Başka bir üyeye coin gönder.')
    .addUserOption((o) => o.setName('kullanici').setDescription('Kime?').setRequired(true))
    .addIntegerOption((o) => o.setName('miktar').setDescription('Kaç coin?').setMinValue(1).setMaxValue(1_000_000).setRequired(true)),

  async execute(interaction) {
    const { guild } = interaction;
    ensureEnabled(guild.id);
    const user = interaction.options.getUser('kullanici', true);
    const amount = interaction.options.getInteger('miktar', true);
    if (user.id === interaction.user.id) throw new UserError('Kendine para gönderemezsin.');
    if (user.bot) throw new UserError('Botlara para gönderemezsin.');
    const left = takeMoney(guild.id, interaction.user.id, amount);
    addMoney(guild.id, user.id, amount);
    await interaction.reply({
      content: `${user}`,
      embeds: [
        kariaEmbed(interaction.client, 'Coin Transferi', { icon: interaction.user.displayAvatarURL() })
          .setDescription(`${interaction.user} ${e('ok', '➡️')} ${user}`)
          .addFields(
            { name: label('dolar2', '💸', 'Gönderilen'), value: fmt(amount), inline: true },
            { name: label('coin', '🪙', 'Kalan bakiyen'), value: fmt(left), inline: true },
          ),
      ],
      allowedMentions: { users: [user.id] },
    });
  },
};
