// Oto cevap: belirli bir mesaja (ya da içinde geçen kelimeye) bot otomatik cevap verir.
import { db } from '../core/database.js';
import { getSetting } from '../core/settings.js';
import { mcIp } from './minecraft.js';
import config from '../config.js';
import { e } from '../utils/emojis.js';

const q = {
  all: db.prepare('SELECT * FROM autoresponses WHERE guild_id=? ORDER BY trigger'),
  upsert: db.prepare(`INSERT INTO autoresponses (guild_id, trigger, response, exact) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, trigger) DO UPDATE SET response=excluded.response, exact=excluded.exact`),
  del: db.prepare('DELETE FROM autoresponses WHERE guild_id=? AND trigger=?'),
};

const cache = new Map(); // guildId -> kayıtlar
const norm = (text) => text.toLocaleLowerCase('tr').replace(/[’`´]/g, "'").replace(/\s+/g, ' ').trim();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Türkçe ekler: "ip" tetiği "ip'si", "ipsi", "ipini", "ip'ye" gibi hallerde de yakalanır ama "iptal", "ipek" gibi kelimelerde yakalanmaz
const SUFFIXES = [
  'si', 'sı', 'su', 'sü', 'i', 'ı', 'u', 'ü', 'yi', 'yı', 'yu', 'yü', 'ni', 'nı', 'nu', 'nü',
  'ini', 'ını', 'unu', 'ünü', 'sini', 'sını', 'sunu', 'sünü', 'nin', 'nın', 'nun', 'nün', 'in', 'ın', 'un', 'ün',
  'sinin', 'sının', 'e', 'a', 'ye', 'ya', 'ne', 'na', 'sine', 'sına', 'de', 'da', 'te', 'ta', 'den', 'dan', 'ten', 'tan',
  'le', 'la', 'yle', 'yla', 'ler', 'lar', 'leri', 'ları', 'mi', 'mı', 'mu', 'mü', 'ne', 'yi',
].sort((a, b) => b.length - a.length);
const SUFFIX_RE = `(?:'?(?:${SUFFIXES.join('|')}))?`;

function list(guildId) {
  if (!cache.has(guildId)) {
    cache.set(
      guildId,
      q.all.all(guildId).map((r) => ({
        trigger: r.trigger,
        response: r.response,
        exact: Boolean(r.exact),
        // Mesajın herhangi bir yerinde, kelime başında; sonunda Türkçe ek olabilir
        re: new RegExp(`(^|[^\\p{L}\\p{N}])${escape(r.trigger)}${SUFFIX_RE}($|[^\\p{L}\\p{N}])`, 'u'),
      })),
    );
  }
  return cache.get(guildId);
}

export const getAutoResponses = (guildId) => list(guildId);

export function setAutoResponse(guildId, trigger, response, exact) {
  q.upsert.run(guildId, norm(trigger), response, exact ? 1 : 0);
  cache.delete(guildId);
}

export function deleteAutoResponse(guildId, trigger) {
  const changes = Number(q.del.run(guildId, norm(trigger)).changes);
  cache.delete(guildId);
  return changes > 0;
}

/** {user} {server} {count} {ip} {site} değişkenlerini doldurur */
export function fillPlaceholders(text, message) {
  const { guild, author } = message;
  return text
    .replaceAll('{user}', `${author}`)
    .replaceAll('{server}', guild.name)
    .replaceAll('{count}', String(guild.memberCount))
    .replaceAll('{ip}', mcIp || 'henüz açıklanmadı, duyuruları takip et')
    .replaceAll('{site}', config.links.website || 'henüz açılmadı')
    .replace(/:Karia_(\w+):/gi, (all, key) => e(key.toLowerCase(), all)); // ':Karia_alev:' → Karia emojisi
}

const cooldowns = new Map(); // "kanal:tetik" -> son cevap
const COOLDOWN = 15_000;

export async function handleAutoResponse(message) {
  const { guild } = message;
  if (!getSetting(guild.id, 'autoresponse_enabled')) return false;
  const text = norm(message.content ?? '');
  if (!text) return false;
  // "IP NE" Türkçe küçültmede "ıp ne" olur; İngilizce küçültmeyi de dene
  const variants = [text, (message.content ?? '').toLowerCase().replace(/[’`´]/g, "'").replace(/\s+/g, ' ').trim()];
  const hit = list(guild.id).find((r) => variants.some((v) => (r.exact ? v === r.trigger : r.re.test(v))));
  if (!hit) return false;

  const key = `${message.channelId}:${hit.trigger}`;
  if (Date.now() - (cooldowns.get(key) ?? 0) < COOLDOWN) return false;
  cooldowns.set(key, Date.now());
  if (cooldowns.size > 1000) cooldowns.clear();

  const reply = fillPlaceholders(hit.response, message);
  await message.reply({ content: reply.slice(0, 2000), allowedMentions: { users: [message.author.id], repliedUser: false } }).catch(() => {});
  return true;
}
