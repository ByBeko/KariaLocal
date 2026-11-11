import { SlashCommandBuilder } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { kariaEmbed, label, COLORS } from '../../utils/embeds.js';
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
      const frame = (open) => {
        const shown = reels.map((s, i) => (i < open ? icon(s) : spinning));
        const done = open === 3;
        const embed = kariaEmbed(interaction.client, 'Slot', { icon: user.displayAvatarURL() })
          .setTitle(done ? (payout ? `${member.displayName} kazandı!` : `${member.displayName} kaybetti`) : 'Makara dönüyor...')
          .setDescription(`## ┃ ${shown.join(' ┃ ')} ┃`)
          .addFields(
            { name: label('dolar2', '💰', 'Bahis'), value: fmt(bet), inline: true },
            { name: label('alev', '🔥', 'Çarpan'), value: done ? `**${multiplier}x**` : '...', inline: true },
            { name: label('coin', '🪙', 'Kazanç'), value: done ? (payout ? `+${fmt(payout)}` : `-${fmt(bet)}`) : '...', inline: true },
          );
        if (done) embed.setColor(payout ? COLORS.success : COLORS.error);
        return { embeds: [embed], allowedMentions: { parse: [] } };
      };

      await interaction.reply(frame(0));
      for (const open of [1, 2]) {
        await wait();
        await interaction.editReply(frame(open));
      }
      await wait();
      await interaction.editReply(frame(3));
    } finally {
      unlock();
    }
  },
};
