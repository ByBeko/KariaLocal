import { Events, EmbedBuilder } from 'discord.js';
import { sendLog } from '../utils/logger.js';
import { trackInviteCreate } from '../systems/invites.js';
import { formatDuration } from '../utils/time.js';

export default {
  name: Events.InviteCreate,
  async execute(invite) {
    if (!invite.guild) return;
    trackInviteCreate(invite);
    const guild = invite.client.guilds.cache.get(invite.guild.id);
    if (!guild) return;
    const by = invite.inviter;
    await sendLog(guild, 'log_invite', {
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ecc71)
          .setAuthor({ name: `${by?.tag ?? 'Biri'} davet oluşturdu`, iconURL: by?.displayAvatarURL() })
          .setDescription(
            `**Davet:** \`${invite.code}\`\n` +
              `**Oluşturan:** ${by ?? 'bilinmiyor'}\n` +
              `**Kanal:** ${invite.channel ?? 'bilinmiyor'}\n` +
              `**Süre:** ${invite.maxAge ? formatDuration(invite.maxAge * 1000) : 'süresiz'} • ` +
              `**Kullanım sınırı:** ${invite.maxUses || 'sınırsız'}` +
              (invite.temporary ? '\n**Geçici üyelik** (çıkınca atılır)' : ''),
          )
          .setTimestamp(),
      ],
    });
  },
};
