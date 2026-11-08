import { Events, EmbedBuilder } from 'discord.js';
import { e } from '../utils/emojis.js';
import { getSetting } from '../core/settings.js';
import { sendLog } from '../utils/logger.js';
import { relativeTime } from '../utils/time.js';
import { isJailed } from '../systems/moderation.js';
import { checkJoin } from '../systems/protection.js';
import { recordMemberEvent } from '../systems/stats.js';
import { findUsedInvite, inviterTotal } from '../systems/invites.js';

async function addRole(member, key, reason) {
  const id = getSetting(member.guild.id, key);
  if (id) await member.roles.add(id, reason).catch((e) => console.error(`[Oto rol: ${key}]`, e.message));
}

export default {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const { guild, user } = member;

    const used = await findUsedInvite(guild);
    let inviteText = 'bulunamadı';
    if (used?.vanity) inviteText = `özel URL (\`${used.code}\`)`;
    else if (used) {
      const inviter = used.inviterId ? `<@${used.inviterId}> (toplam ${inviterTotal(guild.id, used.inviterId)} davet)` : 'bilinmiyor';
      inviteText = `\`${used.code}\` • **Davet eden:** ${inviter}`;
    } else if (user.bot) inviteText = 'bot yetkilendirmesi';

    const ageDays = (Date.now() - user.createdTimestamp) / 86_400_000;
    await sendLog(guild, 'log_member', {
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ecc71)
          .setAuthor({ name: `${user.tag} katıldı`, iconURL: user.displayAvatarURL() })
          .setThumbnail(user.displayAvatarURL({ size: 128 }))
          .setDescription(
            `${user} • \`${user.id}\`${user.bot ? ` • ${e('bot', '🤖')} bot` : ''}\n` +
              `**Hesap oluşturma:** ${relativeTime(user.createdTimestamp)}${ageDays < 7 ? ` ${e('unlem', '⚠️')} **yeni hesap**` : ''}\n` +
              `**Davet:** ${inviteText}\n` +
              `**Üye sayısı:** ${guild.memberCount}`,
          )
          .setTimestamp(),
      ],
    });

    if (user.bot) return addRole(member, 'bot_role', 'Oto rol (bot)');
    recordMemberEvent(guild.id, user.id, 'join');

    // Jail'den kaçmak için çıkıp giren
    if (isJailed(guild.id, user.id)) {
      await addRole(member, 'jail_role', 'Jail kaçağı geri döndü');
      await sendLog(guild, 'log_mod', { content: `${e('kilit', '⛓️')} ${user} jail'deyken çıkıp tekrar girdi, jail rolü geri verildi.` });
      return;
    }

    if (await checkJoin(member)) return;

    if (!getSetting(guild.id, 'verify_enabled')) await addRole(member, 'member_role', 'Oto rol');

    const welcomeId = getSetting(guild.id, 'welcome_channel');
    const channel = welcomeId && guild.channels.cache.get(welcomeId);
    if (!channel?.isTextBased()) return;

    const messages = getSetting(guild.id, 'welcome_message').split('|').map((m) => m.trim()).filter(Boolean);
    if (!messages.length) return;
    const content = messages[Math.floor(Math.random() * messages.length)]
      .replaceAll('{user}', `${user}`)
      .replaceAll('{server}', guild.name)
      .replaceAll('{count}', String(guild.memberCount))
      .replaceAll('{konfeti}', e('konfeti', '🎉'));

    await channel.send({ content, allowedMentions: { users: [user.id] } }).catch(() => {});
  },
};
