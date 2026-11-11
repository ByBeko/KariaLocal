import { Events, EmbedBuilder } from 'discord.js';
import { getSetting } from '../core/settings.js';
import { sendLog } from '../utils/logger.js';
import { brandEmbed } from '../utils/embeds.js';
import { e } from '../utils/emojis.js';
import { grantRoleCoins } from '../systems/coinRewards.js';

export default {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    const { guild, user } = newMember;
    if (oldMember.partial) return; // eski hali bilinmiyorsa karşılaştırma yapılamaz
    await grantRoleCoins(oldMember, newMember).catch((error) => console.error('[Coin ödülü]', error.message));

    // Takviye (boost)
    if (!oldMember.premiumSince && newMember.premiumSince) {
      const channelId = getSetting(guild.id, 'boost_channel');
      const channel = channelId && guild.channels.cache.get(channelId);
      if (channel?.isTextBased()) {
        const embed = brandEmbed()
          .setColor(0xf47fff)
          .setTitle(`${e('roket', '🚀')} Yeni takviye!`)
          .setDescription(`${user} sunucuya takviye bastı, çok teşekkürler! ${e('kalp2', '💜')}\nŞu an **${guild.premiumSubscriptionCount}** takviyemiz var.`)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .setTimestamp();
        await channel.send({ content: `${user}`, embeds: [embed] }).catch(() => {});
      }
    }

    // Rol ve takma ad değişimleri "kim yaptı" bilgisiyle denetim kaydından loglanır (systems/auditlog.js)
    if (oldMember.premiumSince && !newMember.premiumSince) {
      await sendLog(guild, 'log_member', {
        embeds: [
          new EmbedBuilder()
            .setColor(0x99aab5)
            .setAuthor({ name: `${user.tag} takviyeyi geri çekti`, iconURL: user.displayAvatarURL() })
            .setDescription(`${user} • Kalan takviye: **${guild.premiumSubscriptionCount}**`)
            .setTimestamp(),
        ],
      });
    }
  },
};
