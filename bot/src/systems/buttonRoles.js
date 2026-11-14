// Buton rol: panelden gönderilen mesajdaki butona basan üye rolü alır, tekrar basınca bırakır.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { e } from '../utils/emojis.js';
import { fit, ruleText } from '../utils/style.js';
import { sendLog } from '../utils/logger.js';
import { UserError } from '../utils/errors.js';

const MAX_BUTTONS = 25;
const PER_ROW = 5;
const STYLES = { blue: ButtonStyle.Primary, gray: ButtonStyle.Secondary, green: ButtonStyle.Success, red: ButtonStyle.Danger };
const EMOJI = /^(<a?:\w+:\d+>|\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*)$/u;
// Herkesin kendine verebileceği bir rolde yetki bulunamaz
const STAFF_PERMISSIONS = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.ManageMessages, P.ManageWebhooks, P.BanMembers, P.KickMembers, P.ModerateMembers, P.MentionEveryone];

/** Rol butonla verilemiyorsa nedenini döner. Buton basıldığında da yeniden denetlenir. */
export function roleProblem(guild, role) {
  if (!role || role.id === guild.id || role.managed) return 'Bu rol butona eklenemez.';
  if (!role.editable) return `${role.name} rolü botun rolünden yüksekte, verilemez.`;
  if (STAFF_PERMISSIONS.some((permission) => role.permissions.has(permission))) return `${role.name} rolünde yetkili izinleri var, herkese açık butona eklenemez.`;
  return null;
}

export async function sendButtonRoles(guild, member, body) {
  const channel = guild.channels.cache.get(String(body.channelId ?? ''));
  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) throw new UserError('Mesajın gideceği yazı kanalını seç.');
  if (!channel.permissionsFor(guild.members.me)?.has(['ViewChannel', 'SendMessages'])) throw new UserError('O kanala yazma iznim yok.');
  const title = String(body.title ?? '').trim();
  const text = String(body.text ?? '').trim();
  if (!title) throw new UserError('Başlık yaz.');
  if (title.length > 80) throw new UserError('Başlık en fazla 80 karakter olabilir.');
  if (text.length > 1500) throw new UserError('Metin en fazla 1500 karakter olabilir.');
  const items = Array.isArray(body.roles) ? body.roles : [];
  if (!items.length) throw new UserError('En az bir rol ekle.');
  if (items.length > MAX_BUTTONS) throw new UserError(`En fazla ${MAX_BUTTONS} buton eklenebilir.`);
  const seen = new Set();
  const buttons = items.map((item) => {
    const role = guild.roles.cache.get(String(item.roleId ?? ''));
    if (!role) throw new UserError('Her satırda bir rol seç.');
    const problem = roleProblem(guild, role);
    if (problem) throw new UserError(problem);
    if (seen.has(role.id)) throw new UserError(`${role.name} iki kez eklenmiş.`);
    seen.add(role.id);
    const label = String(item.label ?? '').trim() || role.name;
    const emoji = String(item.emoji ?? '').trim();
    if (emoji && !EMOJI.test(emoji)) throw new UserError('Geçersiz emoji.');
    const button = new ButtonBuilder().setCustomId(`butonrol:${role.id}`).setLabel(label.slice(0, 80)).setStyle(STYLES[item.style] ?? ButtonStyle.Secondary);
    if (emoji) button.setEmoji(emoji);
    return button;
  });
  const rows = [];
  for (let i = 0; i < buttons.length; i += PER_ROW) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + PER_ROW)));
  const content = fit(ruleText({ icon: e('rozet', '🎭'), title, intro: text || 'Butona basarak rolü al, tekrar basarak bırak.' }));
  const sent = await channel.send({ content, components: rows, allowedMentions: { parse: [] } });
  await sendLog(guild, 'log_staff', { content: `${member} panelden ${channel} kanalına buton rol mesajı gönderdi (${buttons.length} rol).`, allowedMentions: { parse: [] } });
  return { ok: true, url: sent.url };
}
