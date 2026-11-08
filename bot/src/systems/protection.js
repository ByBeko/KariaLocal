import { e } from '../utils/emojis.js';
import { EmbedBuilder } from 'discord.js';
import { getSetting } from '../core/settings.js';
import { isStaff, staffRoleIds } from '../utils/permissions.js';
import { sendLog } from '../utils/logger.js';
import { recordCase, jailMember } from './moderation.js';
import { hasProfanity } from '../utils/profanity.js';

// ───────────────────────── Mesaj koruması ─────────────────────────

const SPAM_WINDOW = 5_000; // 5 sn içinde
const SPAM_COUNT = 6; // 6 mesaj
const DUP_WINDOW = 15_000; // 15 sn içinde
const DUP_COUNT = 4; // aynı mesaj 4 kez
const MENTION_LIMIT = 5;
const SPAM_TIMEOUT = 5 * 60_000;
const MENTION_TIMEOUT = 10 * 60_000;

const INVITE_RE = /(?:discord\.(?:gg|io|me|li)|discord(?:app)?\.com\/invite)\/([\w-]+)/gi;
const URL_RE = /https?:\/\/([^\s/<>]+)/gi;

const history = new Map(); // "guild:user" -> [{ at, content, id, channelId }]

setInterval(() => {
  const cutoff = Date.now() - DUP_WINDOW;
  for (const [key, list] of history) {
    if (!list.length || list.at(-1).at < cutoff) history.delete(key);
  }
}, 5 * 60_000).unref();

async function punish(message, reason, timeoutMs = 0) {
  const { member, guild, channel, client } = message;
  await message.delete().catch(() => {});

  const notice = await channel.send(`${message.author}, ${reason}`).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 6_000);

  if (timeoutMs && member.moderatable) {
    await member.timeout(timeoutMs, `Otomatik koruma: ${reason}`).catch(() => {});
    await recordCase(guild, {
      userId: member.id, modId: client.user.id, type: 'mute', reason: `Otomatik koruma: ${reason}`, duration: timeoutMs,
    });
  } else {
    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle(`${e('kalkan', '🛡️')} Koruma: mesaj silindi`)
      .setDescription(`**Kullanıcı:** ${message.author} (\`${message.author.id}\`)\n**Kanal:** ${channel}\n**Sebep:** ${reason}`)
      .addFields({ name: 'İçerik', value: (message.content || '*boş*').slice(0, 1024) })
      .setTimestamp();
    await sendLog(guild, 'log_ad', { embeds: [embed] });
  }
  return true;
}

const tokenize = (text) => text.toLocaleLowerCase('tr').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Mesajı koruma kurallarından geçirir. Mesaj silindiyse true döner. */
export async function checkMessage(message, { edited = false } = {}) {
  const { member, guild } = message;
  if (!member || isStaff(member)) return false;
  const s = (key) => getSetting(guild.id, key);
  const content = message.content ?? '';

  if (s('anti_invite')) {
    for (const match of content.matchAll(INVITE_RE)) {
      if (match[1].toLowerCase() !== guild.vanityURLCode?.toLowerCase()) {
        return punish(message, 'başka sunucuların davet linkini paylaşmak yasak.');
      }
    }
  }

  if (s('anti_link')) {
    const allowed = s('link_whitelist').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    for (const match of content.matchAll(URL_RE)) {
      const host = match[1].toLowerCase().replace(/^www\./, '').split(':')[0];
      const ok = allowed.some((d) => host === d || host.endsWith(`.${d}`)) || /^discord(app)?\.(gg|com)$/.test(host);
      if (!ok) return punish(message, 'bu kanalda izinsiz link paylaşamazsın.');
    }
  }

  const badWords = s('bad_words').split(',').map((w) => w.trim().toLocaleLowerCase('tr')).filter(Boolean);
  if (badWords.length) {
    const tokens = tokenize(content);
    if (tokens.some((t) => badWords.includes(t))) return punish(message, 'mesajın yasaklı kelime içeriyor.');
  }

  if (s('anti_profanity') && hasProfanity(content)) return punish(message, 'küfür etmek yasak.');

  if (s('anti_mention')) {
    const count = message.mentions.users.size + message.mentions.roles.size;
    if (count >= MENTION_LIMIT) return punish(message, 'toplu etiket atmak yasak.', MENTION_TIMEOUT);
  }

  // Düzenleme yeni mesaj değildir, spam sayacına girmez
  if (s('anti_spam') && !edited) {
    const key = `${guild.id}:${member.id}`;
    const now = Date.now();
    const list = (history.get(key) ?? []).filter((m) => now - m.at < DUP_WINDOW);
    list.push({ at: now, content: content.toLowerCase(), id: message.id, channelId: message.channelId });
    history.set(key, list);

    const fast = list.filter((m) => now - m.at < SPAM_WINDOW);
    const dupes = content ? list.filter((m) => m.content === content.toLowerCase()) : [];
    if (fast.length >= SPAM_COUNT || dupes.length >= DUP_COUNT) {
      history.delete(key);
      // Spam mesajlarını kanal kanal topluca sil
      const byChannel = Map.groupBy(list, (m) => m.channelId);
      for (const [channelId, msgs] of byChannel) {
        const ch = guild.channels.cache.get(channelId);
        await ch?.bulkDelete(msgs.map((m) => m.id), true).catch(() => {});
      }
      return punish(message, 'spam yaptığın için susturuldun.', SPAM_TIMEOUT);
    }
  }

  return false;
}

// ───────────────────────── Giriş koruması (raid / yeni hesap) ─────────────────────────

const RAID_WINDOW = 10_000;
const RAID_DURATION = 10 * 60_000;
const recentJoins = new Map(); // guildId -> [{ at, id }]
const raidUntil = new Map(); // guildId -> timestamp

export const isRaidActive = (guildId) => (raidUntil.get(guildId) ?? 0) > Date.now();
export const getRaidEnd = (guildId) => raidUntil.get(guildId) ?? 0;

export function setRaid(guildId, durationMs) {
  if (durationMs) raidUntil.set(guildId, Date.now() + durationMs);
  else raidUntil.delete(guildId);
}

async function kickForRaid(member) {
  await member.send(`**${member.guild.name}** şu an raid koruması altında. Lütfen birkaç dakika sonra tekrar katıl.`).catch(() => {});
  await member.kick('Raid koruması aktif').catch(() => {});
}

/** Yeni üyeyi kontrol eder. Üye atıldıysa / jail'e alındıysa true döner. */
export async function checkJoin(member) {
  const { guild } = member;
  const s = (key) => getSetting(guild.id, key);

  if (s('anti_raid')) {
    if (isRaidActive(guild.id)) {
      await kickForRaid(member);
      return true;
    }
    const now = Date.now();
    const joins = (recentJoins.get(guild.id) ?? []).filter((j) => now - j.at < RAID_WINDOW);
    joins.push({ at: now, id: member.id });
    recentJoins.set(guild.id, joins);

    if (joins.length >= s('raid_threshold')) {
      setRaid(guild.id, RAID_DURATION);
      recentJoins.delete(guild.id);
      const pings = staffRoleIds(guild.id).map((id) => `<@&${id}>`).join(' ');
      await sendLog(guild, 'log_mod', {
        content: `${e('unlem', '🚨')} ${pings} **RAID ALGILANDI!** 10 saniyede ${joins.length} giriş oldu. 10 dakika boyunca yeni girenler atılacak. Kapatmak için \`/raid kapat\`.`,
        allowedMentions: { parse: ['roles'] },
      });
      for (const j of joins) {
        const m = guild.members.cache.get(j.id);
        if (m) await kickForRaid(m);
      }
      return true;
    }
  }

  const minDays = s('min_account_age');
  const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
  if (minDays > 0 && ageDays < minDays) {
    const reason = `Yeni hesap (${Math.floor(ageDays)} günlük, en az ${minDays} gün gerekli)`;
    if (s('jail_role')) {
      await jailMember(member, { modId: guild.client.user.id, reason }).catch((e) => console.error('[Yeni hesap jail]', e.message));
    } else {
      await member.send(`**${guild.name}** sunucusuna katılmak için hesabının en az ${minDays} günlük olması gerekiyor.`).catch(() => {});
      await member.kick(reason).catch(() => {});
    }
    return true;
  }

  return false;
}
