import { e } from '../../utils/emojis.js';
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { addMoney, setMoney, getBalance, fmt } from '../../systems/economy.js';
import { replySuccess } from '../../utils/embeds.js';
import { sendLog } from '../../utils/logger.js';

const userOpt = (o) => o.setName('kullanici').setDescription('Üye').setRequired(true);
const amountOpt = (o) => o.setName('miktar').setDescription('Miktar').setMinValue(0).setMaxValue(100_000_000).setRequired(true);

export default {
  level: Level.ADMIN,
  data: new SlashCommandBuilder()
    .setName('ekonomi-ayar')
    .setDescription('Üyelerin coin bakiyesini yönet.')
    .addSubcommand((s) => s.setName('ver').setDescription('Coin ekler').addUserOption(userOpt).addIntegerOption(amountOpt))
    .addSubcommand((s) => s.setName('al').setDescription('Coin düşer').addUserOption(userOpt).addIntegerOption(amountOpt))
    .addSubcommand((s) => s.setName('ayarla').setDescription('Bakiyeyi belirli bir değere ayarlar').addUserOption(userOpt).addIntegerOption(amountOpt))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild } = interaction;
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('kullanici', true);
    const amount = interaction.options.getInteger('miktar', true);
    const before = getBalance(guild.id, user.id);

    if (sub === 'ver') addMoney(guild.id, user.id, amount);
    else if (sub === 'al') setMoney(guild.id, user.id, before - amount);
    else setMoney(guild.id, user.id, amount);
    const after = getBalance(guild.id, user.id);

    await sendLog(guild, 'log_staff', {
      content: `${e('coin', '🪙')} ${interaction.user} → ${user} bakiyesi: ${before.toLocaleString('tr-TR')} → ${after.toLocaleString('tr-TR')} (\`/ekonomi-ayar ${sub}\`)`,
    });
    await replySuccess(interaction, `${user} bakiyesi: ${fmt(before)} → ${fmt(after)}`);
  },
};
