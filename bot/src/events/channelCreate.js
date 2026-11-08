import { Events } from 'discord.js';
import { getSetting } from '../core/settings.js';
import { isTempChannel } from '../systems/tempvoice.js';

// Yeni açılan kanallarda jail rolü de gizlensin
export default {
  name: Events.ChannelCreate,
  async execute(channel) {
    if (!channel.guild) return;
    const jailRole = getSetting(channel.guild.id, 'jail_role');
    if (!jailRole || channel.id === getSetting(channel.guild.id, 'jail_channel')) return;
    if (isTempChannel(channel.id)) return;
    await channel.permissionOverwrites
      .edit(jailRole, { ViewChannel: false }, { reason: 'Jail rolü yeni kanalı göremez' })
      .catch(() => {});
  },
};
