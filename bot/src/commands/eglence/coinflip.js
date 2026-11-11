import { SlashCommandBuilder } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { kariaEmbed, label as field, COLORS } from '../../utils/embeds.js';
import { parseBet, takeMoney, addMoney, fmt, ensureEnabled, lockGame } from '../../systems/economy.js';

const SPIN_MS = 1500;
const label = (side) => (side === 'yazi' ? 'Yazı' : 'Tura');

export default {
  aliases: ['cf', 'yazitura', 'yazı-tura'],
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Yazı tura: bilirsen bahsin 2 katını alırsın.')
    .addStringOption((o) => o.setName('miktar').setDescription('Bahis (örn. 100, 1k, hepsi, yarısı)').setRequired(true))
    .addStringOption((o) =>
      o.setName('secim').setDescription('Yazı mı tura mı? (boşsa yazı)').addChoices({ name: 'Yazı', value: 'yazi' }, { name: 'Tura', value: 'tura' }),
    ),

  async execute(interaction) {
    const { guild, user, member } = interaction;
    ensureEnabled(guild.id);
    const bet = parseBet(interaction.options.getString('miktar', true), guild.id, user.id);
    const raw = (interaction.options.getString('secim') ?? 'yazi').toLocaleLowerCase('tr').replace('ı', 'i');
    const pick = raw.startsWith('t') ? 'tura' : 'yazi';
    const unlock = lockGame(guild.id, user.id); // oyun bitince 5 saniye beklenir
    try {
      takeMoney(guild.id, user.id, bet);

      const result = Math.random() < 0.5 ? 'yazi' : 'tura';
      const won = result === pick;
      if (won) addMoney(guild.id, user.id, bet * 2);

      const view = (title, outcome, done = false) => {
        const embed = kariaEmbed(interaction.client, 'Yazı Tura', { icon: user.displayAvatarURL() })
          .setTitle(title)
          .addFields(
            { name: field('dolar2', '💰', 'Bahis'), value: fmt(bet), inline: true },
            { name: field('hedef', '🎯', 'Seçim'), value: `**${label(pick)}**`, inline: true },
            { name: field('coin', '🪙', 'Sonuç'), value: outcome, inline: true },
          );
        if (done) embed.setColor(won ? COLORS.success : COLORS.error);
        return { embeds: [embed], allowedMentions: { parse: [] } };
      };
      await interaction.reply(view(`${e('yenile', '🔄')} Para dönüyor...`, '...'));
      await new Promise((r) => setTimeout(r, SPIN_MS));
      await interaction.editReply(view(
        won ? `${member.displayName} kazandı!` : `${member.displayName} kaybetti`,
        `**${label(result)}**\n${won ? `+${fmt(bet * 2)}` : `-${fmt(bet)}`}`,
        true,
      ));
    } finally {
      unlock();
    }
  },
};
