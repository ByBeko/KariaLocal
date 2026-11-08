import { Events, EmbedBuilder } from 'discord.js';
import { sendLog } from '../utils/logger.js';

// Kullanıcı adı / görünen ad değişimi (sunucu takma adı değişimi auditlog.js'te)
export default {
  name: Events.UserUpdate,
  async execute(oldUser, newUser) {
    if (oldUser.partial || newUser.bot) return;
    const changes = [];
    if (oldUser.username !== newUser.username) changes.push(`**Kullanıcı adı:** \`${oldUser.username}\` → \`${newUser.username}\``);
    if (oldUser.globalName !== newUser.globalName) {
      changes.push(`**Görünen ad:** \`${oldUser.globalName ?? 'yok'}\` → \`${newUser.globalName ?? 'yok'}\``);
    }
    if (!changes.length) return;

    for (const guild of newUser.client.guilds.cache.values()) {
      if (!guild.members.cache.has(newUser.id)) continue;
      await sendLog(guild, 'log_nick', {
        embeds: [
          new EmbedBuilder()
            .setColor(0x3498db)
            .setAuthor({ name: `${newUser.tag} adını değiştirdi`, iconURL: newUser.displayAvatarURL() })
            .setDescription(`${newUser} • \`${newUser.id}\`\n${changes.join('\n')}`)
            .setTimestamp(),
        ],
      });
    }
  },
};
