import { e } from '../../utils/emojis.js';
import { Level } from '../../utils/permissions.js';
import {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags,
} from 'discord.js';
import { setTimeout as sleep } from 'node:timers/promises';
import AdmZip from 'adm-zip';
import { getSetting, setSetting } from '../../core/settings.js';
import { replyError } from '../../utils/embeds.js';
import { UserError } from '../../utils/errors.js';

const MAX_HOURLY = 50; // Discord'un gizli emoji sınırına takılmamak için saatlik kota
const HOUR = 3_600_000;
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_EMOJI_BYTES = 256 * 1024; // Discord emoji boyut sınırı
const DELAY = 2_500; // yüklemeler arası bekleme
const TIER_LIMITS = [50, 100, 150, 250]; // takviye seviyesine göre (sabit ve hareketli ayrı ayrı)
const EXT_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const extOf = (fileName) => fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
const TR_MAP = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U' };
const STOP = Symbol('stop');

const running = new Set(); // aynı sunucuda aynı anda tek yükleme

function getQuota(guildId) {
  let quota = null;
  try {
    quota = JSON.parse(getSetting(guildId, 'emoji_quota') ?? 'null');
  } catch {}
  if (!quota || Date.now() > quota.resetAt) quota = { count: 0, resetAt: Date.now() + HOUR };
  return quota;
}
const saveQuota = (guildId, quota) => setSetting(guildId, 'emoji_quota', JSON.stringify(quota));
const unix = (ms) => Math.floor(ms / 1000);

function emojiName(fileName, index) {
  const name = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => TR_MAP[c])
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 32);
  return name.replace(/_/g, '').length >= 2 ? name : `emoji_${index + 1}`;
}

function readZip(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new UserError('ZIP dosyası okunamadı, bozuk olabilir.');
  }
  return zip.getEntries().filter((e) => {
    if (e.isDirectory || e.entryName.startsWith('__MACOSX') || e.name.startsWith('.')) return false;
    return Boolean(EXT_MIME[extOf(e.name)]);
  });
}

export default {
  userPerms: [PermissionFlagsBits.ManageGuildExpressions],
  botPerms: [PermissionFlagsBits.ManageGuildExpressions],
  level: Level.MOD, // yardım menüsünde yetkili paneline düşsün (izin kontrolü userPerms ile)
  aliases: ['emojiyukle', 'zip-emoji'],
  data: new SlashCommandBuilder()
    .setName('emoji-yukle')
    .setDescription('ZIP içindeki görselleri saatlik kotayla sunucuya emoji olarak ekler.')
    .addAttachmentOption((o) => o.setName('dosya').setDescription('Emojilerin bulunduğu .zip dosyası').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild, user } = interaction;
    const attachment = interaction.options.getAttachment('dosya');

    if (running.has(guild.id)) return replyError(interaction, 'Bu sunucuda zaten devam eden bir emoji yüklemesi var.');
    const quota = getQuota(guild.id);
    if (quota.count >= MAX_HOURLY) {
      return replyError(
        interaction,
        `${e('kumsaati', '⏳')} **Saatlik emoji limiti doldu.** 1 saatte en fazla **${MAX_HOURLY}** emoji yüklenebilir.\nYeni hak: <t:${unix(quota.resetAt)}:R>`,
      );
    }
    if (!attachment.name.toLowerCase().endsWith('.zip')) return replyError(interaction, 'Sadece `.zip` dosyası yükleyebilirsin.');
    if (attachment.size > MAX_ZIP_BYTES) return replyError(interaction, 'ZIP dosyası en fazla 25 MB olabilir.');

    await interaction.deferReply();
    running.add(guild.id);
    try {
      await upload(interaction, attachment, quota);
    } finally {
      running.delete(guild.id);
    }
  },
};

async function upload(interaction, attachment, quota) {
  const { guild, user } = interaction;

  const res = await fetch(attachment.url);
  if (!res.ok) throw new UserError('Dosya indirilemedi, tekrar dene.');
  const entries = readZip(Buffer.from(await res.arrayBuffer()));
  if (!entries.length) throw new UserError('ZIP içinde eklenebilir görsel yok (png, jpg, gif, webp).');

  await guild.emojis.fetch();
  const maxPerType = TIER_LIMITS[guild.premiumTier] ?? 50;
  let staticCount = guild.emojis.cache.filter((e) => !e.animated).size;
  let animatedCount = guild.emojis.cache.filter((e) => e.animated).size;

  const added = [];
  const failed = [];
  let stopReason = '';
  let resolveStop;
  const stopped = new Promise((r) => (resolveStop = r));
  let isStopped = false;
  const stop = (reason) => {
    if (isStopped) return;
    isStopped = true;
    stopReason = reason;
    resolveStop(STOP);
  };

  const button = new ButtonBuilder().setCustomId('emoji-durdur').setLabel('Durdur').setEmoji(e('durdur', '⏹️')).setStyle(ButtonStyle.Danger);
  const progress = (i) =>
    new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${e('kumsaati', '⏳')} Emojiler yükleniyor...`)
      .setDescription(
        `**İlerleme:** ${i} / ${entries.length}\n` +
          `${e('onayli', '✅')} **Eklenen:** ${added.length}  ${e('unlem', '⚠️')} **Atlanan:** ${failed.length}\n` +
          `${e('istatistik', '📊')} **Saatlik kota:** ${quota.count} / ${MAX_HOURLY}\n\n` +
          (added.length ? `**Son eklenenler:**\n${added.slice(-15).join(' ')}` : ''),
      )
      .setFooter({ text: 'Sadece komutu kullanan kişi durdurabilir.' });

  const message = await interaction.editReply({ embeds: [progress(0)], components: [new ActionRowBuilder().addComponents(button)] });

  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30 * 60_000 });
  collector.on('collect', async (i) => {
    if (i.user.id !== user.id) {
      return i.reply({ content: `${e('carpi', '❌')} Bu işlemi sadece komutu kullanan kişi durdurabilir.`, flags: MessageFlags.Ephemeral });
    }
    stop(`${e('durdur', '⏹️')} İşlem kullanıcı tarafından durduruldu.`);
    await i.deferUpdate().catch(() => {});
  });

  for (let i = 0; i < entries.length && !isStopped; i++) {
    const entry = entries[i];
    const name = emojiName(entry.name, i);
    const ext = extOf(entry.name);
    const animated = ext === '.gif';

    if (quota.count >= MAX_HOURLY) {
      stop(`${e('carpi', '🛑')} **Saatlik ${MAX_HOURLY} emoji kotası doldu.** Yeni hak: <t:${unix(quota.resetAt)}:R>`);
      break;
    }
    if ((animated ? animatedCount : staticCount) >= maxPerType) {
      stop(`${e('unlem', '⚠️')} Sunucunun ${animated ? 'hareketli' : 'sabit'} emoji sınırı (**${maxPerType}**) doldu.`);
      break;
    }
    // Açmadan önce boyutu kontrol et (ZIP bombasına karşı)
    if (entry.header.size > MAX_EMOJI_BYTES) {
      failed.push(`${entry.name} (256 KB üstü)`);
      continue;
    }

    const dataUri = `data:${EXT_MIME[ext]};base64,${entry.getData().toString('base64')}`;
    const creating = guild.emojis.create({ attachment: dataUri, name, reason: `Emoji yükleme: ${user.tag}` });
    const countQuota = () => {
      quota.count++;
      saveQuota(guild.id, quota);
    };

    try {
      const result = await Promise.race([creating, stopped]);
      if (result === STOP) {
        // Durdurulduysa bile gönderilmiş istek tamamlanırsa kotaya say
        creating.then(countQuota).catch(() => {});
        break;
      }
      countQuota();
      added.push(result.toString());
      if (animated) animatedCount++;
      else staticCount++;
    } catch (error) {
      if (error.code === 30008) {
        stop(`${e('unlem', '⚠️')} Sunucu emoji sınırına ulaşıldı.`);
        break;
      }
      failed.push(`${entry.name} (${error.code === 50045 ? 'dosya çok büyük' : 'geçersiz görsel'})`);
      console.error(`[emoji-yukle] ${name}:`, error.message);
    }

    await interaction.editReply({ embeds: [progress(i + 1)] }).catch(() => {});
    await Promise.race([sleep(DELAY), stopped]);
  }

  collector.stop();
  button.setDisabled(true);

  const summary = new EmbedBuilder()
    .setColor(isStopped ? 0xed4245 : 0x57f287)
    .setTitle(isStopped ? `${e('durdur', '⏹️')} Emoji yükleme durdu` : `${e('konfeti', '🎉')} Emoji yükleme tamamlandı!`)
    .setDescription(
      (stopReason ? `${stopReason}\n\n` : '') +
        `**Eklenen:** ${added.length}\n**Atlanan:** ${failed.length}\n` +
        `${e('kumsaati', '⏱️')} **Kota sıfırlanma:** <t:${unix(quota.resetAt)}:R>\n\n` +
        `**Yüklenen emojiler:**\n${added.slice(0, 30).join(' ') || 'Hiç emoji eklenmedi.'}` +
        (added.length > 30 ? ` ...ve ${added.length - 30} tane daha` : ''),
    )
    .setFooter({ text: `${user.tag} tarafından`, iconURL: user.displayAvatarURL() })
    .setTimestamp();
  if (failed.length) {
    summary.addFields({ name: 'Atlananlar', value: failed.slice(0, 15).join('\n').slice(0, 1024) });
  }

  await interaction.editReply({ embeds: [summary], components: [new ActionRowBuilder().addComponents(button)] }).catch(() => {});
}
