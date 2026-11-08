// Sabit bilgilere kesin cevap: "instagram", "ip ne", "takviye kaç" gibi kısa mesajlar otomatik yanıtlanır.
// Link ve IP model tarafından üretilmez, böylece yanlış adres uydurulamaz.
import config from '../config.js';
import { e } from '../utils/emojis.js';
import { getServerStatus, mcEnabled, mcIp } from './minecraft.js';

const COOLDOWN = 15_000;
const MAX_WORDS = 7;
const BOOST_TIERS = [2, 7, 14];

const asciify = (text) =>
  text
    .toLocaleLowerCase('tr')
    .replaceAll('ş', 's').replaceAll('ı', 'i').replaceAll('ğ', 'g')
    .replaceAll('ü', 'u').replaceAll('ö', 'o').replaceAll('ç', 'c');

// Bunlar dışında bir kelime varsa mesaj sohbettir, cevap verilmez: "instagram açıyorum" yanıtlanmaz.
const FILLER = new Set([
  'karia', 'karianin', 'kari', 'bot', 'sunucu', 'sunucunun', 'sunucumuzun', 'mc', 'minecraft', 'discord', 'bizim', 'resmi', 'hesap', 'hesabi', 'hesabiniz', 'hesabini',
  'link', 'linki', 'linkini', 'linkiniz', 'adres', 'adresi', 'adresini', 'adresiniz', 'sayfa', 'sayfasi', 'sayfaniz', 'nedir', 'ne', 'neydi', 'nerede', 'nerde', 'var', 'mi',
  'mu', 'at', 'atar', 'atin', 'misin', 'misiniz', 'ver', 'verir', 'soyle', 'soyler', 'lazim', 'acaba', 'kac', 'si', 'i', 'ni', 'nin', 'yi', 'u', 'sini',
]);

const linkTopic = (key, label, icon) => ({
  answer: () => {
    const url = config.links[key];
    return url ? `${e(icon, '🔗')} **${label}:** ${url}` : `${label} adresimiz henüz eklenmedi.`;
  },
});

const TOPICS = [
  { words: ['instagram', 'instagrami', 'instagramin', 'instagraminiz', 'insta'], ...linkTopic('instagram', 'Instagram', 'baglanti') },
  { words: ['tiktok', 'tiktoku', 'tiktokun', 'tiktokunuz'], ...linkTopic('tiktok', 'TikTok', 'baglanti') },
  { words: ['youtube', 'youtubeu', 'youtubeun'], ...linkTopic('youtube', 'YouTube', 'baglanti') },
  { words: ['twitter', 'twitteri', 'twitterin'], ...linkTopic('x', 'X', 'baglanti') },
  { words: ['github', 'githubu', 'githubun'], ...linkTopic('github', 'GitHub', 'baglanti') },
  { words: ['site', 'siteyi', 'sitesi', 'sitesini', 'sitenin', 'siteniz', 'website', 'websitesi'], ...linkTopic('website', 'Website', 'baglanti') },
  { words: ['davet', 'daveti'], ...linkTopic('discord', 'Discord', 'baglanti') },
  {
    words: ['ip', 'ipi', 'ipsi', 'ipini', 'ipsini', 'ipniz'],
    answer: async () => {
      if (!mcEnabled) return 'Minecraft sunucusunun IP adresi henüz duyurulmadı.';
      const status = await getServerStatus();
      return `${e('kazma', '⛏️')} **Karia Minecraft IP:** \`${mcIp}\`\n${status.online ? `Sunucu açık, **${status.players}/${status.max}** oyuncu var.` : 'Sunucu şu an kapalı.'}`;
    },
  },
  {
    words: ['takviye', 'takviyeler', 'takviyesi', 'takviyeyi', 'takviyeci', 'takviyeciler', 'boost', 'boostlar', 'boostu', 'boostcular'],
    answer: (guild) => {
      const count = guild.premiumSubscriptionCount ?? 0;
      const next = BOOST_TIERS.find((n) => n > count);
      const boosters = guild.members.cache.filter((m) => m.premiumSince).map((m) => m.displayName);
      return [
        `${e('roket', '💜')} Sunucuda **${count}** takviye var, seviye **${guild.premiumTier}**.${next ? ` Sonraki seviyeye **${next - count}** takviye kaldı.` : ''}`,
        ...(boosters.length ? [`Takviye yapanlar: ${boosters.join(', ')}`] : []),
      ].join('\n').slice(0, 1900);
    },
  },
];

function findTopic(text) {
  const words = asciify(text).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length || words.length > MAX_WORDS) return null;
  const others = words.filter((w) => !FILLER.has(w));
  if (others.length !== 1) return null;
  return TOPICS.find((t) => t.words.includes(others[0])) ?? null;
}

/** Mesaj sabit bir bilgi soruyorsa cevabı döner, değilse null. */
export async function quickAnswer(guild, text) {
  const topic = findTopic(text ?? '');
  return topic ? topic.answer(guild) : null;
}

const seen = new Map(); // "kanal:konu" -> son cevap

/** Ön ek yazılmadan gelen kısa soruları yanıtlar. Yanıt verildiyse true döner. */
export async function handleQuickAnswer(message) {
  const topic = findTopic(message.content ?? '');
  if (!topic) return false;
  const key = `${message.channelId}:${topic.words[0]}`;
  if (Date.now() - (seen.get(key) ?? 0) < COOLDOWN) return false;
  seen.set(key, Date.now());
  if (seen.size > 1000) seen.clear();
  await message.reply({ content: await topic.answer(message.guild), allowedMentions: { parse: [], repliedUser: false } });
  return true;
}
