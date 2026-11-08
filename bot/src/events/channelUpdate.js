import { Events } from 'discord.js';
import { scheduleServerCheck } from '../systems/serverCheck.js';
import { isTempChannel } from '../systems/tempvoice.js';

export default {
  name: Events.ChannelUpdate,
  async execute(_old, channel) {
    if (channel.guild?.id !== process.env.GUILD_ID || isTempChannel(channel.id)) return;
    scheduleServerCheck(channel.guild);
  },
};
