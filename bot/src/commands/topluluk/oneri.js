import { SlashCommandBuilder } from 'discord.js';
import { getSetting } from '../../core/settings.js';
import { brandEmbed, replyError, replySuccess } from '../../utils/embeds.js';
import { e } from '../../utils/emojis.js';

const cooldowns = new Map();
const COOLDOWN = 5 * 60_000;

export default {
  data: new SlashCommandBuilder()
    .setName('oneri')
    .setDescription('Sunucu, Minecraft, bot veya website için öneri gönder.')
    .addStringOption((o) => o.setName('oneri').setDescription('Önerin').setRequired(true).setMinLength(10).setMaxLength(1500)),

  async execute(interaction) {
    const channelId = getSetting(interaction.guild.id, 'suggestion_channel');
    const channel = channelId && interaction.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return replyError(interaction, 'Öneri kanalı henüz ayarlanmamış.');

    const last = cooldowns.get(interaction.user.id) ?? 0;
    if (Date.now() - last < COOLDOWN) {
      return replyError(interaction, `Yeni öneri için <t:${Math.floor((last + COOLDOWN) / 1000)}:R> tekrar deneyebilirsin.`);
    }
    cooldowns.set(interaction.user.id, Date.now());

    const embed = brandEmbed()
      .setAuthor({ name: `${interaction.member.displayName} önerdi`, iconURL: interaction.user.displayAvatarURL() })
      .setDescription(interaction.options.getString('oneri', true))
      .setFooter({ text: 'Aşağıdaki tepkilerle oy ver • Tartışmak için başlığa yaz' })
      .setTimestamp();

    const message = await channel.send({ embeds: [embed] });
    // Karia emojisiyle tepki; olmazsa normal emoji
    await message.react(e('begeni', '👍')).catch(() => message.react('👍'));
    await message.react(e('begenmeme', '👎')).catch(() => message.react('👎'));
    await message.startThread({ name: `Öneri • ${interaction.member.displayName}`.slice(0, 100) }).catch(() => {});

    await replySuccess(interaction, `Önerin gönderildi: ${message.url}`);
  },
};
