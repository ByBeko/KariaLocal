// Haftalık güncelleme: #karia-bot forumunda tek başlık açılır, her hafta aynı başlığa yazılır.
import { ChannelType } from 'discord.js';
import changelog from '../changelog.js';
import { getSetting, setSetting } from '../core/settings.js';
import { e } from '../utils/emojis.js';
import { ruleText, splitText } from '../utils/style.js';
import { commandRefs } from '../utils/commandRefs.js';
import { findGuideChannel } from './guide.js';

const DAY = 86_400_000;
const THREAD_NAME = 'Karia Local Güncellemeleri';
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

async function createThread(guild) {
  const forum = findGuideChannel(guild, 'karia-bot');
  if (forum?.type !== ChannelType.GuildForum) throw new Error('#karia-bot forumu bulunamadı');
  const tag = forum.availableTags.find((t) => /g[uü]ncelleme/i.test(t.name));
  const thread = await forum.threads.create({
    name: THREAD_NAME,
    autoArchiveDuration: 10080,
    appliedTags: tag ? [tag.id] : [],
    message: {
      allowedMentions: { parse: [] },
      content: ruleText({
        icon: e('roket', '🚀'),
        title: THREAD_NAME,
        intro: 'Karia Local botunda yapılan tüm değişiklikler bu başlıkta paylaşılır.',
        sections: [
          { icon: e('kumsaati', '⏳'), title: 'Ne Zaman Paylaşılır?', body: 'Her **Pazar 20:00** saatinde o haftanın güncelleme yazısı buraya eklenir.' },
        ],
        note: supportNote(guild),
      }),
    },
  });
  setSetting(guild.id, 'update_thread', thread.id);
  return thread;
}

async function getThread(guild) {
  const id = getSetting(guild.id, 'update_thread');
  const thread = id && (await guild.channels.fetch(id).catch(() => null));
  if (!thread) return createThread(guild);
  if (thread.archived) await thread.setArchived(false, 'Haftalık güncelleme');
  return thread;
}

const pendingNotes = (guildId) => JSON.parse(getSetting(guildId, 'update_notes') ?? '[]');

/** /guncelleme-ekle: maddeyi sıradaki yazıya ekler, bekleyen madde sayısını döner. */
export function addUpdateNote(guildId, note) {
  const notes = [...pendingNotes(guildId), note];
  setSetting(guildId, 'update_notes', JSON.stringify(notes));
  return notes.length;
}

export const nextUpdateAt = (guildId) => Number(getSetting(guildId, 'update_next_at') ?? nextSlot(Date.now()));

function buildUpdate(guild, client) {
  const lastId = Number(getSetting(guild.id, 'update_last_id') ?? 0);
  const entries = changelog.filter((c) => c.id > lastId);
  const notes = pendingNotes(guild.id);
  const items = [...entries.flatMap((c) => c.items), ...notes];

  const saved = getSetting(guild.id, 'update_commands');
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
    intro: `-# ${date}\n\nBu hafta Karia Local'de yapılan değişiklikler aşağıda yer almaktadır.`,
    sections,
    note: supportNote(guild),
  });
  return { content, lastId: Math.max(lastId, ...changelog.map((c) => c.id)), noteCount: notes.length };
}

/** Zamanı geldiyse haftalık yazıyı atar; başlık yoksa açar. timers.js her 15 sn çağırır. */
export async function tickWeeklyUpdate(client) {
  const now = Date.now();
  if (busy || now < retryAt) return;
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild || now < Number(getSetting(guild.id, 'update_next_at') ?? 0)) return;

  busy = true;
  try {
    const thread = await getThread(guild);
    const { content, lastId, noteCount } = buildUpdate(guild, client);
    for (const chunk of splitText(content)) await thread.send({ content: chunk, allowedMentions: { parse: [] } });
    // Yazı hazırlanırken eklenen madde kaybolmasın: sadece yayınlananlar silinir
    setSetting(guild.id, 'update_notes', JSON.stringify(pendingNotes(guild.id).slice(noteCount)));
    setSetting(guild.id, 'update_last_id', lastId);
    setSetting(guild.id, 'update_commands', JSON.stringify([...client.commands.keys()]));
    setSetting(guild.id, 'update_next_at', nextSlot(now));
    console.log('✔ Haftalık güncelleme yazısı paylaşıldı.');
  } catch (error) {
    retryAt = now + 3_600_000;
    console.error('[Haftalık güncelleme]', error.message);
  } finally {
    busy = false;
  }
}
