import { MessageFlags } from 'discord.js';
import { homeView, commandPage, staffView, isStaffCommand } from '../systems/help.js';
import { checkAccess, isStaff } from '../utils/permissions.js';

export default {
  prefix: 'yardim',
  async execute(interaction, [action, ownerId]) {
    const { member, client, user } = interaction;

    if (action === 'yetkili') {
      if (!isStaff(member)) {
        return interaction.reply({ content: 'Bu panel sadece yetkililer için.', flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ ...staffView(member, client), flags: MessageFlags.Ephemeral });
    }

    // Başkasının menüsüne dokunan kendi menüsünü (gizli) alır; gizli menüde yetkili butonu da olabilir
    if (user.id !== ownerId) {
      return interaction.reply({ ...homeView(member, client, user.id, { staffButton: true }), flags: MessageFlags.Ephemeral });
    }

    // Herkese açık menüde yetkili butonu gösterilmez
    const options = { staffButton: interaction.message.flags.has(MessageFlags.Ephemeral) };

    if (action === 'komut') {
      const command = client.commands.get(interaction.values[0]);
      if (command && !isStaffCommand(command) && !checkAccess(member, command)) {
        return interaction.update(commandPage(member, client, user.id, command, options));
      }
    }

    // "ana" ve eski mesajlardaki "detay" / "kategori" seçimleri ana sayfaya döner
    await interaction.update(homeView(member, client, user.id, options));
  },
};
