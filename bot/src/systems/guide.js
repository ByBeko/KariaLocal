// Üyeyi aradığı kanala yönlendirir (mesajdan anlayarak ve yapay zeka cevaplarında).
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import guideEntries from '../channelGuide.js';
import { getSetting } from '../core/settings.js';
import { e } from '../utils/emojis.js';
import { commandRef } from '../utils/commandRefs.js';

const TOPIC_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];
const USER_COOLDOWN = 30 * 60_000;
const CHANNEL_COOLDOWN = 60_000;

const asciify = (text) =>
  text
    .toLocaleLowerCase('tr')
    .replaceAll('ş', 's').replaceAll('ı', 'i').replaceAll('ğ', 'g')
    .replaceAll('ü', 'u').replaceAll('ö', 'o').replaceAll('ç', 'c');

const channelKey = (name) => asciify(name).replace(/[^a-z0-9-]/g, '').replace(/^-+/, '');

/** channelGuide kaydına karşılık gelen kanal (talep kanalları hariç) */
export function findGuideChannel(guild, key) {
  const entry = guideEntries.find((g) => g.key === key);
  if (!entry) return null;
  const ticketCategory = getSetting(guild.id, 'ticket_category');
  return guild.channels.cache.find((c) => TOPIC_TYPES.includes(c.type) && c.parentId !== ticketCategory && entry.match.test(c.name)) ?? null;
}

const reply = (guild, key, build) => {
  const channel = findGuideChannel(guild, key);
  return channel ? { channel, text: build(`<#${channel.id}>`) } : null;
};

// Metinler asciify edilmiş halde eşleşir: "yardım lazım" ve "yardim lazim" aynıdır.
const TOPICS = [
  {
    id: 'destek',
    re: /\b(destek (talebi|lazim|istiyorum|almak|alabilir)|yardim (lazim|istiyorum|edin|eder misiniz|edermisiniz|edebilir misiniz)|sorunum var|sorun yasiyorum|problem yasiyorum|bug buldum|hata buldum|sikayet (etmek|edecegim|edicem)|yetkili(ye| ile) (ulas|konus|yaz)|yetkili yok mu)/,
    icon: () => e('cankurtaran', '🎫'),
    resolve: (guild) => reply(guild, 'destek', (c) => `Destek için ${c} kanalından talep açabilirsin, yetkililer sana özel kanaldan yardımcı olur.`),
  },
  {
    id: 'roller',
    re: /\b(nasil|nereden|nerden|nerde|nerede) rol\b|\brol(ler|leri)? (nasil|nereden|nerden|nerde|nerede)\b|\brol almak istiyorum/,
    icon: () => e('rozet', '🎭'),
    resolve: (guild) => reply(guild, 'roller', (c) => `Rollerini ${c} kanalından seçebilirsin.`),
  },
  {
    id: 'kurallar',
    re: /\bkurallar(i)? (nerede|nerde|neler|ne)\b/,
    icon: () => e('kitap', '📜'),
    resolve: (guild) => reply(guild, 'kurallar', (c) => `Sunucu kurallarını ${c} kanalında bulabilirsin.`),
  },
  {
    id: 'baglanti',
    re: /\b(discord|davet|site|website|instagram|tiktok|youtube) (linki|linkini|adresi)\b.*(nerede|nerde|var mi|atar misin|verir misin|lazim)|\blinkler (nerede|nerde)\b/,
    icon: () => e('baglanti', '🌍'),
    resolve: (guild) => reply(guild, 'baglantilar', (c) => `Resmi bağlantılarımız ${c} kanalında.`),
  },
  {
    id: 'oy',
    re: /\bnasil oy ver|\boy (nerede|nerde) ver|\boy vermek istiyorum/,
    icon: () => e('alev', '🔥'),
    resolve: (guild) => reply(guild, 'oy-ver', (c) => `Oy vermek için ${c} kanalına bakabilirsin.`),
  },
  {
    id: 'komut',
    re: /\bkomutlar(i)? (nerede|nerde|neler|ne)\b|\bhangi komutlar\b/,
    icon: () => e('kitap', '🔧'),
    resolve: (guild, client) => reply(guild, 'komutlar', (c) => `Tüm komutlar ${commandRef(client, 'yardim')} menüsünde. Komutları ${c} kanalında kullanabilirsin.`),
  },
  {
    id: 'oda',
    re: /\b(ozel|kendi) oda(mi|si)? (nasil|nereden|nerden|acmak|acabilir|kurabil)/,
    icon: () => e('mikrofon', '🔊'),
    resolve: (guild) => {
      const channel = guild.channels.cache.get(getSetting(guild.id, 'tempvoice_create'));
      return channel ? { channel, text: `<#${channel.id}> ses kanalına girdiğinde sana özel oda açılır.` } : null;
    },
  },
  {
    id: 'arkadas',
    re: /\b(oynayacak (kimse|arkadas|birini|biri)|birlikte oynayacak|arkadas ariyorum|takim arkadasi ariyorum)/,
    icon: () => e('arkadaslar', '👥'),
    resolve: (guild) => reply(guild, 'arkadas-bul', (c) => `Birlikte oynayacak birini ${c} kanalında bulabilirsin.`),
  },
  {
    id: 'guncelleme',
    re: /\bguncelleme(ler)? (nerede|nerde|ne zaman)\b/,
    icon: () => e('roket', '🤖'),
    resolve: (guild) => reply(guild, 'karia-bot', (c) => `Karia Local güncellemeleri her hafta ${c} forumunda paylaşılır.`),
  },
  {
    id: 'sss',
    re: /\bsss\b.*(nerede|nerde)|\bsik sorulan/,
    icon: () => e('soru', '❓'),
    resolve: (guild) => reply(guild, 'sss', (c) => `Sık sorulan sorular ${c} kanalında.`),
  },
];

const userSeen = new Map();
const channelSeen = new Map();

/** Mesajda bir ihtiyaç anlaşılırsa üyeye ilgili kanalı gösterir. */
export async function handleGuide(message) {
  if (message.content.length < 6 || message.content.length > 300) return;
  const text = asciify(message.content);
  const topic = TOPICS.find((t) => t.re.test(text));
  if (!topic) return;

  const { guild, member, channel, client } = message;
  // Yetkili ve talep kanallarında araya girme
  if (!channel.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) return;

  const now = Date.now();
  const userKey = `${message.author.id}:${topic.id}`;
  if (now - (userSeen.get(userKey) ?? 0) < USER_COOLDOWN || now - (channelSeen.get(channel.id) ?? 0) < CHANNEL_COOLDOWN) return;

  const target = topic.resolve(guild, client);
  if (!target || target.channel.id === channel.id || !target.channel.permissionsFor(member)?.has(P.ViewChannel)) return;

  if (userSeen.size > 5000) userSeen.clear();
  userSeen.set(userKey, now);
  channelSeen.set(channel.id, now);
  await message.reply({ content: `${topic.icon()} ${target.text}`, allowedMentions: { parse: [], repliedUser: false } });
}

/** Yapay zeka cevabındaki "#kanal-adi" yazılarını tıklanabilir kanal etiketine çevirir (sadece herkese açık kanallar). */
export function linkChannels(guild, text) {
  const everyone = guild.roles.everyone;
  const visible = guild.channels.cache.filter(
    (c) => c.type !== ChannelType.GuildCategory && !c.isThread() && c.permissionsFor(everyone)?.has(P.ViewChannel),
  );
  return text.replace(/#[^\s#,.;:!?()'’`*_"]+/gu, (token) => {
    const key = channelKey(token);
    const channel = key && visible.find((c) => channelKey(c.name) === key);
    return channel ? `<#${channel.id}>` : token;
  });
}
