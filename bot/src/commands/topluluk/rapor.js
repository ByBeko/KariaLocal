import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { getSetting } from '../../core/settings.js';
import { replySuccess } from '../../utils/embeds.js';
import { e } from '../../utils/emojis.js';
import { UserError } from '../../utils/errors.js';
import { sendLog } from '../../utils/logger.js';
import { ruleText, fit } from '../../utils/style.js';
import { addReport } from '../../systems/reports.js';

const COOLDOWN = 5 * 60_000;
const cooldowns = new Map();

export default {
  data: new SlashCommandBuilder()
    .setName('rapor')
    .setDescription('Kuralları ihlal eden bir üyeyi yetkililere gizlice bildirir.')
    .addUserOption((o) => o.setName('kullanici').setDescription('Bildirmek istediğin üye').setRequired(true))
    .addStringOption((o) => o.setName('sebep').setDescription('Ne oldu?').setRequired(true).setMinLength(5).setMaxLength(500))
    .addStringOption((o) => o.setName('mesaj').setDescription('İlgili mesajın linki (isteğe bağlı)'))
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (interaction.isPrefix) throw new UserError('Rapor gizli kalsın diye bu komut sadece `/rapor` ile kullanılabilir.');
    const { guild, user, channel } = interaction;
    const target = interaction.options.getUser('kullanici', true);
    if (target.bot || target.id === user.id) throw new UserError('Kendini ya da bir botu raporlayamazsın.');

    const link = interaction.options.getString('mesaj');
    if (link && !link.includes(`/channels/${guild.id}/`)) throw new UserError('Mesaj linki bu sunucudan olmalı.');

    const key = getSetting(guild.id, 'report_channel') ? 'report_channel' : 'log_mod';
    if (!guild.channels.cache.has(getSetting(guild.id, key))) throw new UserError('Rapor kanalı ayarlı değil. Yetkililere haber ver.');

    const last = cooldowns.get(user.id) ?? 0;
    if (Date.now() - last < COOLDOWN) throw new UserError(`Yeni rapor için <t:${Math.floor((last + COOLDOWN) / 1000)}:R> tekrar deneyebilirsin.`);
    cooldowns.set(user.id, Date.now());

    const details = [`**Raporlanan:** ${target} • \`${target.id}\``, `**Bildiren:** ${user}`, `**Kanal:** ${channel}`];
    if (link) details.push(`**Mesaj:** ${link}`);
    const report = ruleText({
      icon: e('bayrak', '🚩'),
      title: 'Üye Raporu',
      sections: [
        { icon: e('kullanici', '👤'), title: 'Bilgiler', body: details.join('\n') },
        { icon: e('unlem', '⚠️'), title: 'Sebep', body: interaction.options.getString('sebep', true) },
      ],
    });
    const staffRole = getSetting(guild.id, 'staff_role');
    await sendLog(guild, key, {
      content: fit(`${staffRole ? `<@&${staffRole}>\n` : ''}${report}`),
      allowedMentions: { roles: staffRole ? [staffRole] : [] },
    });
    addReport(guild.id, { reporterId: user.id, targetId: target.id, reason: interaction.options.getString('sebep', true), link, channelId: channel.id });
    await replySuccess(interaction, 'Raporun yetkililere iletildi. Teşekkürler.');
  },
};
