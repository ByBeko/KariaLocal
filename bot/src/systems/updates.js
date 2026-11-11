// Haftalık güncelleme: her alanın kendi forumunda tek başlığı vardır, her Pazar aynı başlığa yazılır.
import { ChannelType } from 'discord.js';
import changelog from '../changelog.js';
import { getSetting, setSetting } from '../core/settings.js';
import { e } from '../utils/emojis.js';
import { ruleText, splitText } from '../utils/style.js';
import { commandRefs } from '../utils/commandRefs.js';
import { findGuideChannel } from './guide.js';

const DAY = 86_400_000;
const AREAS = [
  { id: 'bot', forum: 'karia-local', thread: 'Karia Local Güncellemeleri', label: 'Karia Local', suffix: '' },
  { id: 'minecraft', forum: 'minecraft', thread: 'Minecraft Güncellemeleri', label: 'Karia Minecraft', suffix: '_minecraft' },
  { id: 'website', forum: 'website', thread: 'Website Güncellemeleri', label: 'karia.live', suffix: '_website' },
];
export const UPDATE_AREAS = AREAS.map((a) => ({ name: a.label, value: a.id }));

let busy = false;
let retryAt = 0;

/** Bir sonraki Pazar 20:00 (Türkiye, UTC+3); en az 5 gün sonrası */
function nextSlot(from) {
  const slot = new Date(from);
  slot.setUTCHours(17, 0, 0, 0);
  slot.setUTCDate(slot.getUTCDate() + ((7 - slot.getUTCDay()) % 7));
  while (slot.getTime() - from < 5 * DAY) slot.setUTCDate(slot.getUTCDate() + 7);
  return slot.getTime();
}

function supportNote(guild) {
  const support = findGuideChannel(guild, 'destek');
  return support ? `Bir hata bulursan <#${support.id}> kanalından bize bildirebilirsin.` : undefined;
}

async function createThread(guild, area) {
  const forum = findGuideChannel(guild, area.forum);
  if (forum?.type !== ChannelType.GuildForum) throw new Error(`#${area.forum} forumu bulunamadı`);
  const tag = forum.availableTags.find((t) => /g[uü]ncelleme/i.test(t.name));
  const thread = await forum.threads.create({
    name: area.thread,
    autoArchiveDuration: 10080,
    appliedTags: tag ? [tag.id] : [],
    message: {
      allowedMentions: { parse: [] },
      content: ruleText({
        icon: e('roket', '🚀'),
        title: area.thread,
        intro: `${area.label} tarafında yapılan tüm değişiklikler bu başlıkta paylaşılır.`,
        sections: [
          { icon: e('kumsaati', '⏳'), title: 'Ne Zaman Paylaşılır?', body: 'Her **Pazar 20:00** saatinde o haftanın güncelleme yazısı buraya eklenir.' },
        ],
        note: supportNote(guild),
      }),
    },
  });
  setSetting(guild.id, `update_thread${area.suffix}`, thread.id);
  return thread;
}

async function getThread(guild, area) {
  const id = getSetting(guild.id, `update_thread${area.suffix}`);
  const thread = id && (await guild.channels.fetch(id).catch(() => null));
  if (!thread) return createThread(guild, area);
  if (thread.archived) await thread.setArchived(false, 'Haftalık güncelleme');
  return thread;
}

const pendingNotes = (guildId, area) => JSON.parse(getSetting(guildId, `update_notes${area.suffix}`) ?? '[]');
const findArea = (id) => AREAS.find((a) => a.id === id) ?? AREAS[0];

/** /guncelleme-ekle: maddeyi seçilen alanın sıradaki yazısına ekler, bekleyen madde sayısını döner. */
export function addUpdateNote(guildId, note, areaId = 'bot') {
  const area = findArea(areaId);
  const notes = [...pendingNotes(guildId, area), note];
  setSetting(guildId, `update_notes${area.suffix}`, JSON.stringify(notes));
  return notes.length;
}

export const nextUpdateAt = (guildId) => Number(getSetting(guildId, 'update_next_at') ?? nextSlot(Date.now()));

function buildUpdate(guild, client, area) {
  const lastId = Number(getSetting(guild.id, `update_last_id${area.suffix}`) ?? 0);
  const own = changelog.filter((c) => (c.area ?? 'bot') === area.id);
  const entries = own.filter((c) => c.id > lastId);
  const notes = pendingNotes(guild.id, area);
  const items = [...entries.flatMap((c) => c.items), ...notes];

  // Yeni komutlar yalnızca bot yazısında listelenir
  const saved = area.id === 'bot' ? getSetting(guild.id, 'update_commands') : null;
  const known = saved ? new Set(JSON.parse(saved)) : null;
  const added = known ? [...client.commands.values()].filter((c) => !known.has(c.data.name)) : [];

  const sections = [];
  if (items.length) sections.push({ icon: e('yildiz', '⭐'), title: 'Yenilikler', body: items.map((i) => `- ${i}`).join('\n') });
  if (added.length) {
    sections.push({ icon: e('kod', '💻'), title: 'Yeni Komutlar', body: added.map((c) => `- ${commandRefs(c)[0]} — ${c.data.description}`).join('\n') });
  }
  if (!sections.length) sections.push({ icon: e('bilgi', '📌'), title: 'Bu Hafta', body: 'Bu hafta yeni bir değişiklik yapılmadı.' });

  const date = new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'long' });
  const content = ruleText({
    icon: e('roket', '🚀'),
    title: 'Haftalık Güncelleme',
    intro: `-# ${date}\n\nBu hafta ${area.label} tarafında yapılan değişiklikler aşağıda yer almaktadır.`,
    sections,
    note: supportNote(guild),
  });
  return { content, lastId: Math.max(lastId, ...own.map((c) => c.id), 0), noteCount: notes.length };
}

/** Tek seferlik toplu yazı: update_recap_at zamanı gelince Karia Local'in bugüne kadarki tüm değişikliklerini paylaşır. */
async function postRecap(guild) {
  const area = AREAS[0];
  const own = changelog.filter((c) => (c.area ?? 'bot') === area.id);
  const notes = pendingNotes(guild.id, area);
  const items = [...new Set([...own.flatMap((c) => c.items), ...notes])];
  const date = new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'long' });
  const content = ruleText({
    icon: e('roket', '🚀'),
    title: 'Tüm Güncellemeler',
    intro: `-# ${date}\n\nKaria Local'de bugüne kadar yapılan tüm değişiklikler aşağıda yer almaktadır.`,
    sections: [{ icon: e('yildiz', '⭐'), title: 'Yenilikler', body: items.map((i) => `- ${i}`).join('\n') }],
    note: supportNote(guild),
  });
  const thread = await getThread(guild, area);
  for (const chunk of splitText(content)) await thread.send({ content: chunk, allowedMentions: { parse: [] } });
  // Pazar yazısı aynı maddeleri tekrar etmesin
  setSetting(guild.id, 'update_notes', JSON.stringify(pendingNotes(guild.id, area).slice(notes.length)));
  setSetting(guild.id, 'update_last_id', Math.max(0, ...own.map((c) => c.id)));
  setSetting(guild.id, 'update_recap_at', null);
  console.log('✔ Toplu güncelleme yazısı paylaşıldı.');
}

async function postWeekly(guild, client, now) {
  const slot = getSetting(guild.id, 'update_next_at') ?? '0';
  for (const area of AREAS) {
    // Hata sonrası yeniden denemede yazısı atılmış alan tekrar paylaşılmaz
    if (getSetting(guild.id, `update_sent${area.suffix}`) === slot) continue;
    const thread = await getThread(guild, area);
    const { content, lastId, noteCount } = buildUpdate(guild, client, area);
    for (const chunk of splitText(content)) await thread.send({ content: chunk, allowedMentions: { parse: [] } });
    // Yazı hazırlanırken eklenen madde kaybolmasın: sadece yayınlananlar silinir
    setSetting(guild.id, `update_notes${area.suffix}`, JSON.stringify(pendingNotes(guild.id, area).slice(noteCount)));
    setSetting(guild.id, `update_last_id${area.suffix}`, lastId);
    if (area.id === 'bot') setSetting(guild.id, 'update_commands', JSON.stringify([...client.commands.keys()]));
    setSetting(guild.id, `update_sent${area.suffix}`, slot);
  }
  setSetting(guild.id, 'update_next_at', nextSlot(now));
  console.log('✔ Haftalık güncelleme yazıları paylaşıldı.');
}

/** Zamanı geldiyse toplu ve haftalık yazıları atar; başlık yoksa açar. timers.js her 15 sn çağırır. */
export async function tickWeeklyUpdate(client) {
  const now = Date.now();
  if (busy || now < retryAt) return;
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;
  const recapAt = Number(getSetting(guild.id, 'update_recap_at') ?? 0);
  const recapDue = recapAt > 0 && now >= recapAt;
  const weeklyDue = now >= Number(getSetting(guild.id, 'update_next_at') ?? 0);
  if (!recapDue && !weeklyDue) return;

  busy = true;
  try {
    if (recapDue) await postRecap(guild);
    if (weeklyDue) await postWeekly(guild, client, now);
  } catch (error) {
    retryAt = now + 3_600_000;
    console.error('[Haftalık güncelleme]', error.message);
  } finally {
    busy = false;
  }
}
