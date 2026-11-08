import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import { e } from '../../utils/emojis.js';
import { brandEmbed } from '../../utils/embeds.js';
import { parseBet, takeMoney, addMoney, getBalance, ensureEnabled, lockGame } from '../../systems/economy.js';
import { newDeck, handTotal, isBlackjack, blackjackPayout, dealerPlay as settleDealer } from '../../systems/casino.js';

const total = handTotal;
const show = (hand) => hand.map((c) => `${e(c.s[0], c.s[1])} **${c.r}**`).join('  ');

export default {
  aliases: ['bj', '21'],
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription("Blackjack (21): krupiyeyi geç, 21'i aşma. Blackjack 2.5x öder.")
    .addStringOption((o) => o.setName('miktar').setDescription('Bahis (örn. 100, 1k, hepsi)').setRequired(true)),

  async execute(interaction) {
    const { guild, user } = interaction;
    ensureEnabled(guild.id);
    let bet = parseBet(interaction.options.getString('miktar', true), guild.id, user.id);
    const unlock = lockGame(guild.id, user.id);

    try {
      takeMoney(guild.id, user.id, bet);
      const deck = newDeck();
      const player = [deck.pop(), deck.pop()];
      const dealer = [deck.pop(), deck.pop()];

      const view = (state, reveal) => {
        const embed = brandEmbed()
          .setAuthor({ name: `${interaction.member.displayName}, ${bet.toLocaleString('tr-TR')} coin bastı`, iconURL: user.displayAvatarURL() })
          .addFields(
            {
              name: `Krupiye [${reveal ? total(dealer) : `${total([dealer[0]])}+?`}]`,
              value: reveal ? show(dealer) : `${show([dealer[0]])}  \`??\``,
            },
            { name: `Sen [${total(player)}]`, value: show(player) },
          )
          .setFooter({ text: state?.text ?? 'Oyun sürüyor' });
        if (state) embed.setColor(state.color);
        return embed;
      };
      const buttons = (canDouble) =>
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('bj:hit').setLabel('Kart çek').setEmoji(e('arti_rozet', '➕')).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('bj:stand').setLabel('Dur').setEmoji(e('onayli', '✋')).setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('bj:double').setLabel('İkiye katla').setEmoji(e('dolar2', '💰')).setStyle(ButtonStyle.Success).setDisabled(!canDouble),
        );

      const finish = async (outcome) => {
        // outcome: 'blackjack' | 'win' | 'push' | 'lose' | 'bust'
        const payout = blackjackPayout(bet, outcome);
        const balance = addMoney(guild.id, user.id, payout);
        const net = payout - bet;
        const amount = (n) => `${n.toLocaleString('tr-TR')} coin`;
        const text = {
          blackjack: `Blackjack! +${amount(net)}`,
          win: `Kazandın! +${amount(net)}`,
          push: 'Berabere, bahsin geri verildi.',
          lose: `Krupiye kazandı. -${amount(bet)}`,
          bust: `21'i geçtin! -${amount(bet)}`,
        }[outcome];
        const color = { blackjack: 0xf1c40f, win: 0x2ecc71, push: 0x95a5a6, lose: 0xe74c3c, bust: 0xe74c3c }[outcome];
        return { embeds: [view({ text: `${text} • Bakiye: ${amount(balance)}`, color }, true)], components: [] };
      };

      const dealerPlay = () => settleDealer(deck, dealer, player);

      // Açılışta blackjack
      if (isBlackjack(player) || isBlackjack(dealer)) {
        const outcome = isBlackjack(player) && isBlackjack(dealer) ? 'push' : isBlackjack(player) ? 'blackjack' : 'lose';
        return await interaction.reply(await finish(outcome));
      }

      await interaction.reply({ embeds: [view(null, false)], components: [buttons(getBalance(guild.id, user.id) >= bet)] });
      const message = await interaction.fetchReply();

      const outcome = await new Promise((resolve) => {
        const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, idle: 90_000 });
        collector.on('collect', async (i) => {
          if (i.user.id !== user.id) return i.reply({ content: 'Bu senin oyunun değil. Kendi oyununu `/blackjack` ile başlat.', flags: MessageFlags.Ephemeral }).catch(() => {});
          const action = i.customId.split(':')[1];
          if (action === 'double') {
            try {
              takeMoney(guild.id, user.id, bet);
            } catch {
              return i.reply({ content: 'İkiye katlamaya bakiyen yetmiyor.', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
            bet *= 2;
            player.push(deck.pop());
            collector.stop();
            resolve({ i, result: total(player) > 21 ? 'bust' : dealerPlay() });
            return;
          }
          if (action === 'hit') {
            player.push(deck.pop());
            if (total(player) > 21) {
              collector.stop();
              return resolve({ i, result: 'bust' });
            }
            if (total(player) === 21) {
              collector.stop();
              return resolve({ i, result: dealerPlay() });
            }
            return i.update({ embeds: [view(null, false)], components: [buttons(false)] }).catch(() => {});
          }
          collector.stop();
          resolve({ i, result: dealerPlay() });
        });
        // Süre dolarsa otomatik "dur"
        collector.on('end', (_, reason) => {
          if (reason === 'idle') resolve({ i: null, result: dealerPlay() });
        });
      });

      const payload = await finish(outcome.result);
      if (outcome.i) await outcome.i.update(payload).catch(() => message.edit(payload));
      else await message.edit(payload).catch(() => {});
    } finally {
      unlock();
    }
  },
};
