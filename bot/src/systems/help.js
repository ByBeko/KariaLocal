// Yardım menüsü: üyeler sadece kendi kullanabildiği komutları görür (örnekli, sade arayüz).
// Yetkililer ek olarak sadece kendilerine görünen "Yetkili Paneli"ni açabilir (seviye seviye ayrılmış).
import { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ApplicationCommandOptionType as T } from 'discord.js';
import config from '../config.js';
import { brandEmbed, kariaEmbed, linkRow } from '../utils/embeds.js';
import { e } from '../utils/emojis.js';
import { checkAccess, getLevel, Level, LevelName } from '../utils/permissions.js';
import { quote, fit } from '../utils/style.js';
import { commandRefs } from '../utils/commandRefs.js';

const P = 'kari'; // örneklerde gösterilen ön ek (kl ve k da çalışır)

/** Üye kategorileri (görünme sırasıyla) */
export const CATEGORIES = {
  genel: { label: 'Genel', get emoji() { return e('bilgi', '📌'); }, description: 'Profil, sunucu, roller' },
  topluluk: { label: 'Topluluk', get emoji() { return e('yildiz', '⭐'); }, description: 'AFK, öneri, rapor' },
  muzik: { label: 'Müzik', get emoji() { return e('muzik', '🎵'); }, description: 'YouTube’dan müzik çal' },
  ekonomi: { label: 'Ekonomi', get emoji() { return e('oyun', '🎰'); }, description: 'Coin ve oyunlar' },
};

/** Kategorilerdeki komut sırası. Burada olmayan üye komutu Genel'in sonunda görünür, yani kaybolmaz. */
const COMMAND_ORDER = {
  genel: ['bilgi', 'yardim', 'bot-bilgi', 'ping'],
  topluluk: ['afk', 'oneri', 'rapor'],
  muzik: ['cal', 'duraklat', 'gec', 'dur', 'sira', 'simdi', 'karistir', 'dongu', 'ses'],
  ekonomi: ['bakiye', 'gunluk', 'gonder', 'coinflip', 'slot', 'blackjack'],
};
/** /bilgi butonlarından açılan komutlar: çalışmaya devam eder ama yardım listesinde ayrıca gösterilmez */
const HIDDEN_IN_HELP = new Set(['avatar', 'roller', 'emoji', 'seviye', 'siralama', 'istatistik']);
/** Ana sayfada gösterilmeyen komutlar: sadece "Detaylı Gör"de listelenir */
const DETAIL_ONLY = new Set(['duraklat', 'gec', 'dur', 'sira', 'simdi', 'karistir', 'dongu', 'ses']);
/** Ana sayfada kategorinin altına düşülen kısa not */
const MAIN_NOTES = { muzik: '*Duraklat, geç, durdur, döngü, karıştır: oynatıcının butonlarında.*' };
const CATEGORY_OF = new Map(Object.entries(COMMAND_ORDER).flatMap(([category, names]) => names.map((name) => [name, category])));
const ORDER_INDEX = new Map(Object.values(COMMAND_ORDER).flatMap((names) => names.map((name, i) => [name, i])));

const SHORT_DESCRIPTIONS = {
  seviye: 'Seviye kartın ve ödüller',
  afk: 'AFK durumuna geç',
  siralama: 'Sunucu sıralamaları',
  sira: 'Müzik sırası',
  avatar: 'Profil fotoğrafı ve afişi',
  bilgi: 'Üye/sunucu bilgisi; avatar, seviye, sıralama, roller butonlarda',
  rapor: 'Bir üyeyi yetkililere bildir',
  emoji: 'Sunucunun emojileri',
  roller: 'Sunucunun rolleri',
};
const shortDescription = (c) => SHORT_DESCRIPTIONS[c.data.name] ?? c.data.description.split(/[.:(]/)[0].trim();
// Alt komutu olanların hepsi yan yana yazılır, her biri ayrı tıklanır
const commandLine = (c) => `${commandRefs(c).join(' ')} — ${shortDescription(c)}`;

// Bölümler arasında en fazla bir satır boşluk
const compactSections = (sections) => sections.map((s) => `${s.icon} **${s.title}**\n${quote(s.body)}`).join('\n\n');

/** Her kategori tek bölüm; detailed=false iken DETAIL_ONLY komutları gizlenir */
function categorySections(groups, detailed) {
  const sections = [];
  for (const [key, list] of groups) {
    const shown = detailed ? list : list.filter((c) => !DETAIL_ONLY.has(c.data.name));
    if (!shown.length) continue;
    const lines = shown.map(commandLine);
    if (!detailed && shown.length < list.length && MAIN_NOTES[key]) lines.push(MAIN_NOTES[key]);
    sections.push({ icon: info(key).emoji, title: info(key).label, body: lines.join('\n') });
  }
  return sections;
}

/** Üye komutları için hazır örnekler */
const EXAMPLES = {
  yardim: `${P} yardim cal`,
  afk: `${P} afk yemekteyim`,
  rapor: '/rapor',
  ping: `${P} ping`,
  avatar: `${P} avatar @kişi`,
  bilgi: `${P} profil @kişi`,
  roller: `${P} roller`,
  'bot-bilgi': `${P} botinfo`,
  seviye: `${P} rank`,
  oneri: '/oneri',
  cal: `${P} çal tarkan kuzu kuzu`,
  gec: `${P} geç`,
  dur: `${P} dur`,
  duraklat: `${P} pause`,
  sira: `${P} sıra`,
  simdi: `${P} np`,
  ses: `${P} ses 50`,
  dongu: `${P} döngü`,
  karistir: `${P} karıştır`,
  bakiye: `${P} para`,
  gunluk: `${P} günlük`,
  gonder: `${P} gönder @kişi 100`,
  coinflip: `${P} cf 100 tura`,
  slot: `${P} slot 100`,
  blackjack: `${P} bj 100`,
  istatistik: `${P} istatistik`,
  siralama: `${P} top davet`,
  emoji: `${P} emoji`,
};

const TIERS = [
  { level: Level.STAFF, get emoji() { return e('kalkan', '👮'); }, color: 0x3498db, hint: 'Susturma, uyarı, mesaj silme, çekiliş' },
  { level: Level.MOD, get emoji() { return e('tokmak', '🛡️'); }, color: 0xe67e22, hint: 'Ban, kick, jail, rol, kanal kilidi' },
  { level: Level.ADMIN, get emoji() { return e('ayarlar', '⚙️'); }, color: 0xe74c3c, hint: 'Bot ayarları, kurulum, paneller, analiz' },
];

/** Yetkili komutu mu? (seviyesi var ya da Discord'da varsayılan olarak gizli) */
export function isStaffCommand(command) {
  return (command.level ?? Level.USER) > Level.USER || command.data.toJSON().default_member_permissions != null;
}
const requiredTier = (command) => Math.max(command.level ?? Level.USER, Level.STAFF);

function formatOption(o) {
  const name = o.type === T.Attachment ? `${o.name}: dosya eki` : o.name;
  return o.required ? `<${name}>` : `[${name}]`;
}

/** Komutun kullanım satırları. style: 'slash' → "/ban ...", 'prefix' → "kl ban ..." */
export function usageLines(command, style) {
  const start = style === 'prefix' ? `${config.prefix} ` : '/';
  const json = command.data.toJSON();
  const options = json.options ?? [];
  const subs = options.filter((o) => o.type === T.Subcommand);
  if (subs.length) {
    return subs.map((s) => `\`${start}${json.name} ${s.name}${(s.options ?? []).map((o) => ` ${formatOption(o)}`).join('')}\` — ${s.description}`);
  }
  return [`\`${start}${json.name}${options.map((o) => ` ${formatOption(o)}`).join('')}\``];
}

/** Üyenin görebileceği üye komutları, kategoriye göre */
function userCommands(member, client) {
  const groups = new Map(Object.keys(CATEGORIES).map((k) => [k, []]));
  for (const command of client.commands.values()) {
    if (isStaffCommand(command) || HIDDEN_IN_HELP.has(command.data.name) || checkAccess(member, command)) continue;
    groups.get(CATEGORY_OF.get(command.data.name) ?? 'genel').push(command);
  }
  const rank = (c) => ORDER_INDEX.get(c.data.name) ?? Infinity;
  for (const [key, list] of groups) {
    if (!list.length) groups.delete(key);
    else list.sort((a, b) => rank(a) - rank(b));
  }
  return groups;
}

const info = (key) => CATEGORIES[key] ?? { label: key, emoji: e('pano', '📁'), description: '' };

const navButton = (id, label, emoji) => new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Secondary);
const staffButtonComponent = () => navButton('yardim:yetkili', 'Yetkili Paneli', e('kalkan2', '🛡️'));
// Yetkili butonu sadece kişiye özel (gizli) menülerde; herkese açık yardımda görünmez
const withStaff = (member, buttons, staffButton) => (staffButton && getLevel(member) >= Level.STAFF ? [...buttons, staffButtonComponent()] : buttons);

export function staffButtonRow() {
  return new ActionRowBuilder().addComponents(staffButtonComponent());
}

const helpEmbed = (member, client, title, footer) => {
  const embed = kariaEmbed(client, 'Yardım Merkezi', { footer }).setThumbnail(member.guild.iconURL({ size: 256 }));
  return embed.setTitle(title ?? client.user.username);
};

/** Tek sayfalık yardım: tüm kategoriler bir arada, müzikte sadece /cal */
export function homeView(member, client, ownerId, { staffButton = false } = {}) {
  const embed = helpEmbed(member, client).setDescription(
    fit(
      [
        `Merhaba **${member.displayName}**! Prefix: ${config.prefixes.map((p) => `\`${p}\``).join(' ')} · Slash: \`/\``,
        '',
        compactSections(categorySections(userCommands(member, client), false)),
      ].join('\n'),
      4096,
    ),
  );
  const row = new ActionRowBuilder().addComponents(
    withStaff(member, [navButton(`yardim:detay:${ownerId}`, 'Detaylı Gör', e('kitap', '📖')), ...linkRow().components], staffButton).slice(0, 5),
  );
  return { content: '', embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

/** Detay sayfaları: komut seçme menüsü + geri butonları */
function detailComponents(member, client, ownerId, staffButton, selected) {
  const all = [...userCommands(member, client).values()].flat();
  const select = new StringSelectMenuBuilder()
    .setCustomId(`yardim:komut:${ownerId}`)
    .setPlaceholder('Kullanımını görmek istediğin komutu seç')
    .addOptions(all.slice(0, 25).map((c) => ({ label: `/${c.data.name}`, value: c.data.name, description: shortDescription(c).slice(0, 100), default: c.data.name === selected })));
  const buttons = [
    ...(selected ? [navButton(`yardim:detay:${ownerId}`, 'Tüm Komutlar', e('kitap', '📖'))] : []),
    navButton(`yardim:ana:${ownerId}`, 'Ana Sayfa', e('ev', '🏠')),
  ];
  return [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(withStaff(member, buttons, staffButton))];
}

/** "Detaylı Gör": tüm üye komutları (müzik dahil) + komut seçme menüsü */
export function detailView(member, client, ownerId, { staffButton = false } = {}) {
  const groups = userCommands(member, client);
  const total = [...groups.values()].reduce((sum, list) => sum + list.length, 0);
  const embed = helpEmbed(member, client, `${e('kitap', '📖')} Tüm Komutlar`, `${total} komut · Kullanım ve örnek için menüden seç`)
    .setDescription(fit(compactSections(categorySections(groups, true)), 4096) || 'Kullanabileceğin komut yok.');
  return { content: '', embeds: [embed], components: detailComponents(member, client, ownerId, staffButton), allowedMentions: { parse: [] } };
}

/** Menüden seçilen komutun detayı; menü ve geri butonları altta kalır */
export function commandPage(member, client, ownerId, command, { staffButton = false } = {}) {
  return { content: '', embeds: [commandView(command)], components: detailComponents(member, client, ownerId, staffButton, command.data.name), allowedMentions: { parse: [] } };
}

/** Sadece yetkiliye görünen panel: seviyesine kadar olan yetkili komutları, kademe kademe */
export function staffView(member, client) {
  const level = getLevel(member);
  const header = brandEmbed()
    .setTitle(`${e('kalkan2', '🛡️')} Yetkili Paneli`)
    .setDescription(
      [
        `Yetkin: **${LevelName[level]}**${level >= Level.OWNER ? ' — tüm komutlara erişimin var.' : ''}`,
        'Bu panel sadece sana görünür. Bir komutun tüm seçenekleri için: `/yardim komut:<ad>`',
        'Yetkili komutları normal üyelerin `/` menüsünde ve yardımında görünmez.',
      ].join('\n'),
    );
  const embeds = [header];
  for (const tier of TIERS) {
    if (level < tier.level) continue;
    const cmds = [...client.commands.values()]
      .filter((c) => isStaffCommand(c) && requiredTier(c) === tier.level && !checkAccess(member, c))
      .sort((a, b) => a.data.name.localeCompare(b.data.name));
    if (!cmds.length) continue;
    embeds.push(
      brandEmbed()
        .setColor(tier.color)
        .setTitle(`${tier.emoji} ${LevelName[tier.level]} komutları`)
        .setDescription(fit(cmds.map(commandLine).join('\n'), 4096))
        .setFooter({ text: tier.hint }),
    );
  }
  return { embeds };
}

export function commandView(command) {
  const json = command.data.toJSON();
  const staff = isStaffCommand(command);
  const sections = [
    { icon: e('kod', '💻'), title: 'Eğik Çizgi ile', body: usageLines(command, 'slash').join('\n') },
    { icon: e('mesaj', '💬'), title: 'Ön Ek ile', body: usageLines(command, 'prefix').join('\n') },
  ];
  if (EXAMPLES[json.name]) sections.push({ icon: e('ampul', '💡'), title: 'Örnek', body: `\`${EXAMPLES[json.name]}\`` });

  const options = (json.options ?? []).filter((o) => o.type !== T.Subcommand);
  if (options.length) {
    sections.push({
      icon: e('ayarlar', '⚙️'),
      title: 'Seçenekler',
      body: options.map((o) => `\`${o.name}\`${o.required ? ' (zorunlu)' : ''} — ${o.description}`).join('\n'),
    });
  }
  if (command.aliases?.length) {
    sections.push({ icon: e('simsek', '⚡'), title: 'Kısayollar', body: command.aliases.map((a) => `\`${P} ${a}\``).join(' ') });
  }
  sections.push({
    icon: e('arkadaslar', '👥'),
    title: 'Kimler Kullanabilir',
    body: staff ? `${e('kalkan', '🛡️')} ${LevelName[requiredTier(command)]} ve üstü` : 'Herkes',
  });
  return brandEmbed()
    .setTitle(`${e('kitap', '📖')} /${json.name}`)
    .setDescription(`${json.description}\n\n${compactSections(sections)}`.slice(0, 4096))
    .setFooter({ text: '<zorunlu>  [isteğe bağlı]' });
}
