import { e } from '../../utils/emojis.js';
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { kariaEmbed } from '../../utils/embeds.js';
import { UserError } from '../../utils/errors.js';
import { addKeyword, setupLinks, setupProfanity, setupSpam } from '../../systems/automod.js';

export default {
  level: Level.ADMIN,
  aliases: ['otomod'],
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Discord AutoMod filtrelerini kurar.')
    .addSubcommand((s) => s.setName('kur-kufur').setDescription('Türkçe küfür listesini ve Discord küfür filtresini açar.'))
    .addSubcommand((s) => s.setName('kur-spam').setDescription('Şüpheli spam mesajlarını engeller.'))
    .addSubcommand((s) => s.setName('link-engelle').setDescription('Reklam ve başka sunucuların davet linklerini engeller.'))
    .addSubcommand((s) =>
      s.setName('kelime-ekle').setDescription('Yasaklı kelime ekler.')
        .addStringOption((o) => o.setName('kelime').setDescription('Yasaklanacak kelime').setRequired(true).setMaxLength(60)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild } = interaction;
    if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      throw new UserError('AutoMod kuralı açabilmem için **Sunucuyu Yönet** iznine ihtiyacım var.');
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sub = interaction.options.getSubcommand();
    let text;
    try {
      if (sub === 'kur-kufur') {
        await setupProfanity(guild);
        text = '**Küfür koruması açıldı.** Türkçe küfür listesi ve Discord filtresi çalışıyor.';
      } else if (sub === 'kur-spam') {
        await setupSpam(guild);
        text = '**Spam koruması açıldı.**';
      } else if (sub === 'link-engelle') {
        await setupLinks(guild);
        text = '**Link ve reklam koruması açıldı.** Sunucunun kendi özel adresi engellenmez.';
      } else {
        const word = interaction.options.getString('kelime').trim().toLocaleLowerCase('tr');
        if (!word) throw new UserError('Geçerli bir kelime yaz.');
        text = await addKeyword(guild, word) ? `**"${word}"** yasaklı kelimelere eklendi.` : `**"${word}"** zaten yasaklı kelimelerde.`;
      }
    } catch (error) {
      if (error instanceof UserError) throw error;
      console.error('[AutoMod]', error);
      throw new UserError(`AutoMod kuralı kurulamadı: ${error.message}`);
    }
    await interaction.editReply({ embeds: [kariaEmbed(null, 'Otomatik Moderasyon').setDescription(`${e('onayli', '✅')} ${text}`)] });
  },
};
