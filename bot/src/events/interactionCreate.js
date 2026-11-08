import { Events } from 'discord.js';
import { runCommand, handleError } from '../core/runner.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const { client } = interaction;

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (command) await runCommand(interaction, command, `/${interaction.commandName}`);
      return;
    }

    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      const [prefix, ...args] = interaction.customId.split(':');
      const component = client.components.get(prefix);
      if (!component) return; // komutların kendi collector'larıyla dinlediği butonlar
      try {
        await component.execute(interaction, args);
      } catch (error) {
        await handleError(interaction, error, `Bileşen ${interaction.customId}`);
      }
    }
  },
};
