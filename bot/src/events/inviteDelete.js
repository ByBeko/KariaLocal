import { e } from '../utils/emojis.js';
import { Events, EmbedBuilder } from 'discord.js';
import { sendLog } from '../utils/logger.js';
import { getCachedInvite } from '../systems/invites.js';

export default {
  name: Events.InviteDelete,
  async execute(invite) {
    if (!invite.guild) return;
    const guild = invite.client.guilds.cache.get(invite.guild.id);
    if (!guild) return;
    const cached = getCachedInvite(guild.id, invite.code);
    // Kullanım sınırı dolduğu için silinen davetler log'u kirletmesin
    if (cached?.maxUses && cached.uses + 1 >= cached.maxUses) return;
    await sendLog(guild, 'log_invite', {
      embeds: [
        new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle(`${e('cop', '🗑️')} Davet silindi / süresi doldu`)
          .setDescription(
            `**Davet:** \`${invite.code}\`\n**Kanal:** ${invite.channel ?? 'bilinmiyor'}` +
              (cached ? `\n**Oluşturan:** ${cached.inviterId ? `<@${cached.inviterId}>` : 'bilinmiyor'} • **Kullanım:** ${cached.uses}` : ''),
          )
          .setTimestamp(),
      ],
    });
  },
};
