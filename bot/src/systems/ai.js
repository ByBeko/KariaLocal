// Karia yapay zeka asistanı — Ollama üzerinde Qwen2.5.
// Sunucu bilgisi (kanallar, roller, kurallar, SSS, komutlar) sistem mesajında verilir;
// sayısal veriler için model araç (tool) çağırır: istatistik, sıralama, MC durumu, (yetkiliye) denetim.

import { ChannelType } from 'discord.js';
import config from '../config.js';
import { isStaffCommand } from './help.js';
import { getSetting } from '../core/settings.js';
import { isStaff, getLevel, LevelName } from '../utils/permissions.js';
import { UserError } from '../utils/errors.js';
import { serverStats, userStats, leaderboard, formatVoice, periodName } from './stats.js';
import { runAudit } from './audit.js';
import { getServerStatus, mcEnabled, mcIp } from './minecraft.js';
import { collectMetrics, deriveFindings, collectSignals } from './insights.js';
import { e, stripEmojis } from '../utils/emojis.js';
import { linkChannels } from './guide.js';
import { quickAnswer } from './quickAnswers.js';
import { FEATURES, STAFF_FEATURES } from '../aiKnowledge.js';

const { url: OLLAMA_URL, model: MODEL, userLimit } = config.ai;
const MAX_TOOL_ROUNDS = 4;
const NUM_CTX = 8192; // sunucu bilgisi ~2.5k token + araç sonuçları; ön yükleme ile aynı olmalı (yoksa model yeniden yüklenir)
const KEEP_ALIVE = '2h'; // model ekran kartında bu süre boyunca hazır bekler (ilk yükleme ~1 dk sürer)

/** Bot açılırken modeli ekran kartına önceden yükle; Ollama kapalıysa sessizce geç */
export async function warmUpAI() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({ model: MODEL, keep_alive: KEEP_ALIVE, options: { num_ctx: NUM_CTX } }),
      signal: AbortSignal.timeout(180_000),
    });
    console.log(res.ok ? `✔ Yapay zeka hazır (${MODEL})` : `⚠ Yapay zeka modeli yüklenemedi (${MODEL}): ${res.status}`);
  } catch {
    console.warn('⚠ Ollama çalışmıyor; yapay zeka sohbeti kapalı kalacak.');
  }
}

// ───────────────────────── Sunucu bilgisi ─────────────────────────

const contextCache = new Map(); // guildId -> { at, text }
const isSeparator = (name) => /-{3,}|・-/.test(name);

async function channelText(channel, maxChars) {
  if (!channel?.isTextBased()) return '';
  const messages = await channel.messages.fetch({ limit: 15 }).catch(() => null);
  if (!messages) return '';
  const parts = [...messages.values()].reverse().map((m) =>
    [m.content, ...m.embeds.flatMap((e) => [e.title, e.description, ...e.fields.map((f) => `${f.name}: ${f.value}`)])]
      .filter(Boolean)
      .join('\n'),
  );
  return parts.join('\n').slice(0, maxChars);
}

export async function serverContext(guild) {
  const cached = contextCache.get(guild.id);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.text;

  const lines = [];
  lines.push(`Sunucu: ${guild.name} | Üye sayısı: ${guild.memberCount} | Kuruluş: ${guild.createdAt.toLocaleDateString('tr-TR')} | Takviye: seviye ${guild.premiumTier}, ${guild.premiumSubscriptionCount} takviye`);
  if (guild.description) lines.push(`Açıklama: ${guild.description}`);
  lines.push('Karia; bir Discord topluluğu, geliştirilen bir Discord botu (Karia bot), bir Minecraft sunucusu ve bir websiteden oluşan bir projedir.');

  // Kanallar (kategorilere göre, gizli kanallar hariç: @everyone göremiyorsa ve log/talep kanalıysa atla)
  lines.push('\n## Kanallar');
  const visible = (c) => c.permissionsFor(guild.roles.everyone)?.has('ViewChannel') || c.permissionsFor(guild.roles.cache.get(getSetting(guild.id, 'member_role')) ?? guild.roles.everyone)?.has('ViewChannel');
  const describe = (c) => {
    const type = { [ChannelType.GuildVoice]: 'ses', [ChannelType.GuildForum]: 'forum', [ChannelType.GuildAnnouncement]: 'duyuru' }[c.type] ?? 'yazı';
    return `- #${c.name} (${type})${c.topic ? ` — ${c.topic.slice(0, 120)}` : ''}`;
  };
  const categories = guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  for (const c of guild.channels.cache.filter((c) => !c.parentId && c.type !== ChannelType.GuildCategory && visible(c)).values()) lines.push(describe(c));
  for (const cat of categories.values()) {
    const children = cat.children.cache.filter(visible).sort((a, b) => a.position - b.position);
    if (!children.size) continue;
    lines.push(`Kategori "${cat.name}":`);
    for (const c of children.values()) lines.push(`  ${describe(c)}`);
  }

  // Roller
  const roleName = (key) => guild.roles.cache.get(getSetting(guild.id, key))?.name;
  lines.push('\n## Roller');
  lines.push(`Yetkili rolleri: Yönetici = ${roleName('admin_role') ?? '-'}, Moderatör = ${roleName('mod_role') ?? '-'}, Personel = ${roleName('staff_role') ?? '-'}. Yeni üyeler otomatik "${roleName('member_role') ?? '-'}" rolü alır.`);
  const roles = guild.roles.cache
    .filter((r) => !r.managed && r.id !== guild.id && !isSeparator(r.name))
    .sort((a, b) => b.position - a.position)
    .map((r) => `${r.name} (${r.members.size})`);
  lines.push(`Tüm roller (kişi sayısı): ${roles.join(', ')}`);

  // Linkler, Minecraft
  lines.push('\n## Bağlantılar');
  for (const [k, v] of Object.entries(config.links)) if (v) lines.push(`- ${k}: ${v}`);
  const missingLinks = Object.entries(config.links).filter(([, v]) => !v).map(([k]) => k);
  if (missingLinks.length) lines.push(`- Henüz eklenmemiş, asla adres uydurma: ${missingLinks.join(', ')}`);
  const boosters = guild.members.cache.filter((m) => m.premiumSince).map((m) => m.displayName);
  if (boosters.length) lines.push(`- Takviye yapanlar: ${boosters.join(', ')}`);
  // IP yoksa hiç yazılmaz: "sunucu kapalı" bilgisi küçük modeli genel Minecraft sorularında yanıltıyordu
  if (mcEnabled) lines.push(`- Karia Minecraft sunucu IP: ${mcIp}${config.minecraft.version ? ` (sürüm ${config.minecraft.version})` : ''}`);
  else lines.push('- Karia Minecraft sunucu IP: henüz duyurulmadı');

  // Kurallar ve SSS kanallarının içeriği
  const rulesId = getSetting(guild.id, 'rules_channel');
  const rules = await channelText(guild.channels.cache.get(rulesId), 3000);
  if (rules) lines.push(`\n## Kurallar (#${guild.channels.cache.get(rulesId).name} kanalından)\n${rules}`);
  const faqChannel = guild.channels.cache.find((c) => c.isTextBased() && /sss|faq/i.test(c.name));
  const faq = await channelText(faqChannel, 2000);
  if (faq) lines.push(`\n## SSS (#${faqChannel.name} kanalından)\n${faq}`);

  // Bot komutları
  lines.push(`\n## Karia bot komutları (/komut ya da "kari komut", "kl komut", "k komut" şeklinde kullanılır)`);
  // Sadece üye komutları; yetkili komutları askAI içinde sadece yetkililere eklenir
  for (const cmd of guild.client.commands.values()) {
    if (!isStaffCommand(cmd)) lines.push(`- /${cmd.data.name}: ${cmd.data.description}`);
  }
  lines.push('\n## Karia özellikleri (nasıl yapılır sorularında bunlara dayan)');
  for (const feature of FEATURES) lines.push(`- ${feature}`);

  const text = lines.join('\n');
  contextCache.set(guild.id, { at: Date.now(), text });
  return text;
}

// ───────────────────────── Araçlar ─────────────────────────

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});
const GUN = { type: 'integer', description: 'Kaç günlük veri: 1 (bugün), 7, 30 veya 0 (tüm zamanlar). Belirtilmezse 7.' };

const PUBLIC_TOOLS = [
  fn('sunucu_istatistikleri', 'Sunucunun toplam mesaj, ses süresi, aktif üye, katılan/ayrılan sayıları, en aktif üyeler ve kanallar, en yoğun saatler.', { gun: GUN }),
  fn('uye_istatistikleri', 'Bir üyenin mesaj sayısı, ses süresi, sıralaması ve en aktif olduğu kanallar.', {
    kullanici: { type: 'string', description: 'Üyenin adı, takma adı veya ID\'si. Soran kişinin kendisi için "ben" yaz.' },
    gun: GUN,
  }, ['kullanici']),
  fn('siralama', 'En aktif üyeler sıralaması.', { tur: { type: 'string', enum: ['mesaj', 'ses'], description: 'mesaj veya ses' }, gun: GUN }),
  fn('minecraft_durumu', 'Minecraft sunucusunun açık olup olmadığı, oyuncu sayısı ve IP adresi.'),
];
const STAFF_TOOLS = [
  fn('sunucu_denetimi', 'Güvenlik ve yapı denetimi: tehlikeli izinler, rol/kanal sorunları, eksik ayarlar ve öneriler. Sadece yetkililer için.'),
  fn('gelisim_tespitleri', 'Sunucunun gelişimi için tespitler: etkileşim dağılımı, yeni üyelerin katılımı, ölü kanallar, büyüme, en iyi etkinlik zamanı, #oy-ver önerileri. "Ne geliştirmeliyiz", "nasıl büyürüz" gibi sorularda kullan.'),
];

function findMember(guild, query, asker) {
  const text = String(query ?? '').trim().toLocaleLowerCase('tr');
  if (!text || ['ben', 'kendim', 'benim', 'me'].includes(text)) return asker;
  const id = text.match(/\d{17,20}/)?.[0];
  if (id) return guild.members.cache.get(id) ?? null;
  const members = [...guild.members.cache.values()].filter((m) => !m.user.bot);
  const names = (m) => [m.displayName, m.user.username, m.user.globalName].filter(Boolean).map((n) => n.toLocaleLowerCase('tr'));
  return members.find((m) => names(m).includes(text)) ?? members.find((m) => names(m).some((n) => n.includes(text))) ?? null;
}

const nameOf = (guild, userId) => guild.members.cache.get(userId)?.displayName ?? 'ayrılmış üye';
const channelName = (guild, id) => `#${guild.channels.cache.get(id)?.name ?? 'silinmiş-kanal'}`;
const normDays = (d) => ([0, 1, 7, 30].includes(Number(d)) ? Number(d) : 7);

async function runTool(name, args, { guild, member }) {
  switch (name) {
    case 'sunucu_istatistikleri': {
      const days = normDays(args.gun);
      const s = serverStats(guild.id, days);
      return {
        donem: periodName(days),
        mesaj: s.messages,
        onceki_donem_mesaj: s.previousMessages,
        ses: formatVoice(s.voiceSeconds),
        aktif_uye: s.activeUsers,
        toplam_uye: guild.members.cache.filter((m) => !m.user.bot).size,
        katilan: s.joins,
        ayrilan: s.leaves,
        en_cok_yazanlar: s.topUsers.map((u) => `${nameOf(guild, u.userId)}: ${u.value}`),
        en_cok_seste: s.topVoiceUsers.map((u) => `${nameOf(guild, u.userId)}: ${formatVoice(u.value)}`),
        en_aktif_kanallar: s.topChannels.slice(0, 5).map((c) => `${channelName(guild, c.channelId)}: ${c.messages}`),
        en_yogun_saat: `${s.hours.indexOf(Math.max(...s.hours))}:00`,
        veri_baslangici: s.dataSince,
      };
    }
    case 'uye_istatistikleri': {
      const target = findMember(guild, args.kullanici, member);
      if (!target) return { hata: `"${args.kullanici}" adında bir üye bulunamadı.` };
      const days = normDays(args.gun);
      const s = userStats(guild.id, target.id, days);
      return {
        uye: target.displayName,
        donem: periodName(days),
        mesaj: s.messages,
        mesaj_sirasi: s.messageRank ? `${s.messageRank.rank}/${s.messageRank.of}` : null,
        ses: formatVoice(s.voiceSeconds),
        ses_sirasi: s.voiceRank ? `${s.voiceRank.rank}/${s.voiceRank.of}` : null,
        aktif_gun: s.activeDays,
        en_cok_yazdigi_kanallar: s.topChannels.map((c) => `${channelName(guild, c.channelId)}: ${c.messages}`),
        katilma: target.joinedAt?.toLocaleDateString('tr-TR'),
        roller: target.roles.cache.filter((r) => r.id !== guild.id && !isSeparator(r.name)).map((r) => r.name),
      };
    }
    case 'siralama': {
      const type = args.tur === 'ses' ? 'ses' : 'mesaj';
      const days = normDays(args.gun);
      return {
        tur: type,
        donem: periodName(days),
        siralama: leaderboard(guild.id, type, days, 10).map(
          (r, i) => `${i + 1}. ${nameOf(guild, r.userId)}: ${type === 'ses' ? formatVoice(r.value) : r.value}`,
        ),
      };
    }
    case 'minecraft_durumu': {
      if (!mcEnabled) return { durum: 'Minecraft sunucusunun IP adresi henüz ayarlanmadı / duyurulmadı.' };
      const s = await getServerStatus();
      return s.online ? { ip: mcIp, durum: 'açık', oyuncu: `${s.players}/${s.max}`, surum: s.version } : { ip: mcIp, durum: 'kapalı' };
    }
    case 'sunucu_denetimi': {
      if (!isStaff(member)) return { hata: 'Bu bilgi sadece yetkililere açık.' };
      const { score, findings } = runAudit(guild);
      const fixHint = { 'uye-rolu': ' Çözüm: /denetim komutunu çalıştırıp çıkan "Eksik üye rollerini ver" butonuna bas.' };
      return {
        puan: `${score}/100`,
        bulgular: findings.map((f) => `[${f.severity}] ${f.title}: ${f.detail.replace('Aşağıdaki butonla hepsine verebilirsin.', '')}${fixHint[f.fix] ?? ''}`.replace(/<[@#&]+\d+>/g, '')),
        not: 'Sadece burada adı geçen komutları öner; sunucu ayarları için "Sunucu Ayarları → ..." yolunu yaz.',
      };
    }
    case 'gelisim_tespitleri': {
      if (!isStaff(member)) return { hata: 'Bu bilgi sadece yetkililere açık.' };
      const metrics = collectMetrics(guild);
      const signals = await collectSignals(guild);
      return {
        tespitler: deriveFindings(metrics).map((f) => `[${f.area}] ${f.text.replace(/\*\*/g, '')}`),
        en_cok_oy_alan_oneriler: signals.oneriler.slice(0, 5).map((s) => `(${s.up}👍 ${s.down}👎) ${s.text}`),
        forum_basliklari: signals.forumlar.map((f) => `${f.forum}: ${f.basliklar.slice(0, 8).join(' | ')}`),
        not: 'Detaylı plan için /gelisim komutunu öner.',
      };
    }
    default:
      return { hata: `Bilinmeyen araç: ${name}` };
  }
}

// ───────────────────────── Ollama ─────────────────────────

async function chat(messages, tools, extraOptions = {}) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools,
        stream: false,
        think: false, // Qwen3.5 düşünme modunu kapat: Discord için hızlı ve kısa cevap
        keep_alive: KEEP_ALIVE,
        options: { temperature: 0.3, num_ctx: NUM_CTX, ...extraOptions },
      }),
      signal: AbortSignal.timeout(240_000),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new UserError('Yapay zeka çok uzun sürdü, daha kısa bir soru dene.');
    throw new UserError('Yapay zeka şu an kapalı (Ollama çalışmıyor). Yetkililere haber ver.');
  }
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404) throw new UserError(`Yapay zeka modeli yüklü değil. Bot sahibi şunu çalıştırmalı: \`ollama pull ${MODEL}\``);
    throw new Error(`Ollama ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()).message;
}

// Yerel GPU tek seferde tek soruya bakar: istekler sıraya girer
let queue = Promise.resolve();
let waiting = 0;
function enqueue(task) {
  waiting++;
  const run = queue.then(task, task).finally(() => waiting--);
  queue = run.catch(() => {});
  return run;
}
export const queueLength = () => waiting;

/** Araçsız tek seferlik üretim (raporlar için) */
export function generateText(system, prompt, { maxTokens = 1400 } = {}) {
  return enqueue(async () => {
    const reply = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      undefined,
      { num_predict: maxTokens },
    );
    return (reply.content ?? '').trim();
  });
}

/** Gelişim planı: tespitler + topluluk sinyallerinden alan alan öneriler */
export async function developmentPlan(guild, metrics, findings, signals) {
  const system = [
    `Sen "${guild.name}" için bir topluluk büyütme ve ürün geliştirme danışmanısın.`,
    'Karia; bir Discord topluluğu, geliştirilen bir Discord botu, bir Minecraft sunucusu ve bir websiteden oluşur.',
    'Görevin: aşağıdaki VERİLERE dayanarak neyin geliştirilmesi gerektiğini önceliklendirmek.',
    'Kurallar:',
    '- Türkçe yaz. Her öneri somut ve uygulanabilir olsun.',
    '- Bir maddenin dayanağı VERİLER bölümünde açıkça varsa, maddenin sonuna kısa bir parantezle yaz: "(dayanak: ...)". Sayıları VERİLER\'den birebir al ama düz Türkçe yaz (değişken adı yazma; "minecraft_acik: false" değil "Minecraft sunucusu henüz açık değil"). Her sayının neyi ölçtüğüne dikkat et, farklı metrikleri karıştırma. Dayanağı yoksa parantez ekleme; asla sayı, oy veya öneri uydurma.',
    '- #oy-ver önerilerini sadece gerçekten o konuyla ilgiliyse dayanak göster.',
    '- Bir alan için veri yoksa o başlıkta kısaca "Henüz yeterli veri yok" yaz ve veri toplamak için tek bir öneri ver.',
    '- Kişileri kötüleme, isim vererek eleştirme.',
    '- Toplam en fazla 2500 karakter. Tam olarak şu başlıkları kullan, her başlık altında en fazla 3 kısa madde:',
    '**Öncelikli 3 adım**',
    '**Discord topluluğu**',
    '**Karia bot**',
    '**Minecraft**',
    '**Website**',
    'Başlıklarda ve maddelerde emoji kullanma.',
  ].join('\n');

  const prompt = [
    '# VERİLER',
    '## Metrikler (mesaj sayıları sadece üyelerin görebildiği kanallardan; yetkili kanalları ayrı)',
    JSON.stringify(metrics),
    '',
    '## Kural tabanlı tespitler',
    ...findings.map((f) => `- [${f.area}] ${f.text.replace(/\*\*/g, '')}`),
    '',
    '## #oy-ver önerileri (oy sırasına göre)',
    ...(signals.oneriler.length ? signals.oneriler.map((s) => `- (${s.up}👍 ${s.down}👎) ${s.text}`) : ['- henüz öneri yok']),
    '',
    '## Forum başlıkları',
    ...(signals.forumlar.length ? signals.forumlar.map((f) => `### ${f.forum}\n${f.basliklar.map((b) => `- ${b}`).join('\n') || '- başlık yok'}`) : ['- forum yok']),
    '',
    '## Son sohbetlerden örneklem (konuları çıkarmak için)',
    ...(signals.sohbet.length ? signals.sohbet : ['- sohbet verisi yok']),
  ].join('\n');

  return generateText(system, prompt, { maxTokens: 1400 });
}

const usage = new Map(); // userId -> [zaman damgaları]
function checkRateLimit(member) {
  if (isStaff(member)) return;
  const now = Date.now();
  const recent = (usage.get(member.id) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= userLimit) {
    throw new UserError(`Çok fazla soru sordun. <t:${Math.floor((recent[0] + 10 * 60_000) / 1000)}:R> tekrar deneyebilirsin.`);
  }
  usage.set(member.id, [...recent, now]);
}

function staffCommandLines(guild, member) {
  return [...guild.client.commands.values()]
    .filter((c) => isStaffCommand(c) && Math.max(c.level ?? 1, 1) <= getLevel(member))
    .map((c) => `- /${c.data.name} [${LevelName[Math.max(c.level ?? 1, 1)]}+]: ${c.data.description}`);
}

// ───────────────────────── Güvenlik ─────────────────────────

const REFUSAL = () =>
  `${e('kalkan', '🙅')} Bu konuda yardımcı olamam; yasa dışı ya da zarar verebilecek isteklere cevap vermiyorum.`;
const CRISIS = () =>
  `${e('kalp2', '💙')} Bunu yazdığın için teşekkür ederim, yalnız değilsin. Lütfen güvendiğin biriyle konuş ya da hemen **112**\'yi ara. Sunucuda bir yetkiliyle de konuşabilirsin; seni dinlemeye hazırız.`;

/**
 * Mesajı ana cevaptan önce kısa bir sınıflandırmadan geçirir.
 * Dönen: 'ok' | 'illegal' | 'selfharm'
 */
async function safetyCheck(text) {
  const reply = await chat(
    [
      {
        role: 'system',
        content: [
          'Bir Discord sohbet botu için içerik denetçisisin. Kullanıcı mesajını sınıflandır ve SADECE tek kelime yaz: TAMAM, YASADISI ya da KRIZ.',
          'YASADISI: yasa dışı ya da ciddi zarar verecek bir şey için yardım/tarif istemek. Örn: uyuşturucu yapımı/satın alma, silah/patlayıcı yapımı,',
          'başkasının hesabını/bilgisayarını hackleme, şifre çalma, dolandırıcılık, kart bilgisi, korsan/crack/hile satın alma, birinin adresini/kişisel bilgisini bulma,',
          'cinsel içerik, reşit olmayanlarla ilgili cinsel her şey, nefret söylemi, birine zarar verme, ölüm tehdidi.',
          'KRIZ: kişinin kendine zarar vermek ya da intihar düşüncesinden bahsetmesi.',
          'TAMAM: diğer her şey. Oyun içi şeyler (Minecraft\'ta TNT, kılıç, savaş), tarih/haber sormak, güvenlik önlemi sormak (hesabımı nasıl korurum),',
          'şaka, küfürsüz sohbet, ders, müzik, kod yazma her zaman TAMAM.',
        ].join('\n'),
      },
      { role: 'user', content: text.slice(0, 1500) },
    ],
    undefined,
    { temperature: 0, num_predict: 4 }, // num_ctx değiştirilmez: farklı olursa model ekran kartına yeniden yüklenir
  ).catch(() => null);
  const verdict = (reply?.content ?? '').toUpperCase();
  if (verdict.includes('KRIZ')) return 'selfharm';
  if (verdict.includes('YASADI')) return 'illegal';
  return 'ok';
}

// ───────────────────────── Sohbet hafızası ─────────────────────────

const HISTORY_TURNS = 4; // son 4 soru-cevap hatırlanır
const HISTORY_TTL = 15 * 60_000;
const histories = new Map(); // "kanal:kullanıcı" -> { at, messages }

function getHistory(key) {
  const h = histories.get(key);
  if (!h || Date.now() - h.at > HISTORY_TTL) return [];
  return h.messages;
}
function remember(key, question, answer) {
  const messages = [...getHistory(key), { role: 'user', content: question }, { role: 'assistant', content: answer }].slice(-HISTORY_TURNS * 2);
  histories.set(key, { at: Date.now(), messages });
  if (histories.size > 500) for (const [k, v] of histories) if (Date.now() - v.at > HISTORY_TTL) histories.delete(k);
}

/**
 * Soruyu yanıtlar. Dönen metin Discord'a gönderilmeye hazırdır.
 * historyKey verilirse aynı kanaldaki son konuşma hatırlanır (sohbet modu).
 */
export async function askAI(guild, member, question, { historyKey = null } = {}) {
  checkRateLimit(member);
  const staff = isStaff(member);
  const context = await serverContext(guild);
  const today = new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'full' });

  const system = [
    `Sen "${guild.name}" Discord sunucusunun yapay zekası Karia'sın. Sunucu ve genel konulardaki sorulara cevap verirsin.`,
    'Cevap biçimi (EN ÖNEMLİ):',
    '- SADECE sorulan şeyin cevabını yaz. Selamlama ("Selam", "Merhaba X"), kişiye isimle hitap, "harika soru", "umarım yardımcı olmuştur", "başka sorun var mı", "bir şey olursa yaz", öneri/teklif, alakasız ek bilgi ve emoji süsü YAZMA.',
    '- Cevabın sonunda karşı soru sorma ve sohbeti uzatma.',
    '- TEK İSTİSNA: Soru belirsizse ya da doğru cevap için gereken bir bilgi eksikse cevap yerine, sadece o konuyla ilgili TEK bir kısa netleştirici soru sor (örn. "Hangi sürümde oynuyorsun?"). Cevap verebiliyorsan soru sorma.',
    '- Kısa bir selam/sohbet mesajına ("naber", "selam") sadece kısa ve uygun bir karşılık ver ("selam" → "Selam!", "naber" → "İyiyim, teşekkürler."). İsim kullanma, yardım teklif etme, soru sorma.',
    '- SUNUCU BİLGİSİ\'ni sadece soru Karia sunucusu/botu ile ilgiliyse kullan. Genel sorularda (oyun/film önerisi, ders, genel Minecraft bilgisi) sunucudan hiç bahsetme.',
    'Örnek soru → cevaplar (biçimi örnek al, içeriği kopyalama):',
    '- "selam" → "Selam!"',
    '- "naber" → "İyiyim, teşekkürler."',
    '- "modu nasıl kurarım" → "Hangi oyun ve hangi mod için?" (bilgi eksik: tek soru)',
    '- (önceki soruya cevap olarak gelen ek bilgi) → Artık bilgi tamam: cevabı numaralı adımlarla yazar, sonuna soru eklemez.',
    '- "bana bir film öner" → "Interstellar (2014) — bilim kurgu, uzay yolculuğu." (bilgi eksik değil: soru sormadan önerir)',
    '- "ödevim için şiir yaz" → "Şiir ne hakkında olsun?" (konu bilinmeden yazılamaz: tek soru)',
    '- "texture pack nasıl yüklenir" → "1. Paketin .zip dosyasını indir. 2. Minecraft\'ta Seçenekler → Kaynak Paketleri → Paket Klasörünü Aç. 3. Dosyayı klasöre at, listeden seçip etkinleştir." (genel Minecraft bilgisi: sunucudan bahsetmez)',
    '- Minecraft OYUNUNUN kendisiyle ilgili sorular (madenler, elmas katmanı, tarifler, moblar, modlar, texture/kaynak paketleri, shader\'lar, sürümler, performans ayarları) genel bilgidir: Karia sunucusunun açık olup olmamasından bağımsız olarak genel bilginle cevapla.',
    'Kurallar:',
    '- Her zaman Türkçe yanıt ver. Sade ve net yaz. Kısa tut (çoğunlukla 1-5 satır); uzun açıklama istenirse uzatabilirsin. Adım gerekiyorsa numaralı liste kullan.',
    '- Karia sunucusuyla ilgili sorularda (kurallar, kanallar, komutlar, Karia\'nın Minecraft IP\'si, istatistikler) SADECE aşağıdaki SUNUCU BİLGİSİ\'ne ve araç sonuçlarına dayan. Bilmiyorsan "bunu bilmiyorum, yetkililere sorabilirsin" de.',
    '- Mesaj sayısı, ses süresi, sıralama, oyuncu sayısı gibi her sayısal bilgi için önce ilgili aracı çağır.',
    '- Genel sohbette (oyunlar, Minecraft taktikleri, müzik, ders, kod, günlük konular) genel bilgini kullanabilirsin; emin olmadığın bilgiyi uydurma.',
    '- Yasa dışı ya da zarar verecek bir şeyi YAPMAK için tarif istenirse (uyuşturucu, silah/patlayıcı, başkasını hackleme, dolandırıcılık, korsan/crack, kişisel bilgi bulma, cinsel içerik, nefret söylemi, şiddet) yardım etme; kısaca reddet.',
    '- Ama korunma/güvenlik soruları (hesabımı nasıl korurum, 2FA, dolandırıcılardan nasıl korunurum), oyun içi şeyler (Minecraft TNT, PvP), tarih ve haber soruları zararsızdır: bunlara normal ve yardımcı cevap ver.',
    '- Kimseye hakaret etme, küfür etme, siyasi/dini tartışmalarda taraf tutma. Kendini Karia olarak tanıt; hangi modelden geldiğini sorarlarsa "Karia ekibinin botuyum" de.',
    '- Komut önerirken `/komut` biçimini kullan. Kanalları #kanal-adı şeklinde yaz.',
    `- Karia'nın yönetici asistanısın. Botun ve sunucunun sahibi ${config.owner.name}. Sahibi ya da yetkililer sunucuda olmasa bile Karia ile ilgili her konuda üyeye yardım et: ne yapması gerektiğini adım adım söyle, çözemiyorsan destek talebine yönlendir. Ceza verme, rol değiştirme gibi işlemleri kendin yaptığını asla söyleme; bunları yetkililer komutla yapar.`,
    '- Rehber gibi davran: Kişi Karia ile ilgili bir sorun yaşıyorsa, destek istiyorsa, yetkiliye ulaşmak ya da şikayet etmek istiyorsa #destek-talebi kanalına yönlendir. Bir şeyin nerede olduğunu soruyorsa SUNUCU BİLGİSİ\'ndeki ilgili kanalı söyle.',
    '- @everyone veya @here yazma. Şifre, token, kişisel bilgi isteme.',
    staff
      ? `- Konuştuğun kişi yetkili (${LevelName[getLevel(member)]}). Denetim aracını kullanabilir, yönetim ve büyüme önerileri verebilirsin.`
      : '- Konuştuğun kişi normal üye. Yetkili/güvenlik detaylarını ve denetim sonuçlarını paylaşma.',
    `Soran kişinin adı ${member.displayName} (sadece sorulursa kullan, cevapta hitap etme). Bugün: ${today}.`,
    '',
    '=== SUNUCU BİLGİSİ ===',
    context,
    ...(staff ? ['', '## Yetkili komutları (sadece yetkililere söyle)', ...staffCommandLines(guild, member), ...STAFF_FEATURES.map((f) => `- ${f}`)] : []),
  ].join('\n');

  const tools = staff ? [...PUBLIC_TOOLS, ...STAFF_TOOLS] : PUBLIC_TOOLS;
  const messages = [{ role: 'system', content: system }, ...(historyKey ? getHistory(historyKey) : []), { role: 'user', content: question }];

  return enqueue(async () => {
    const verdict = await safetyCheck(question);
    if (verdict === 'illegal') return REFUSAL();
    if (verdict === 'selfharm') return CRISIS();

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const reply = await chat(messages, round < MAX_TOOL_ROUNDS ? tools : undefined);
      messages.push(reply);
      if (!reply.tool_calls?.length) {
        const answer = (reply.content ?? '').trim() || 'Buna bir yanıt üretemedim, farklı sormayı dener misin?';
        if (historyKey) remember(historyKey, question, answer);
        return linkChannels(guild, stripEmojis(answer));
      }

      for (const call of reply.tool_calls) {
        const name = call.function?.name;
        let args = call.function?.arguments ?? {};
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }
        const result = await runTool(name, args, { guild, member }).catch((e) => ({ hata: e.message }));
        messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(result) });
      }
    }
    return 'Yanıt üretilemedi.';
  });
}

export const aiModelName = MODEL;

const aiMessages = new Set(); // botun yapay zeka cevapları: bunlara yanıt verilince sohbet devam eder
export function markAIMessage(id) {
  aiMessages.add(id);
  if (aiMessages.size > 2000) aiMessages.delete(aiMessages.values().next().value);
}

/** Mesaja yapay zeka cevabı verir (prefix sohbeti, etiketleme ve yanıt zinciri ortak kullanır) */
export async function chatWithAI(message, text) {
  const question = text.trim();
  if (!question) {
    await message
      .reply({
        content: `${e('mesaj', '👋')} Selam! Benimle sohbet etmek için \`kari <mesajın>\` yaz ya da beni etiketle. Komutlar için \`kari yardim\`.`,
        allowedMentions: { repliedUser: false },
      })
      .catch(() => {});
    return;
  }

  await message.channel.sendTyping().catch(() => {});
  const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8_000);
  try {
    const known = await quickAnswer(message.guild, question);
    if (known) {
      await message.reply({ content: known, allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    const answer = await askAI(message.guild, message.member, question.slice(0, 1500), { historyKey: `${message.channelId}:${message.author.id}` });
    const sent = await message.reply({ content: answer.slice(0, 2000), allowedMentions: { parse: [], repliedUser: false } });
    markAIMessage(sent.id);
  } catch (error) {
    const msg = error instanceof UserError ? error.message : 'Yapay zekada bir hata oldu.';
    if (!(error instanceof UserError)) console.error('[AI sohbet]', error);
    await message.reply({ content: `${e('carpi', '❌')} ${msg}`, allowedMentions: { repliedUser: false } }).catch(() => {});
  } finally {
    clearInterval(typing);
  }
}

/** "@Karia mesaj" ya da botun yapay zeka cevabına yanıt verilince sohbet eder */
export async function handleMention(message) {
  const me = message.client.user;
  if (message.mentions.everyone) return false;
  const explicit = new RegExp(`<@!?${me.id}>`).test(message.content);
  const replyToAI = message.reference?.messageId && aiMessages.has(message.reference.messageId);
  // Botun başka mesajlarına (seviye tebriği, müzik paneli...) yanıt verilince otomatik gelen etiket sayılmaz
  if (!explicit && !replyToAI) return false;
  await chatWithAI(message, message.content.replace(new RegExp(`<@!?${me.id}>`, 'g'), ''));
  return true;
}
