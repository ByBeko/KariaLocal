import { SlashCommandBuilder } from 'discord.js';
import { e } from '../../utils/emojis.js';
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

      const head = `**${member.displayName}**, ${fmt(bet)} bastı ve **${label(pick)}** seçti.`;
      await interaction.reply({ content: `${head}\n${e('yenile', '🔄')} Para dönüyor...`, allowedMentions: { parse: [] } });
      await new Promise((r) => setTimeout(r, SPIN_MS));
      await interaction.editReply({
        content: `${head}\n${e('coin', '🪙')} **${label(result)}** geldi, ${won ? `${fmt(bet * 2)} kazandın!` : 'kaybettin.'}`,
        allowedMentions: { parse: [] },
      });
    } finally {
      unlock();
    }
  },
};
