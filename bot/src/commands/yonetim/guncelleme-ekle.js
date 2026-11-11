import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { replySuccess } from '../../utils/embeds.js';
import { addUpdateNote, nextUpdateAt, UPDATE_AREAS } from '../../systems/updates.js';

export default {
  level: Level.ADMIN,
  aliases: ['guncelleme'],
  data: new SlashCommandBuilder()
    .setName('guncelleme-ekle')
    .setDescription('Sıradaki haftalık güncelleme yazısına madde ekler.')
    .addStringOption((o) => o.setName('madde').setDescription('Yazıya eklenecek madde').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('alan').setDescription('Hangi forumda paylaşılsın (boşsa Karia Local)').addChoices(...UPDATE_AREAS))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild } = interaction;
    const count = addUpdateNote(guild.id, interaction.options.getString('madde', true), interaction.options.getString('alan') ?? 'bot');
    await replySuccess(interaction, `Madde eklendi. Bekleyen **${count}** madde <t:${Math.floor(nextUpdateAt(guild.id) / 1000)}:F> yazısında paylaşılacak.`);
  },
};
