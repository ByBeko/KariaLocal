// Gelişim analizi: "Sunucuyu ne geliştirir?" sorusu için veri toplar.
//  1) Metrikler + kural tabanlı tespitler (kesin veri)
//  2) Topluluk sinyalleri: #oy-ver önerileri ve oyları, forum başlıkları, sohbetten örneklem
// Mesaj içerikleri sadece rapor anında okunur, hiçbir yere kaydedilmez.

import { e } from '../utils/emojis.js';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { db } from '../core/database.js';
import { getSetting } from '../core/settings.js';
import config from '../config.js';
import { sinceDay, serverStats, formatVoice } from './stats.js';

const DAY = 86_400_000;
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const INFO_CHANNEL_RE = /kural|duyuru|ba[gğ]lant|roller|sss|takviye|log|jail|talep/i;

const q = {
  rows: db.prepare('SELECT user_id, channel_id, day, count FROM msg_stats WHERE guild_id=? AND day>=?'),
  voiceUserIds: db.prepare('SELECT DISTINCT user_id FROM voice_stats WHERE guild_id=? AND day>=?'),
  channelSince: db.prepare('SELECT channel_id, SUM(count) n FROM msg_stats WHERE guild_id=? AND day>=? GROUP BY channel_id'),
  writers: db.prepare('SELECT DISTINCT user_id FROM msg_stats WHERE guild_id=?'),
  daily: db.prepare('SELECT day, SUM(count) n FROM msg_stats WHERE guild_id=? AND day>=? GROUP BY day'),
  tickets: db.prepare('SELECT category, COUNT(*) n FROM tickets WHERE guild_id=? AND created_at>=? GROUP BY category ORDER BY n DESC'),
  voiceUsers: db.prepare('SELECT COUNT(DISTINCT user_id) n FROM voice_stats WHERE guild_id=? AND day>=?'),
};

/** Üyelerin yazabildiği sohbet kanalları (bilgi/log kanalları hariç) */
function memberChannels(guild) {
  const memberRole = guild.roles.cache.get(getSetting(guild.id, 'member_role')) ?? guild.roles.everyone;
  return guild.channels.cache.filter(
    (c) => c.type === ChannelType.GuildText && !INFO_CHANNEL_RE.test(c.name) &&
      [guild.roles.everyone, memberRole].some((r) => c.permissionsFor(r)?.has([P.ViewChannel, P.SendMessages])),
  );
}

// ───────────────────────── 1) Metrikler + tespitler ─────────────────────────

/** Üyelerin GÖREBİLDİĞİ kanallar (yetkili/log kanalları topluluk metriklerine girmez) */
function communityChannelIds(guild) {
  const memberRole = guild.roles.cache.get(getSetting(guild.id, 'member_role')) ?? guild.roles.everyone;
  return new Set(
    guild.channels.cache
      .filter((c) => !c.isThread() && [guild.roles.everyone, memberRole].some((r) => c.permissionsFor(r)?.has(P.ViewChannel)))
      .map((c) => c.id),
  );
}

export function collectMetrics(guild) {
  const humans = guild.members.cache.filter((m) => !m.user.bot);
  const s30 = serverStats(guild.id, 30);
  const community = communityChannelIds(guild);

  // Topluluk kanallarına göre mesaj dağılımı (son 30 gün + önceki 7 gün karşılaştırması için 14 gün)
  const since7 = sinceDay(7);
  const since14 = sinceDay(14);
  const byUser = new Map();
  const byChannel = new Map();
  const weekday = Array(7).fill(0);
  let msgs30 = 0, msgs7 = 0, prev7 = 0, staffMsgs = 0;
  for (const r of q.rows.all(guild.id, sinceDay(30))) {
    const n = Number(r.count);
    if (!community.has(r.channel_id)) {
      staffMsgs += n;
      continue;
    }
    msgs30 += n;
    if (r.day >= since7) msgs7 += n;
    else if (r.day >= since14) prev7 += n;
    byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + n);
    byChannel.set(r.channel_id, (byChannel.get(r.channel_id) ?? 0) + n);
    weekday[new Date(`${r.day}T12:00:00Z`).getUTCDay()] += n;
  }
  const topUsers = [...byUser.entries()].sort((a, b) => b[1] - a[1]);
  const top3 = topUsers.slice(0, 3).reduce((a, [, n]) => a + n, 0);
  const activeUsers = new Set([...byUser.keys(), ...q.voiceUserIds.all(guild.id, sinceDay(30)).map((r) => r.user_id)]);

  const writers = new Set(q.writers.all(guild.id).map((r) => r.user_id));
  const newMembers = humans.filter((m) => m.joinedTimestamp > Date.now() - 30 * DAY);
  const silentNew = newMembers.filter((m) => !writers.has(m.id));

  const bestDay = weekday.indexOf(Math.max(...weekday));
  const peakHours = s30.hours.map((n, h) => ({ h, n })).sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.h).sort((a, b) => a - b);

  // Kanal aktivitesi (son 14 gün)
  const recent = new Map(q.channelSince.all(guild.id, sinceDay(14)).map((r) => [r.channel_id, Number(r.n)]));
  const channels = memberChannels(guild);
  const dead = channels.filter((c) => !recent.get(c.id) && Date.now() - c.createdTimestamp > 3 * DAY);
  const ticketCats = q.tickets.all(guild.id, Date.now() - 30 * DAY).map((r) => ({
    category: config.ticketCategories.find((c) => c.value === r.category)?.label ?? r.category,
    count: Number(r.n),
  }));

  return {
    uyeler: humans.size,
    mesaj_30g: msgs30,
    mesaj_7g: msgs7,
    mesaj_onceki_7g: prev7,
    yetkili_kanal_mesaji_30g: staffMsgs,
    aktif_uye_30g: activeUsers.size,
    aktif_orani: humans.size ? Math.round((activeUsers.size / humans.size) * 100) : 0,
    ilk3_payi: msgs30 ? Math.round((top3 / msgs30) * 100) : 0,
    ilk3: topUsers.slice(0, 3).map(([id]) => guild.members.cache.get(id)?.displayName ?? 'ayrılmış üye'),
    yeni_uye_30g: newMembers.size,
    hic_yazmayan_yeni: silentNew.size,
    hic_yazmayan_toplam: humans.filter((m) => !writers.has(m.id)).size,
    katilan_30g: s30.joins,
    ayrilan_30g: s30.leaves,
    ses_30g: formatVoice(s30.voiceSeconds),
    seste_bulunan_30g: Number(q.voiceUsers.get(guild.id, sinceDay(30)).n),
    en_iyi_gun: msgs30 ? WEEKDAYS[bestDay] : null,
    en_yogun_saatler: s30.messages ? peakHours.map((h) => `${String(h).padStart(2, '0')}:00`) : [],
    en_aktif_kanallar: [...byChannel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => `#${guild.channels.cache.get(id)?.name ?? '?'} (${n})`),
    olu_kanallar: dead.map((c) => `#${c.name}`),
    talepler_30g: ticketCats,
    minecraft_acik: Boolean(config.minecraft.host),
    bos_linkler: Object.entries(config.links).filter(([, v]) => !v).map(([k]) => k),
    veri_baslangici: s30.dataSince,
  };
}

/** Metriklerden kural tabanlı tespitler: { area, level, text } */
export function deriveFindings(m) {
  const out = [];
  const add = (area, level, text) => out.push({ area, level, text });

  if (m.mesaj_30g < 100) {
    add('Veri', 'info', `Topluluk kanallarında henüz az mesaj var (${m.mesaj_30g}; yetkili kanallarında ${m.yetkili_kanal_mesaji_30g}). Tespitler birkaç hafta sonra çok daha isabetli olacak.`);
  }
  if (m.mesaj_30g > 0 && m.yetkili_kanal_mesaji_30g > m.mesaj_30g * 3) {
    add('Etkileşim', 'warn', `Konuşmaların çoğu yetkili kanallarında (${m.yetkili_kanal_mesaji_30g}) dönüyor, topluluk kanallarında sadece ${m.mesaj_30g} mesaj var. Geliştirme sürecinin bir kısmını (güncellemeler, ekran görüntüleri, anketler) topluluğa açmak etkileşimi artırır.`);
  }

  if (m.ilk3_payi >= 60) add('Etkileşim', 'warn', `Mesajların **%${m.ilk3_payi}**'i sadece 3 kişiden (${m.ilk3.join(', ')}). Sohbet birkaç kişiye bağlı; diğer üyeleri konuşturacak sorular, anketler ve etkinlikler gerekli.`);
  if (m.aktif_orani < 40) add('Etkileşim', 'warn', `Üyelerin sadece **%${m.aktif_orani}**'i son 30 günde aktif (${m.aktif_uye_30g}/${m.uyeler}).`);

  if (m.yeni_uye_30g >= 3 && m.hic_yazmayan_yeni / m.yeni_uye_30g >= 0.5) {
    add('Yeni üyeler', 'warn', `Son 30 günde gelen ${m.yeni_uye_30g} kişiden **${m.hic_yazmayan_yeni}**'i hiç yazmadı. Karşılama akışı (tanışma kanalı, hoş geldin mesajında soru, yeni üyeyi etiketleyen sorumlu) güçlendirilmeli.`);
  }
  if (m.katilan_30g >= 3 && m.ayrilan_30g / m.katilan_30g >= 0.4) {
    add('Büyüme', 'warn', `Gelenlerin önemli kısmı ayrılıyor (${m.katilan_30g} katıldı, ${m.ayrilan_30g} ayrıldı). İlk izlenim ve kanal düzeni gözden geçirilmeli.`);
  }

  if (m.mesaj_onceki_7g > 20 && m.mesaj_7g < m.mesaj_onceki_7g * 0.7) {
    add('Trend', 'warn', `Bu hafta mesajlar **%${Math.round((1 - m.mesaj_7g / m.mesaj_onceki_7g) * 100)}** düştü (${m.mesaj_onceki_7g} → ${m.mesaj_7g}).`);
  } else if (m.mesaj_onceki_7g > 0 && m.mesaj_7g > m.mesaj_onceki_7g * 1.2) {
    add('Trend', 'good', `Bu hafta mesajlar **%${Math.round((m.mesaj_7g / m.mesaj_onceki_7g - 1) * 100)}** arttı. ${e('konfeti', '🎉')}`);
  }

  if (m.olu_kanallar.length) add('Kanallar', 'warn', `Son 14 günde hiç yazılmayan kanallar: ${m.olu_kanallar.join(', ')}. Birleştirilebilir, kaldırılabilir ya da bir etkinlikle canlandırılabilir.`);
  if (m.seste_bulunan_30g < 3) add('Ses', 'info', `Ses kanalları az kullanılıyor (son 30 günde ${m.seste_bulunan_30g} kişi, ${m.ses_30g}). Sesli oyun gecesi / geliştirme yayını gibi etkinlikler denenebilir.`);
  if (m.en_iyi_gun) add('Etkinlik zamanı', 'good', `En hareketli gün **${m.en_iyi_gun}**, en yoğun saatler **${m.en_yogun_saatler.join(', ')}**. Duyuru ve etkinlikleri bu zamanlara koy.`);

  if (!m.minecraft_acik) add('Minecraft', 'info', 'Minecraft sunucusu henüz açık değil / IP ayarlanmadı; açılış duyurusu ve test oyuncuları için kayıt toplanabilir.');
  if (m.bos_linkler.length) add('Website', 'info', `Eksik bağlantılar: ${m.bos_linkler.join(', ')}. Website ve sosyal medya linkleri hazır olunca #bağlantılar güncellenmeli.`);
  if (m.talepler_30g.length) add('Destek', 'info', `Son 30 günde en çok talep: ${m.talepler_30g.map((t) => `${t.category} (${t.count})`).join(', ')}.`);
  return out;
}

// ───────────────────────── 2) Topluluk sinyalleri ─────────────────────────

const clean = (text, max) =>
  (text ?? '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/<[@#&!]+\d+>/g, '@')
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

async function suggestions(guild) {
  const channel = guild.channels.cache.get(getSetting(guild.id, 'suggestion_channel'));
  if (!channel?.isTextBased()) return [];
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return [];
  const count = (m, ...names) => names.reduce((a, n) => a + Math.max(0, (m.reactions.cache.find((r) => r.emoji.name === n)?.count ?? 1) - 1), 0);
  const VOTE = ['👍', '👎', 'Karia_begeni', 'Karia_begenmeme'];
  // Sadece /oneri komutuyla gönderilmiş öneriler (kanaldaki duyuru/bilgi mesajları değil)
  return [...messages.values()]
    .filter((m) => m.author.id === guild.client.user.id && m.embeds[0]?.author?.name?.endsWith('önerdi'))
    .map((m) => ({
      text: clean(m.embeds[0]?.description || m.content, 220),
      up: count(m, '👍', 'Karia_begeni'),
      down: count(m, '👎', 'Karia_begenmeme'),
      other: m.reactions.cache.filter((r) => !VOTE.includes(r.emoji.name)).reduce((a, r) => a + r.count, 0),
    }))
    .filter((s) => s.text.length >= 10)
    .sort((a, b) => b.up - b.down + b.other - (a.up - a.down + a.other))
    .slice(0, 10);
}

async function forumTopics(guild) {
  const forums = guild.channels.cache.filter((c) => c.type === ChannelType.GuildForum);
  const active = await guild.channels.fetchActiveThreads().then((r) => r.threads).catch(() => null);
  const result = [];
  for (const forum of forums.values()) {
    const archived = await forum.threads.fetchArchived({ limit: 20 }).then((r) => r.threads).catch(() => null);
    const threads = [...(active?.filter((t) => t.parentId === forum.id).values() ?? []), ...(archived?.values() ?? [])];
    const tagName = (id) => forum.availableTags.find((t) => t.id === id)?.name;
    result.push({
      forum: forum.name,
      basliklar: threads.slice(0, 20).map((t) => {
        const tags = t.appliedTags.map(tagName).filter(Boolean);
        return `${clean(t.name, 90)}${tags.length ? ` [${tags.join(', ')}]` : ''} (${t.messageCount ?? 0} mesaj${t.archived ? ', kapalı' : ''})`;
      }),
    });
  }
  return result;
}

async function chatSample(guild, limit = 100) {
  const recent = new Map(q.channelSince.all(guild.id, sinceDay(14)).map((r) => [r.channel_id, Number(r.n)]));
  const channels = [...memberChannels(guild).values()].sort((a, b) => (recent.get(b.id) ?? 0) - (recent.get(a.id) ?? 0)).slice(0, 3);
  const lines = [];
  for (const channel of channels) {
    const messages = await channel.messages.fetch({ limit: 60 }).catch(() => null);
    if (!messages) continue;
    for (const m of [...messages.values()].reverse()) {
      if (m.author.bot || m.system) continue;
      const text = clean(m.content, 160);
      if (text.length < 8 || /^(kl\s|\/)/i.test(text)) continue;
      lines.push(`#${channel.name}: ${text}`);
    }
  }
  return lines.slice(-limit);
}

export async function collectSignals(guild) {
  const [oneriler, forumlar, sohbet] = await Promise.all([suggestions(guild), forumTopics(guild), chatSample(guild)]);
  return { oneriler, forumlar, sohbet };
}

export const LEVEL_EMOJI = {
  get warn() { return e('nokta_sari', '🟡'); },
  get info() { return e('bilgi', '🔵'); },
  get good() { return e('nokta_yesil', '🟢'); },
};
