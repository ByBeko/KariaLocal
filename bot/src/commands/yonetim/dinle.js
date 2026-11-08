import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import config from '../../config.js';
import { Level } from '../../utils/permissions.js';
import { replySuccess } from '../../utils/embeds.js';
import { UserError } from '../../utils/errors.js';
import { startListening, stopListening } from '../../systems/voiceAssistant.js';

export default {
  level: Level.ADMIN,
  data: new SlashCommandBuilder()
    .setName('dinle')
    .setDescription('Sesli asistanı açar ya da kapatır. Sadece bot sahibini dinler.')
    .addStringOption((o) => o.setName('durum').setDescription('Aç mı kapat mı?').setRequired(true).addChoices({ name: 'Aç', value: 'ac' }, { name: 'Kapat', value: 'kapat' }))
    .addStringOption((o) =>
      o.setName('mod').setDescription('Ne zaman cevap versin?').addChoices({ name: 'Her konuşmamda', value: 'hepsi' }, { name: 'Sadece "Karia" deyince', value: 'karia' }),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (interaction.user.id !== config.owner.id) throw new UserError('Sesli asistan sadece bot sahibini dinler.');
    if (interaction.options.getString('durum', true) === 'kapat') {
      stopListening(interaction.guild);
      return replySuccess(interaction, 'Sesli asistan kapatıldı.');
    }
    await interaction.deferReply();
    const wakeOnly = interaction.options.getString('mod') === 'karia';
    const channel = await startListening(interaction.member, { wakeOnly });
    await replySuccess(interaction, `${channel} kanalında seni dinliyorum. ${wakeOnly ? 'Cümleye "Karia" diye başla.' : 'Konuş, cevap vereyim.'}`, false);
  },
};
