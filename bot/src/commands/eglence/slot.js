import { SlashCommandBuilder } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { parseBet, takeMoney, addMoney, fmt, ensureEnabled, lockGame } from '../../systems/economy.js';
import { spinSlot, slotOutcome } from '../../systems/casino.js';

const REEL_MS = 700;
const icon = (s) => e(s.key, s.fallback);
const wait = () => new Promise((r) => setTimeout(r, REEL_MS));

export default {
  aliases: ['slots', 'kumar'],
  data: new SlashCommandBuilder()
    .setName('slot')
    .setDescription('Slot makinesi: üç aynı sembol 3x–50x, iki aynı 1.5x.')
    .addStringOption((o) => o.setName('miktar').setDescription('Bahis (örn. 100, 1k, hepsi)').setRequired(true)),

  async execute(interaction) {
    const { guild, user, member } = interaction;
    ensureEnabled(guild.id);
    const bet = parseBet(interaction.options.getString('miktar', true), guild.id, user.id);
    const unlock = lockGame(guild.id, user.id);
    try {
      takeMoney(guild.id, user.id, bet);
      const reels = [spinSlot(), spinSlot(), spinSlot()];
      const { multiplier } = slotOutcome(reels);
      const payout = Math.floor(bet * multiplier);
      addMoney(guild.id, user.id, payout);

      const spinning = e('yenile', '🔄');
      const frame = (open, note) => {
        const shown = reels.map((s, i) => (i < open ? icon(s) : spinning));
        return { content: `${e('oyun', '🎰')} **SLOT**\n┃ ${shown.join(' ┃ ')} ┃\n**${member.displayName}**, ${fmt(bet)} bastı${note}`, allowedMentions: { parse: [] } };
      };

      await interaction.reply(frame(0, '...'));
      for (const open of [1, 2]) {
        await wait();
        await interaction.editReply(frame(open, '...'));
      }
      await wait();
      await interaction.editReply(frame(3, payout ? ` ve ${fmt(payout)} kazandı! (**${multiplier}x**)` : ' ve kaybetti.'));
    } finally {
      unlock();
    }
  },
};
