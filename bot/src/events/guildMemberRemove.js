import { Events, EmbedBuilder } from 'discord.js';
import { sendLog } from '../utils/logger.js';
import { relativeTime, formatDuration } from '../utils/time.js';
import { recordMemberEvent } from '../systems/stats.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(member) {
    if (!member.user.bot) recordMemberEvent(member.guild.id, member.id, 'leave');
    const roles = member.roles?.cache
      .filter((r) => r.id !== member.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => `${r}`)
      .join(' ');
    const stayed = member.joinedTimestamp ? Date.now() - member.joinedTimestamp : null;

    await sendLog(member.guild, 'log_member', {
      embeds: [
        new EmbedBuilder()
          .setColor(0xe74c3c)
          .setAuthor({ name: `${member.user.tag} ayrıldı`, iconURL: member.user.displayAvatarURL() })
          .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
          .setDescription(
            `${member.user} • \`${member.id}\`\n` +
              (member.joinedTimestamp ? `**Katılma:** ${relativeTime(member.joinedTimestamp)}\n` : '') +
              (stayed !== null ? `**Sunucuda kaldı:** ${stayed < 60_000 ? '1 dakikadan az' : formatDuration(stayed)}\n` : '') +
              `**Roller:** ${roles?.slice(0, 900) || 'yok'}\n` +
              `**Üye sayısı:** ${member.guild.memberCount}`,
          )
          .setFooter({ text: 'Atıldıysa/banlandıysa ceza-log ve ban-log kanalına bak' })
          .setTimestamp(),
      ],
    });
  },
};
