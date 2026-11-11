import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, MessageFlags } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { replySuccess, kariaEmbed } from '../../utils/embeds.js';
import { UserError } from '../../utils/errors.js';
import { parseDuration, formatDuration } from '../../utils/time.js';
import { createGiveaway, endNow, rerollGiveaway, activeGiveaways, getGiveaway, latestGiveaway } from '../../systems/giveaway.js';
import { e } from '../../utils/emojis.js';

const MAX_DURATION = 30 * 86_400_000;

/** mesaj ID'si ya da mesaj linki → çekiliş kaydı (boşsa en son çekiliş) */
function resolve(guildId, input, ended) {
  if (!input) {
    const g = latestGiveaway(guildId, ended);
    if (!g) throw new UserError(ended ? 'Bitmiş çekiliş yok.' : 'Devam eden çekiliş yok.');
    return g;
  }
  const id = input.match(/(\d{17,20})\/?$/)?.[1];
  const g = id && getGiveaway(id);
  if (!g || g.guild_id !== guildId) throw new UserError('Çekiliş bulunamadı. Çekiliş mesajının ID\'sini ya da linkini yaz.');
  return g;
}

export default {
  level: Level.STAFF,
  aliases: ['çekiliş', 'giveaway', 'gw'],
  data: new SlashCommandBuilder()
    .setName('cekilis')
    .setDescription('Çekiliş başlat, bitir, yeniden çek, listele.')
    .addSubcommand((s) =>
      s
        .setName('baslat')
        .setDescription('Yeni çekiliş başlatır')
        .addStringOption((o) => o.setName('sure').setDescription('Ne kadar sürsün? (30dk, 2sa, 3g)').setRequired(true))
        .addIntegerOption((o) => o.setName('kazanan').setDescription('Kaç kazanan?').setMinValue(1).setMaxValue(20).setRequired(true))
        .addStringOption((o) => o.setName('odul').setDescription('Ödül (örn. Discord Nitro)').setRequired(true).setMaxLength(200))
        .addChannelOption((o) => o.setName('kanal').setDescription('Hangi kanalda? (boşsa burada)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption((o) => o.setName('rol_sarti').setDescription('Sadece bu role sahip olanlar katılabilir')),
    )
    .addSubcommand((s) =>
      s
        .setName('bitir')
        .setDescription('Çekilişi hemen bitirir')
        .addStringOption((o) => o.setName('mesaj').setDescription('Çekiliş mesaj ID/linki (boşsa en yakın biten)')),
    )
    .addSubcommand((s) =>
      s
        .setName('yeniden')
        .setDescription('Bitmiş çekilişte yeni kazanan çeker')
        .addStringOption((o) => o.setName('mesaj').setDescription('Çekiliş mesaj ID/linki (boşsa son biten)'))
        .addIntegerOption((o) => o.setName('kazanan').setDescription('Kaç kişi? (varsayılan 1)').setMinValue(1).setMaxValue(20)),
    )
    .addSubcommand((s) => s.setName('liste').setDescription('Devam eden çekilişler'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild, client } = interaction;
    const sub = interaction.options.getSubcommand();

    if (sub === 'baslat') {
      const duration = parseDuration(interaction.options.getString('sure', true));
      if (!duration || duration < 60_000 || duration > MAX_DURATION) throw new UserError('Süre 1 dakika ile 30 gün arasında olmalı. Örnek: `30dk`, `2sa`, `3g`');
      const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
      const perms = channel.permissionsFor(guild.members.me);
      if (!perms?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) throw new UserError(`${channel} kanalına mesaj gönderemiyorum.`);
      const message = await createGiveaway({
        channel,
        hostId: interaction.user.id,
        prize: interaction.options.getString('odul', true),
        winners: interaction.options.getInteger('kazanan', true),
        duration,
        roleId: interaction.options.getRole('rol_sarti')?.id ?? null,
      });
      return replySuccess(interaction, `Çekiliş başladı: [mesaja git](${message.url}) • ${formatDuration(duration)} sürecek.`);
    }

    if (sub === 'liste') {
      const list = activeGiveaways(guild.id).map(
        (g) => `${e('hediye', '🎉')} **${g.prize}** • <t:${Math.floor(g.ends_at / 1000)}:R> • ${JSON.parse(g.entrants).length} katılımcı • [mesaj](https://discord.com/channels/${g.guild_id}/${g.channel_id}/${g.message_id})`,
      );
      return interaction.reply({
        embeds: [kariaEmbed(interaction.client, 'Çekilişler').setTitle(`${list.length} devam eden çekiliş`).setDescription(list.join('\n') || 'Şu an çekiliş yok.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'bitir') {
      const g = resolve(guild.id, interaction.options.getString('mesaj'), false);
      if (g.ended) throw new UserError('Bu çekiliş zaten bitmiş. Yeni kazanan için `/cekilis yeniden`.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const winners = await endNow(client, g.message_id);
      return replySuccess(interaction, `**${g.prize}** bitirildi. Kazanan: ${winners?.map((id) => `<@${id}>`).join(', ') || 'yok'}`);
    }

    // yeniden
    const g = resolve(guild.id, interaction.options.getString('mesaj'), true);
    if (!g.ended) throw new UserError('Bu çekiliş henüz bitmedi. Önce `/cekilis bitir`.');
    const winners = await rerollGiveaway(client, g.message_id, interaction.options.getInteger('kazanan') ?? 1);
    if (!winners?.length) throw new UserError('Çekecek başka katılımcı kalmadı.');
    await replySuccess(interaction, `Yeni kazanan: ${winners.map((id) => `<@${id}>`).join(', ')}`);
  },
};
