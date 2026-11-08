import { e } from '../../utils/emojis.js';
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { brandEmbed, replySuccess } from '../../utils/embeds.js';
import { UserError } from '../../utils/errors.js';
import { getAutoResponses, setAutoResponse, deleteAutoResponse } from '../../systems/autoresponse.js';

export default {
  level: Level.ADMIN,
  aliases: ['otocevap', 'oc'],
  data: new SlashCommandBuilder()
    .setName('oto-cevap')
    .setDescription('Belirli mesajlara botun otomatik cevap vermesi.')
    .addSubcommand((s) =>
      s
        .setName('ekle')
        .setDescription('Oto cevap ekler ya da günceller')
        .addStringOption((o) => o.setName('tetik').setDescription('Örn. "sa" ya da "ip ne"').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('cevap').setDescription('Cevap. Değişkenler: {user} {server} {count} {ip} {site}').setRequired(true).setMaxLength(1500))
        .addBooleanOption((o) => o.setName('tam_eslesme').setDescription('Sadece mesaj tam olarak buysa (varsayılan: mesajın herhangi bir yerinde geçerse)')),
    )
    .addSubcommand((s) =>
      s
        .setName('sil')
        .setDescription('Oto cevabı siler')
        .addStringOption((o) => o.setName('tetik').setDescription('Silinecek tetik').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('liste').setDescription('Tüm oto cevaplar'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild } = interaction;
    const sub = interaction.options.getSubcommand();

    if (sub === 'liste') {
      const lines = getAutoResponses(guild.id).map(
        (r) => `• \`${r.trigger}\`${r.exact ? ' (tam)' : ''} → ${r.response.replaceAll('\n', ' ').slice(0, 80)}`,
      );
      return interaction.reply({
        embeds: [
          brandEmbed()
            .setTitle(`${e('mesaj', '💬')} Oto cevaplar`)
            .setDescription(lines.join('\n').slice(0, 4000) || `Henüz oto cevap yok. Örnek: \`/oto-cevap ekle tetik:sa cevap:Aleyküm selam {user}! ${e('mesaj', '👋')}\``),
        ],
        allowedMentions: { parse: [] },
      });
    }

    const trigger = interaction.options.getString('tetik', true);
    if (sub === 'sil') {
      if (!deleteAutoResponse(guild.id, trigger)) throw new UserError('Böyle bir oto cevap yok. `/oto-cevap liste` ile bak.');
      return replySuccess(interaction, `\`${trigger}\` oto cevabı silindi.`);
    }

    if (trigger.trim().length < 2) throw new UserError('Tetik en az 2 karakter olmalı.');
    const response = interaction.options.getString('cevap', true).replaceAll('\\n', '\n');
    const exact = interaction.options.getBoolean('tam_eslesme') ?? false;
    setAutoResponse(guild.id, trigger, response, exact);
    await replySuccess(interaction, `Oto cevap kaydedildi: \`${trigger}\`${exact ? ' (tam eşleşme)' : ''} → ${response.slice(0, 200)}`);
  },
};
