import { e } from '../../utils/emojis.js';
import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ActivityType, MessageFlags } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { getSetting } from '../../core/settings.js';
import { kariaEmbed } from '../../utils/embeds.js';
import { UserError } from '../../utils/errors.js';
import { PROFANITY_ROOTS as ROOTS, PROFANITY_WORDS as BASE_PROFANITY } from '../../utils/profanity.js';

const INVITE_RE = /(?:discord\.(?:gg|io|me|li)|discord(?:app)?\.com\/invite)\/[\w-]+|\.gg\/[\w-]+/i;
const URL_RE = /https?:\/\/\S+|\b[\w-]+\.(?:com|net|org|xyz|gg|tk|me|io|tr|shop|store)\b/i;
const tokens = (text) => text.toLocaleLowerCase('tr').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export default {
  level: Level.STAFF,
  aliases: ['durum-tara', 'statustara'],
  data: new SlashCommandBuilder()
    .setName('durumtara')
    .setDescription('Özel durumunda küfür, reklam ya da aradığın metin geçen üyeleri listeler.')
    .addStringOption((o) =>
      o
        .setName('tur')
        .setDescription('Neye bakılsın? (varsayılan: hepsi)')
        .addChoices({ name: 'Hepsi (küfür + reklam)', value: 'hepsi' }, { name: 'Küfür', value: 'kufur' }, { name: 'Reklam / link', value: 'reklam' }),
    )
    .addStringOption((o) => o.setName('metin').setDescription('Bu metni içerenleri de bul (örn. sunucu adı)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild, client } = interaction;
    if (!client.presenceEnabled) {
      throw new UserError(
        'Özel durumları görebilmem için **Presence Intent** kapalı.\nDeveloper Portal → uygulaman → **Bot** → *Privileged Gateway Intents* → **Presence Intent**i aç, sonra botu yeniden başlat.',
      );
    }
    const type = interaction.options.getString('tur') ?? 'hepsi';
    const search = interaction.options.getString('metin')?.toLocaleLowerCase('tr').trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await guild.members.fetch({ withPresences: true }).catch(() => guild.members.fetch());

    const custom = getSetting(guild.id, 'bad_words').split(',').map((w) => w.trim().toLocaleLowerCase('tr')).filter(Boolean);
    const words = new Set([...BASE_PROFANITY, ...custom]);
    const hits = [];
    let scanned = 0;

    for (const member of guild.members.cache.values()) {
      if (member.user.bot) continue;
      const status = member.presence?.activities.find((a) => a.type === ActivityType.Custom)?.state;
      if (!status) continue;
      scanned++;
      const reasons = [];
      if (type !== 'reklam') {
        const t = tokens(status);
        if (t.some((w) => words.has(w) || ROOTS.some((r) => w.startsWith(r)))) reasons.push(`${e('unlem', '🤬')} küfür`);
      }
      if (type !== 'kufur') {
        if (INVITE_RE.test(status)) reasons.push(`${e('megafon', '📢')} davet linki`);
        else if (URL_RE.test(status)) reasons.push(`${e('zincir', '🔗')} link`);
      }
      if (search && status.toLocaleLowerCase('tr').includes(search)) reasons.push(`${e('hedef', '🔎')} "${search}"`);
      if (reasons.length) hits.push(`${member} • ${reasons.join(', ')}\n└ \`${status.replaceAll('`', 'ˋ').slice(0, 120)}\``);
    }

    const embed = kariaEmbed(interaction.client, 'Özel Durum Taraması', { footer: `${scanned} üye tarandı · çevrimdışılar görünmez` })
      .setTitle(`${hits.length} sonuç`)
      .setDescription(hits.join('\n').slice(0, 4000) || `Uygun özel durum bulunamadı. ${e('parilti', '✨')}`);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
