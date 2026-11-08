import { MessageFlags } from 'discord.js';
import { getQueue, requireVoice, voteSkip, stopMusic, LOOP_NAMES } from '../systems/music.js';
import { UserError } from '../utils/errors.js';
import { e } from '../utils/emojis.js';

const ephemeral = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

// "Şimdi çalıyor" panelindeki butonlar
export default {
  prefix: 'muzik',
  async execute(interaction, [action]) {
    const queue = getQueue(interaction.guild.id);
    if (!queue?.current || queue.panel?.id !== interaction.message.id) {
      return interaction.update({ components: [] }).catch(() => ephemeral(interaction, 'Bu panel artık geçerli değil.'));
    }
    try {
      requireVoice(interaction.member);
      if (action === 'duraklat') {
        queue.togglePause();
        return interaction.update({ embeds: [queue.nowPlayingEmbed()], components: queue.controls() });
      }
      if (action === 'gec') {
        const r = voteSkip(interaction.member);
        return r.skipped ? interaction.deferUpdate() : ephemeral(interaction, `${e('begeni', '🗳️')} Geçme oyu: **${r.votes}/${r.needed}**`);
      }
      if (action === 'dur') {
        stopMusic(interaction.member);
        return interaction.deferUpdate().catch(() => {});
      }
      if (action === 'dongu') {
        queue.cycleLoop();
        await interaction.update({ embeds: [queue.nowPlayingEmbed()], components: queue.controls() });
        return interaction.followUp({ content: `Döngü: **${LOOP_NAMES[queue.loop]}**`, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      if (action === 'karistir') {
        if (queue.tracks.length < 2) return ephemeral(interaction, 'Karıştırmak için sırada en az 2 şarkı olmalı.');
        queue.shuffle();
        await interaction.update({ embeds: [queue.nowPlayingEmbed()], components: queue.controls() });
        return interaction.followUp({ content: `${e('karistir', '🔀')} ${interaction.user} sırayı karıştırdı.`, allowedMentions: { parse: [] } }).catch(() => {});
      }
    } catch (error) {
      if (error instanceof UserError) return ephemeral(interaction, error.message);
      throw error;
    }
  },
};
