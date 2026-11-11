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
  topluluk: { label: 'Topluluk', get emoji() { return e('yildiz', '⭐'); }, description: 'Seviye, sıralama, öneri' },
  muzik: { label: 'Müzik', get emoji() { return e('muzik', '🎵'); }, description: 'YouTube’dan müzik çal' },
  ekonomi: { label: 'Ekonomi', get emoji() { return e('oyun', '🎰'); }, description: 'Coin ve oyunlar' },
};

/** Kategori sayfalarındaki alt başlıklar. Burada olmayan üye komutu Genel altında "Diğer" başlığında görünür, yani kaybolmaz. */
const COMMAND_GROUPS = {
  genel: [
    ['Bilgi', 'bilgi', ['bilgi', 'avatar', 'roller', 'emoji']],
    ['Karia', 'bot', ['yardim', 'ping', 'bot-bilgi']],
  ],
  topluluk: [
    ['Seviye', 'yildiz', ['seviye', 'siralama', 'istatistik']],
    ['Sosyal', 'arkadaslar', ['afk', 'oneri', 'rapor']],
  ],
  muzik: [
    ['Çalma', 'oynat', ['cal', 'duraklat', 'gec', 'dur']],
    ['Sıra', 'pano', ['sira', 'simdi', 'karistir', 'dongu']],
    ['Ayar', 'ayarlar', ['ses']],
  ],
  ekonomi: [
    ['Coin', 'dolar', ['bakiye', 'gunluk', 'gonder']],
    ['Oyunlar', 'oyun', ['coinflip', 'slot', 'blackjack']],
  ],
};
const CATEGORY_OF = new Map(Object.entries(COMMAND_GROUPS).flatMap(([category, groups]) => groups.flatMap(([, , names]) => names.map((name) => [name, category]))));

const SHORT_DESCRIPTIONS = {
  seviye: 'Seviye kartın ve ödüller',
  afk: 'AFK durumuna geç',
  siralama: 'Sunucu sıralamaları',
  sira: 'Müzik sırası',
  avatar: 'Profil fotoğrafı ve afişi',
  bilgi: 'Üye ve sunucu bilgileri',
  rapor: 'Bir üyeyi yetkililere bildir',
  emoji: 'Sunucunun emojileri',
  roller: 'Sunucunun rolleri',
};
const shortDescription = (c) => SHORT_DESCRIPTIONS[c.data.name] ?? c.data.description.split(/[.:(]/)[0].trim();
// Alt komutu olanların hepsi yan yana yazılır, her biri ayrı tıklanır
const commandLine = (c) => `${commandRefs(c).join(' ')} — ${shortDescription(c)}`;

// Bölümler arasında en fazla bir satır boşluk
const compactSections = (sections) => sections.map((s) => `${s.icon} **${s.title}**\n${quote(s.body)}`).join('\n\n');

function groupedSections(category, list) {
  const remaining = new Map(list.map((c) => [c.data.name, c]));
  const sections = [];
  for (const [title, icon, names] of COMMAND_GROUPS[category] ?? []) {
    const commands = names.map((name) => remaining.get(name)).filter(Boolean);
    names.forEach((name) => remaining.delete(name));
    if (commands.length) sections.push({ icon: e(icon, '📌'), title, body: commands.map(commandLine).join('\n') });
  }
  if (remaining.size) {
    sections.push({ icon: e('kitap', '📖'), title: sections.length ? 'Diğer' : 'Komutlar', body: [...remaining.values()].map(commandLine).join('\n') });
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
    if (isStaffCommand(command) || checkAccess(member, command)) continue;
    groups.get(CATEGORY_OF.get(command.data.name) ?? 'genel').push(command);
  }
  for (const [key, list] of groups) if (!list.length) groups.delete(key);
  return groups;
}

const info = (key) => CATEGORIES[key] ?? { label: key, emoji: e('pano', '📁'), description: '' };

/** Kategori açılır menüsü + kategori sayfasında komut seçme menüsü */
function components(member, client, ownerId, selected = 'ana', staffButton = false) {
  const groups = userCommands(member, client);
  const categorySelect = new StringSelectMenuBuilder()
    .setCustomId(`yardim:kategori:${ownerId}`)
    .setPlaceholder('Bir komut kategorisi seçin...')
    .addOptions(
      { label: 'Ana Sayfa', value: 'ana', emoji: e('ev', '🏠'), description: 'Yardım Merkezi' },
      ...[...groups.keys()].map((key) => ({ label: info(key).label, value: key, emoji: info(key).emoji, description: info(key).description, default: key === selected })),
    );
  const rows = [new ActionRowBuilder().addComponents(categorySelect)];

  const list = groups.get(selected);
  if (list?.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`yardim:komut:${ownerId}:${selected}`)
      .setPlaceholder('Detayını görmek istediğin komutu seç')
      .addOptions(list.slice(0, 25).map((c) => ({ label: `/${c.data.name}`, value: c.data.name, description: c.data.description.slice(0, 100) })));
    rows.push(new ActionRowBuilder().addComponents(select));
  }
  // Yetkili butonu sadece kişiye özel (gizli) menülerde; herkese açık yardımda görünmez
  if (staffButton && getLevel(member) >= Level.STAFF) rows.push(staffButtonRow());
  return rows;
}

export function staffButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('yardim:yetkili').setLabel('Yetkili Paneli').setEmoji(e('kalkan2', '🛡️')).setStyle(ButtonStyle.Secondary),
  );
}

const helpEmbed = (member, client, title, footer) => {
  const embed = kariaEmbed(client, 'Yardım Merkezi', { footer }).setThumbnail(member.guild.iconURL({ size: 256 }));
  return embed.setTitle(title ?? client.user.username);
};

export function homeView(member, client, ownerId, { staffButton = false } = {}) {
  const total = [...userCommands(member, client).values()].reduce((sum, list) => sum + list.length, 0);
  const embed = helpEmbed(member, client)
    .setDescription([
      `Merhaba **${member.displayName}**!`,
      '',
      'Detaylı bilgi almak istediğin komut kategorisini **aşağıdaki açılır menüden** seçebilirsin.',
      '',
      `${e('zincir', '🔗')} **Hızlı Bağlantılar:**`,
      `• Metin Komut Prefix: ${config.prefixes.map((p) => `\`${p}\``).join(' ')} | Slash Komutları: \`/\``,
      `• Toplam Komut: \`${total}\``,
    ].join('\n'));
  return { content: '', embeds: [embed], components: [...components(member, client, ownerId, 'ana', staffButton), linkRow()], allowedMentions: { parse: [] } };
}

export function categoryView(member, client, ownerId, category, { staffButton = false } = {}) {
  const list = userCommands(member, client).get(category) ?? [];
  const embed = helpEmbed(member, client, `${info(category).emoji} ${info(category).label}`, `${list.length} komut`)
    .setDescription(fit(compactSections(groupedSections(category, list)), 4096) || 'Bu kategoride komut yok.');
  return { content: '', embeds: [embed], components: components(member, client, ownerId, category, staffButton), allowedMentions: { parse: [] } };
}

/** Buton ile açılan sayfa: ana sayfa ya da kategori */
export function pageView(member, client, ownerId, page, options = {}) {
  if (page === 'ana' || !CATEGORIES[page]) return homeView(member, client, ownerId, options);
  return categoryView(member, client, ownerId, page, options);
}

/** Menüden seçilen komutun detayı; kategori butonları altta kalır */
export function commandPage(member, client, ownerId, category, command, { staffButton = false } = {}) {
  return { content: '', embeds: [commandView(command)], components: components(member, client, ownerId, category, staffButton) };
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
