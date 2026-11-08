import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { replySuccess } from '../../utils/embeds.js';
import { UserError } from '../../utils/errors.js';
import { parseDuration } from '../../utils/time.js';
import { createPoll } from '../../systems/polls.js';

const MAX_DURATION = 30 * 86_400_000;
const DEFAULT_DURATION = 86_400_000;

export default {
  level: Level.STAFF,
  aliases: ['oylama', 'poll'],
  data: new SlashCommandBuilder()
    .setName('anket')
    .setDescription('Butonlu, süreli anket açar.')
    .addStringOption((o) => o.setName('soru').setDescription('Anket sorusu').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('secenekler').setDescription('2-5 seçenek, virgülle ayır (örn. Evet, Hayır)').setRequired(true).setMaxLength(500))
    .addStringOption((o) => o.setName('sure').setDescription('Ne kadar sürsün? (30dk, 2sa, 3g; boşsa 1 gün)'))
    .addChannelOption((o) => o.setName('kanal').setDescription('Hangi kanalda? (boşsa burada)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const options = [...new Set(interaction.options.getString('secenekler', true).split(/[,|]/).map((o) => o.trim()).filter(Boolean))];
    if (options.length < 2 || options.length > 5) throw new UserError('En az 2, en fazla 5 farklı seçenek yazmalısın. Seçenekleri virgülle ayır.');
    if (options.some((o) => o.length > 75)) throw new UserError('Her seçenek en fazla 75 karakter olabilir.');

    const durationText = interaction.options.getString('sure');
    const duration = durationText ? parseDuration(durationText) : DEFAULT_DURATION;
    if (!duration || duration > MAX_DURATION) throw new UserError('Geçerli bir süre yaz (örn. 30dk, 2sa, 3g). En fazla 30 gün.');

    const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
    const message = await createPoll({ channel, hostId: interaction.user.id, question: interaction.options.getString('soru', true), options, duration });
    await replySuccess(interaction, `Anket açıldı: ${message.url}`);
  },
};
