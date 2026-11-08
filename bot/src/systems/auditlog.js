import { e } from '../utils/emojis.js';
import { AuditLogEvent, EmbedBuilder, PermissionsBitField, OverwriteType } from 'discord.js';
import { sendLog } from '../utils/logger.js';
import { recordCase, DEFAULT_REASON } from './moderation.js';

// Discord'un denetim kaydı (Sunucu Ayarları → Denetim Kaydı) her olayı "kim yaptı" bilgisiyle verir.
// Bot kendi yaptığı ceza/kanal işlemlerini zaten logladığı için onları tekrar yazmayız.

const PERM_TR = {
  Administrator: 'Yönetici',
  ManageGuild: 'Sunucuyu Yönet',
  ManageRoles: 'Rolleri Yönet',
  ManageChannels: 'Kanalları Yönet',
  ManageWebhooks: "Webhook'ları Yönet",
  ManageMessages: 'Mesajları Yönet',
  ManageNicknames: 'Takma Adları Yönet',
  ManageGuildExpressions: 'İfadeleri Yönet',
  BanMembers: 'Üyeleri Yasakla',
  KickMembers: 'Üyeleri At',
  ModerateMembers: 'Zaman Aşımı',
  MentionEveryone: '@everyone Etiketle',
  ViewChannel: 'Kanalı Gör',
  SendMessages: 'Mesaj Gönder',
  Connect: 'Bağlan',
  Speak: 'Konuş',
  ViewAuditLog: 'Denetim Kaydını Gör',
};
const DANGEROUS = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'BanMembers', 'KickMembers', 'MentionEveryone'];
const permName = (p) => PERM_TR[p] ?? p;

/** İki izin bit alanı arasındaki farkı "+ X, − Y" olarak döner */
function permDiff(oldBits, newBits) {
  const before = new PermissionsBitField(BigInt(oldBits ?? 0));
  const after = new PermissionsBitField(BigInt(newBits ?? 0));
  const added = after.toArray().filter((p) => !before.has(p));
  const removed = before.toArray().filter((p) => !after.has(p));
  return { added, removed };
}

const GUILD_KEYS = {
  name: 'Sunucu adı',
  icon_hash: 'Simge',
  banner_hash: 'Afiş',
  splash_hash: 'Davet arka planı',
  description: 'Açıklama',
  vanity_url_code: 'Özel URL',
  verification_level: 'Doğrulama seviyesi',
  explicit_content_filter: 'İçerik filtresi',
  default_message_notifications: 'Varsayılan bildirim',
  mfa_level: '2FA zorunluluğu',
  afk_channel_id: 'AFK kanalı',
  system_channel_id: 'Sistem kanalı',
  rules_channel_id: 'Kurallar kanalı',
  owner_id: 'Sunucu sahibi',
};
const CHANNEL_KEYS = {
  name: 'Ad',
  topic: 'Konu',
  nsfw: 'NSFW',
  rate_limit_per_user: 'Yavaş mod (sn)',
  bitrate: 'Bit hızı',
  user_limit: 'Kişi sınırı',
  parent_id: 'Kategori',
  position: null, // sıralama değişiklikleri log'u kirletmesin
};
const ROLE_KEYS = { name: 'Ad', color: 'Renk', colors: 'Renk', hoist: 'Ayrı göster', mentionable: 'Etiketlenebilir', icon_hash: 'Simge', unicode_emoji: 'Emoji' };

const show = (v) => {
  if (v === null || v === undefined || v === '') return '`yok`';
  if (typeof v === 'boolean') return v ? '`evet`' : '`hayır`';
  if (typeof v === 'object') return `\`${JSON.stringify(v).slice(0, 60)}\``;
  return `\`${String(v).slice(0, 100)}\``;
};

function changeLines(changes, keys) {
  return changes
    .filter((c) => keys[c.key] !== null)
    .map((c) => `**${keys[c.key] ?? c.key}:** ${show(c.old)} → ${show(c.new)}`);
}

function base(entry, color, title) {
  const executor = entry.executor;
  const embed = new EmbedBuilder().setColor(color).setTimestamp(entry.createdTimestamp);
  if (executor) embed.setAuthor({ name: `${executor.tag} • ${title}`, iconURL: executor.displayAvatarURL() });
  else embed.setTitle(title);
  return embed;
}

const who = (entry) => (entry.executorId ? `<@${entry.executorId}>` : 'bilinmiyor');
const reasonLine = (entry) => (entry.reason ? `\n**Sebep:** ${entry.reason.slice(0, 500)}` : '');

// ───────────────────────── Olay işleyiciler ─────────────────────────

async function memberRoleUpdate(entry, guild) {
  const added = entry.changes.find((c) => c.key === '$add')?.new ?? [];
  const removed = entry.changes.find((c) => c.key === '$remove')?.new ?? [];
  const lines = [];
  if (added.length) lines.push(`${e('onayli', '✅')} **Verildi:** ${added.map((r) => `<@&${r.id}>`).join(' ')}`);
  if (removed.length) lines.push(`${e('carpi', '❌')} **Alındı:** ${removed.map((r) => `<@&${r.id}>`).join(' ')}`);
  if (!lines.length) return;
  const color = added.length && !removed.length ? 0x2ecc71 : removed.length && !added.length ? 0xe74c3c : 0x3498db;
  await sendLog(guild, 'log_role', {
    embeds: [
      base(entry, color, 'üye rolü değişti').setDescription(
        `**Üye:** <@${entry.targetId}> • \`${entry.targetId}\`\n${lines.join('\n')}\n**Yapan:** ${who(entry)}${reasonLine(entry)}`,
      ),
    ],
  });
}

async function memberUpdate(entry, guild, isSelf) {
  for (const change of entry.changes) {
    if (change.key === 'nick') {
      const self = entry.executorId === entry.targetId;
      await sendLog(guild, 'log_nick', {
        embeds: [
          base(entry, 0x3498db, self ? 'takma adını değiştirdi' : 'takma ad değiştirdi').setDescription(
            `**Üye:** <@${entry.targetId}> • \`${entry.targetId}\`\n**Takma ad:** ${show(change.old)} → ${show(change.new)}` +
              (self ? '' : `\n**Yapan:** ${who(entry)}`) +
              reasonLine(entry),
          ),
        ],
      });
    } else if (change.key === 'communication_disabled_until') {
      if (isSelf) continue; // /mute ve koruma zaten vaka açtı
      const until = change.new ? Date.parse(change.new) : null;
      await recordCase(guild, {
        userId: entry.targetId,
        modId: entry.executorId,
        type: until ? 'mute' : 'unmute',
        reason: `${entry.reason ?? DEFAULT_REASON} (Discord üzerinden)`,
        duration: until ? Math.max(until - Date.now(), 0) || null : null,
      });
    } else if (change.key === 'mute' || change.key === 'deaf') {
      const what = change.key === 'mute' ? 'sunucu susturması' : 'sunucu sağırlaştırması';
      await sendLog(guild, 'log_voice', {
        embeds: [
          base(entry, change.new ? 0xe67e22 : 0x2ecc71, change.new ? `${what} verdi` : `${what} kaldırdı`).setDescription(
            `**Üye:** <@${entry.targetId}>\n**Yapan:** ${who(entry)}${reasonLine(entry)}`,
          ),
        ],
      });
    }
  }
}

async function manualCase(entry, guild, type) {
  await recordCase(guild, {
    userId: entry.targetId,
    modId: entry.executorId,
    type,
    reason: `${entry.reason ?? DEFAULT_REASON} (Discord üzerinden)`,
  });
}

async function voiceAction(entry, guild, moved) {
  const channel = entry.extra?.channel;
  await sendLog(guild, 'log_voice', {
    embeds: [
      base(entry, 0xe67e22, moved ? 'üyeleri taşıdı' : 'üyeleri sesten attı').setDescription(
        `**Yapan:** ${who(entry)}\n**Kişi sayısı:** ${entry.extra?.count ?? 1}` + (channel ? `\n**${moved ? 'Hedef kanal' : 'Kanal'}:** ${channel}` : ''),
      ),
    ],
  });
}

async function channelEvent(entry, guild, kind) {
  const target = entry.target;
  const name = target?.name ?? entry.changes.find((c) => c.key === 'name')?.old ?? entry.targetId;
  const mention = kind === 'delete' ? `**#${name}**` : `<#${entry.targetId}>`;
  let lines = [];
  if (kind === 'update') {
    lines = changeLines(entry.changes, CHANNEL_KEYS);
    if (!lines.length) return;
  }
  const title = { create: 'kanal oluşturdu', delete: 'kanal sildi', update: 'kanalı düzenledi' }[kind];
  const color = { create: 0x2ecc71, delete: 0xe74c3c, update: 0xf1c40f }[kind];
  await sendLog(guild, 'log_staff', {
    embeds: [base(entry, color, title).setDescription([`**Kanal:** ${mention}`, ...lines, `**Yapan:** ${who(entry)}${reasonLine(entry)}`].join('\n'))],
  });
}

async function overwriteEvent(entry, guild) {
  const extra = entry.extra;
  const subject = !extra ? 'bilinmiyor' : extra.type === OverwriteType.Member || extra.user ? `<@${extra.id}>` : `<@&${extra.id}>`;
  const get = (key, side) => entry.changes.find((c) => c.key === key)?.[side];
  const allow = permDiff(get('allow', 'old'), get('allow', 'new'));
  const deny = permDiff(get('deny', 'old'), get('deny', 'new'));
  const lines = [];
  if (allow.added.length) lines.push(`${e('onayli', '✅')} **İzin verildi:** ${allow.added.map(permName).join(', ')}`);
  if (deny.added.length) lines.push(`${e('carpi', '⛔')} **Engellendi:** ${deny.added.map(permName).join(', ')}`);
  const reset = [...allow.removed, ...deny.removed].filter((p) => !allow.added.includes(p) && !deny.added.includes(p));
  if (reset.length) lines.push(`${e('yenile', '➖')} **Varsayılana döndü:** ${reset.map(permName).join(', ')}`);
  if (entry.action === AuditLogEvent.ChannelOverwriteDelete) lines.push('Bu rol/üyeye özel izinlerin tamamı kaldırıldı.');
  if (!lines.length) return;
  await sendLog(guild, 'log_staff', {
    embeds: [
      base(entry, 0xf1c40f, 'kanal izinlerini değiştirdi').setDescription(
        [`**Kanal:** <#${entry.targetId}> • **Kime:** ${subject}`, ...lines, `**Yapan:** ${who(entry)}${reasonLine(entry)}`].join('\n'),
      ),
    ],
  });
}

async function roleEvent(entry, guild, kind) {
  const name = entry.target?.name ?? entry.changes.find((c) => c.key === 'name')?.[kind === 'delete' ? 'old' : 'new'] ?? entry.targetId;
  const lines = [kind === 'delete' ? `**Rol:** \`@${name}\`` : `**Rol:** <@&${entry.targetId}>`];
  let warn = false;
  const perms = entry.changes.find((c) => c.key === 'permissions');
  if (perms) {
    const { added, removed } = permDiff(perms.old, perms.new);
    if (added.length) lines.push(`${e('onayli', '✅')} **Eklenen izinler:** ${added.map(permName).join(', ')}`);
    if (removed.length) lines.push(`${e('carpi', '❌')} **Kaldırılan izinler:** ${removed.map(permName).join(', ')}`);
    warn = added.some((p) => DANGEROUS.includes(p));
  }
  if (kind === 'update') lines.push(...changeLines(entry.changes.filter((c) => c.key !== 'permissions'), ROLE_KEYS));
  if (kind === 'update' && lines.length === 1) return;
  const title = { create: 'rol oluşturdu', delete: 'rol sildi', update: 'rolü düzenledi' }[kind];
  const color = warn ? 0xe74c3c : { create: 0x2ecc71, delete: 0xe74c3c, update: 0xf1c40f }[kind];
  await sendLog(guild, 'log_role', {
    content: warn ? `${e('unlem', '⚠️')} **Tehlikeli izin eklendi!**` : undefined,
    embeds: [base(entry, color, title).setDescription([...lines, `**Yapan:** ${who(entry)}${reasonLine(entry)}`].join('\n'))],
  });
}

async function simpleStaff(entry, guild, color, title, text) {
  await sendLog(guild, 'log_staff', {
    embeds: [base(entry, color, title).setDescription(`${text}\n**Yapan:** ${who(entry)}${reasonLine(entry)}`)],
  });
}

// ───────────────────────── Silinen mesajı kimin sildiği ─────────────────────────

const deleteCounts = new Map(); // audit entry id -> son görülen sayı

/** Başkasının mesajını silen yetkiliyi denetim kaydından bulmaya çalışır. Bulamazsa null (genelde kendisi silmiştir). */
export async function findMessageDeleter(message) {
  if (!message.author || !message.guild.members.me.permissions.has('ViewAuditLog')) return null;
  await new Promise((r) => setTimeout(r, 1500)); // denetim kaydı birkaç yüz ms gecikmeli düşer
  const logs = await message.guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 10 }).catch(() => null);
  if (!logs) return null;
  for (const entry of logs.entries.values()) {
    if (entry.targetId !== message.author.id || entry.extra?.channel?.id !== message.channelId) continue;
    const count = entry.extra?.count ?? 1;
    const seen = deleteCounts.get(entry.id);
    deleteCounts.set(entry.id, count);
    const fresh = Date.now() - entry.createdTimestamp < 10_000;
    if ((seen === undefined && fresh) || (seen !== undefined && count > seen)) return entry.executorId;
  }
  if (deleteCounts.size > 500) deleteCounts.clear();
  return null;
}

// ───────────────────────── Yönlendirici ─────────────────────────

export async function handleAuditEntry(entry, guild) {
  if (!entry.executor && entry.executorId) entry.executor = await guild.client.users.fetch(entry.executorId).catch(() => null);
  const isSelf = entry.executorId === guild.client.user.id;
  const A = AuditLogEvent;

  switch (entry.action) {
    case A.MemberRoleUpdate:
      return memberRoleUpdate(entry, guild);
    case A.MemberUpdate:
      return memberUpdate(entry, guild, isSelf);
    case A.MemberKick:
      return isSelf ? null : manualCase(entry, guild, 'kick');
    case A.MemberBanAdd:
      return isSelf ? null : manualCase(entry, guild, 'ban');
    case A.MemberBanRemove:
      return isSelf ? null : manualCase(entry, guild, 'unban');
    case A.MemberMove:
      return voiceAction(entry, guild, true);
    case A.MemberDisconnect:
      return voiceAction(entry, guild, false);
    case A.MemberPrune:
      return simpleStaff(entry, guild, 0xe74c3c, 'üye temizliği yaptı', `**Atılan:** ${entry.extra?.removed ?? '?'} üye • ${entry.extra?.days ?? '?'} gündür aktif olmayanlar`);
    case A.BotAdd:
      return simpleStaff(entry, guild, 0xe74c3c, 'sunucuya bot ekledi', `${e('unlem', '⚠️')} **Bot:** <@${entry.targetId}> • \`${entry.targetId}\``);
    case A.ChannelCreate:
      return isSelf ? null : channelEvent(entry, guild, 'create');
    case A.ChannelDelete:
      return isSelf ? null : channelEvent(entry, guild, 'delete');
    case A.ChannelUpdate:
      return isSelf ? null : channelEvent(entry, guild, 'update');
    case A.ChannelOverwriteCreate:
    case A.ChannelOverwriteUpdate:
    case A.ChannelOverwriteDelete:
      return isSelf ? null : overwriteEvent(entry, guild);
    case A.RoleCreate:
      return roleEvent(entry, guild, 'create');
    case A.RoleDelete:
      return roleEvent(entry, guild, 'delete');
    case A.RoleUpdate:
      return roleEvent(entry, guild, 'update');
    case A.GuildUpdate: {
      const lines = changeLines(entry.changes, GUILD_KEYS);
      return lines.length ? simpleStaff(entry, guild, 0xf1c40f, 'sunucu ayarlarını değiştirdi', lines.join('\n')) : null;
    }
    case A.WebhookCreate:
      return simpleStaff(entry, guild, 0xe74c3c, 'webhook oluşturdu', `${e('unlem', '⚠️')} **Webhook:** \`${entry.target?.name ?? entry.targetId}\` • <#${entry.target?.channelId ?? entry.extra?.channel?.id ?? ''}>`);
    case A.WebhookDelete:
      return simpleStaff(entry, guild, 0x95a5a6, 'webhook sildi', `**Webhook:** \`${entry.changes.find((c) => c.key === 'name')?.old ?? entry.targetId}\``);
    case A.EmojiCreate:
      return isSelf ? null : simpleStaff(entry, guild, 0x2ecc71, 'emoji ekledi', `**Emoji:** ${entry.target ?? ''} \`:${entry.changes.find((c) => c.key === 'name')?.new ?? '?'}:\``);
    case A.EmojiDelete:
      return isSelf ? null : simpleStaff(entry, guild, 0xe74c3c, 'emoji sildi', `**Emoji:** \`:${entry.changes.find((c) => c.key === 'name')?.old ?? '?'}:\``);
    case A.MessagePin:
    case A.MessageUnpin:
      return simpleStaff(
        entry,
        guild,
        0x3498db,
        entry.action === A.MessagePin ? 'mesaj sabitledi' : 'sabitlemeyi kaldırdı',
        `**Kanal:** <#${entry.extra?.channel?.id}> • [Mesaj](https://discord.com/channels/${guild.id}/${entry.extra?.channel?.id}/${entry.extra?.messageId})`,
      );
    default:
      return null;
  }
}

