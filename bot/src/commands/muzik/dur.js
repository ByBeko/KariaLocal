import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { stopMusic } from '../../systems/music.js';
import { replySuccess } from '../../utils/embeds.js';

export default {
  aliases: ['stop', 'leave', 'ayril', 'ayrıl', 'dc', 'cik', 'çık'],
  data: new SlashCommandBuilder().setName('dur').setDescription('Müziği durdurur, sırayı temizler ve kanaldan çıkar.').setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    stopMusic(interaction.member);
    await replySuccess(interaction, 'Müzik durduruldu, kanaldan çıktım.');
  },
};
