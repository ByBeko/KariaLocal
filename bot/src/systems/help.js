// Yardım menüsü: üyeler sadece kendi kullanabildiği komutları görür (örnekli, sade arayüz).
// Yetkililer ek olarak sadece kendilerine görünen "Yetkili Paneli"ni açabilir (seviye seviye ayrılmış).
import { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ApplicationCommandOptionType as T } from 'discord.js';
import config from '../config.js';
import { brandEmbed, kariaEmbed } from '../utils/embeds.js';
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
  ekonomi: { label: 'Ekonomi', get emoji() { return e('coin', '🪙'); }, description: 'Coin bakiyesi ve ödüller' },
  oyunlar: { label: 'Oyunlar', get emoji() { return e('oyun', '🎮'); }, description: 'Coin oyunları ve Etkinlik' },
};

/** Kategorilerdeki komut sırası. Burada olmayan üye komutu Genel'in sonunda görünür, yani kaybolmaz. */
const COMMAND_ORDER = {
  genel: ['bilgi', 'yardim', 'bot-bilgi', 'ping'],
  topluluk: ['afk', 'oneri', 'rapor'],
  muzik: ['cal', 'duraklat', 'gec', 'dur', 'sira', 'simdi', 'karistir', 'dongu', 'ses', 'filtre'],
  ekonomi: ['bakiye', 'gunluk', 'gonder'],
  oyunlar: ['coinflip', 'slot', 'blackjack'],
};
/** /bilgi butonlarından açılan komutlar: çalışmaya devam eder ama yardım listesinde ayrıca gösterilmez */
const HIDDEN_IN_HELP = new Set(['avatar', 'roller', 'emoji', 'seviye', 'siralama', 'istatistik']);
/** Ana sayfada yazılmayan komutlar: sadece komut seçme menüsünde çıkar */
const DETAIL_ONLY = new Set(['duraklat', 'gec', 'dur', 'sira', 'simdi', 'karistir', 'dongu', 'ses', 'filtre']);
/** Ana sayfada kategorinin altına düşülen kısa not */
const MAIN_NOTES = { muzik: '*Diğer kontroller oynatıcının butonlarında.*' };
/** Kategorinin sonuna her zaman eklenen satırlar (komut olmayan bağlantılar) */
const EXTRA_LINES = { oyunlar: ['[Karia Etkinlik](https://activity.karia.live) — Okey ve diğer oyunlar'] };
const CATEGORY_OF = new Map(Object.entries(COMMAND_ORDER).flatMap(([category, names]) => names.map((name) => [name, category])));
const ORDER_INDEX = new Map(Object.values(COMMAND_ORDER).flatMap((names) => names.map((name, i) => [name, i])));

/** Yardımda tek satıra sığan kısa açıklamalar; alt komutlu olanlarda alt komut başına */
const SHORT_DESCRIPTIONS = {
  bilgi: { kullanici: 'Üye bilgisi', sunucu: 'Sunucu bilgisi' },
  yardim: 'Komut listesi',
  'bot-bilgi': 'Bot hakkında',
  ping: 'Bot gecikmesi',
  afk: 'AFK durumuna geç',
  oneri: 'Öneri gönder',
  rapor: 'Üyeyi yetkililere bildir',
  cal: 'Şarkı çal ya da sıraya ekle',
  duraklat: 'Duraklat / devam ettir',
  gec: 'Şarkıyı geç',
  dur: 'Müziği durdur',
  sira: { liste: 'Sırayı göster', sil: 'Sıradan şarkı sil', temizle: 'Sırayı temizle' },
  simdi: 'Çalan şarkı',
  karistir: 'Sırayı karıştır',
  dongu: 'Tekrar modu',
  ses: 'Ses düzeyi',
  filtre: 'Ses filtresi (8D, bass boost, nightcore, slowed)',
  bakiye: 'Coin bakiyen',
  gunluk: 'Günlük coin ödülü',
  gonder: 'Üyeye coin gönder',
  coinflip: 'Yazı tura',
  slot: 'Slot makinesi',
  blackjack: 'Blackjack',
};
const firstClause = (text) => text.split(/[.:(]/)[0].trim();
const shortDescription = (c) => {
  const short = SHORT_DESCRIPTIONS[c.data.name];
  if (typeof short === 'string') return short;
  return short ? Object.values(short).join(', ') : firstClause(c.data.description);
};
// Alt komutu olanların hepsi yan yana yazılır, her biri ayrı tıklanır (yetkili paneli)
const commandLine = (c) => `${commandRefs(c).join(' ')} — ${shortDescription(c)}`;
/** Üye yardımında her alt komut kendi satırında */
function memberLines(c) {
  const refs = commandRefs(c);
  if (refs.length === 1) return [`${refs[0]} — ${shortDescription(c)}`];
  const subs = c.data.toJSON().options.filter((o) => o.type === T.Subcommand);
  const short = SHORT_DESCRIPTIONS[c.data.name];
  return refs.map((ref, i) => `${ref} — ${short?.[subs[i].name] ?? firstClause(subs[i].description)}`);
}

// Bölümler arasında en fazla bir satır boşluk
const compactSections = (sections) => sections.map((s) => `${s.icon} **${s.title}**\n${quote(s.body)}`).join('\n\n');

/** Her kategori tek bölüm; DETAIL_ONLY komutları sadece komut seçme menüsünde */
function categorySections(groups) {
  const sections = [];
  for (const [key, list] of groups) {
    const shown = list.filter((c) => !DETAIL_ONLY.has(c.data.name));
    if (!shown.length) continue;
    const lines = shown.flatMap(memberLines);
    if (shown.length < list.length && MAIN_NOTES[key]) lines.push(MAIN_NOTES[key]);
    lines.push(...(EXTRA_LINES[key] ?? []));
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
  filtre: `${P} filtre nightcore`,
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
        compactSections(categorySections(userCommands(member, client))),
      ].join('\n'),
      4096,
    ),
  );
  const website = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Web Sitesi').setURL(config.links.website || 'https://karia.live').setEmoji(e('baglanti', '🌐'));
  return { content: '', embeds: [embed], components: helpComponents(member, client, ownerId, [website], staffButton), allowedMentions: { parse: [] } };
}

/** Komut seçme menüsü (ana sayfada gizlenen müzik komutları dahil hepsi) + altında butonlar */
function helpComponents(member, client, ownerId, buttons, staffButton, selected = null) {
  const all = [...userCommands(member, client).values()].flat();
  const select = new StringSelectMenuBuilder()
    .setCustomId(`yardim:komut:${ownerId}`)
    .setPlaceholder('Kullanımını görmek istediğin komutu seç')
    .addOptions(all.slice(0, 25).map((c) => ({ label: `/${c.data.name}`, value: c.data.name, description: shortDescription(c).slice(0, 100), default: c.data.name === selected })));
  return [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(withStaff(member, buttons, staffButton))];
}

/** Menüden seçilen komutun detayı; menü ve Ana Sayfa butonu altta kalır */
export function commandPage(member, client, ownerId, command, { staffButton = false } = {}) {
  const home = navButton(`yardim:ana:${ownerId}`, 'Ana Sayfa', e('ev', '🏠'));
  return { content: '', embeds: [commandView(command)], components: helpComponents(member, client, ownerId, [home], staffButton, command.data.name), allowedMentions: { parse: [] } };
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
