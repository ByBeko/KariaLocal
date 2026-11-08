import { EmbedBuilder } from 'discord.js';
import { checkAccess, Level } from '../utils/permissions.js';
import { replyError } from '../utils/embeds.js';
import { UserError } from '../utils/errors.js';
import { sendLog } from '../utils/logger.js';

export async function handleError(ctx, error, label) {
  if (error instanceof UserError) return replyError(ctx, error.message).catch(() => {});
  console.error(`[${label}]`, error);
  await replyError(ctx, 'Bir hata oluştu. Yetkililere haber ver.').catch(() => {});
}

/** Slash seçeneklerini "/ban kullanici:@x sebep:..." biçiminde yazar */
function describeOptions(options = []) {
  return options
    .map((o) => {
      if (o.options) return [o.name, describeOptions(o.options)].filter(Boolean).join(' ');
      let value = o.value;
      if (o.user) value = `<@${o.user.id}>`;
      else if (o.channel) value = `<#${o.channel.id}>`;
      else if (o.role) value = `<@&${o.role.id}>`;
      else if (o.attachment) value = o.attachment.name;
      return `${o.name}:${value}`;
    })
    .join(' ');
}

/** Yetkili komutlarını mod-log kanalına yazar */
async function logStaffCommand(ctx, command, label, error) {
  if ((command.level ?? Level.USER) < Level.STAFF) return;
  const usage = ctx.isPrefix ? ctx.summary : `${label} ${describeOptions(ctx.options?.data)}`.trim();
  const failed = error && !(error instanceof UserError);
  await sendLog(ctx.guild, 'log_staff', {
    embeds: [
      new EmbedBuilder()
        .setColor(failed ? 0xe74c3c : error ? 0x95a5a6 : 0x5865f2)
        .setAuthor({ name: `${ctx.user.tag} komut kullandı`, iconURL: ctx.user.displayAvatarURL() })
        .setDescription(
          `\`\`\`${usage.replaceAll('`', 'ˋ').slice(0, 900)}\`\`\`` +
            `**Yetkili:** ${ctx.user} • **Kanal:** ${ctx.channel}` +
            (error ? `\n**Sonuç:** ${failed ? 'hata oluştu' : `reddedildi (${error.message.slice(0, 200)})`}` : ''),
        )
        .setTimestamp(),
    ],
  });
}

/**
 * Komutu çalıştırır. ctx gerçek bir slash etkileşimi ya da
 * "kl" ön ekiyle gelen mesajdan üretilmiş PrefixInteraction olabilir.
 */
export async function runCommand(ctx, command, label) {
  const denied = checkAccess(ctx.member, command);
  if (denied) return replyError(ctx, denied);
  if (command.botPerms && !ctx.guild.members.me.permissions.has(command.botPerms)) {
    return replyError(ctx, 'Bu komut için gerekli Discord iznine ben sahip değilim. Bot rolünün izinlerini kontrol et.');
  }
  let failure = null;
  try {
    await command.execute(ctx);
  } catch (error) {
    failure = error;
    await handleError(ctx, error, label);
  }
  await logStaffCommand(ctx, command, label, failure).catch(() => {});
}
