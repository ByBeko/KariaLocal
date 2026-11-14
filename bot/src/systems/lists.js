// Emoji ve rol listeleri: tek embed, boşluksuz, gerekirse sayfalı.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { kariaEmbed } from '../utils/embeds.js';
import { emojiSlots } from './expressions.js';

const PAGE_CHARS = 3800;
const ROLES_PER_PAGE = 20;
const isSeparator = (name) => /-{3,}|・-/.test(name);

function emojiPages(guild) {
  const sections = [['Sabit', guild.emojis.cache.filter((x) => !x.animated)], ['Hareketli', guild.emojis.cache.filter((x) => x.animated)]];
  const pages = [''];
  for (const [title, list] of sections) {
    if (!list.size) continue;
    pages[pages.length - 1] += `${pages.at(-1) ? '\n' : ''}**${title}**\n`;
    for (const emoji of list.values()) {
      if (pages.at(-1).length > PAGE_CHARS) pages.push('');
      pages[pages.length - 1] += `${emoji} `;
    }
  }
  return pages;
}

function emojiEmbed(guild) {
  const still = guild.emojis.cache.filter((x) => !x.animated).size;
  const limit = emojiSlots(guild);
  return {
    pages: emojiPages(guild),
    embed: kariaEmbed(null, 'Emojiler', { icon: guild.iconURL() ?? undefined }).setTitle(guild.name).setThumbnail(guild.iconURL({ size: 256 })),
    head: guild.emojis.cache.size ? `Sabit **${still}/${limit}** • Hareketli **${guild.emojis.cache.size - still}/${limit}**\n` : 'Sunucuda henüz emoji yok.',
  };
}

function roleEmbed(guild) {
  const roles = [...guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed && !isSeparator(r.name)).sort((a, b) => b.position - a.position).values()];
  const pages = [];
  for (let i = 0; i < roles.length; i += ROLES_PER_PAGE) {
    pages.push(roles.slice(i, i + ROLES_PER_PAGE).map((r) => `${r} • ${r.members.size} kişi`).join('\n'));
  }
  return {
    pages: pages.length ? pages : [''],
    embed: kariaEmbed(null, 'Roller', { icon: guild.iconURL() ?? undefined }).setTitle(guild.name).setThumbnail(guild.iconURL({ size: 256 })),
    head: roles.length ? `Toplam **${roles.length}** rol\n` : 'Sunucuda henüz rol yok.',
  };
}

const BUILDERS = { emoji: emojiEmbed, rol: roleEmbed };

export function listView(kind, guild, ownerId, page) {
  const { pages, embed, head } = BUILDERS[kind](guild);
  const current = Math.max(0, Math.min(page, pages.length - 1));
  embed.setDescription(`${head}${pages[current]}`.trimEnd());
  const components = [];
  if (pages.length > 1) {
    embed.setFooter({ text: `Karia Local | /yardım • Sayfa ${current + 1}/${pages.length}`, iconURL: embed.data.footer?.icon_url });
    const button = (label, target, disabled) =>
      new ButtonBuilder().setCustomId(`liste:${kind}:${ownerId}:${target}`).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
    components.push(new ActionRowBuilder().addComponents(button('Önceki', current - 1, current === 0), button('Sonraki', current + 1, current === pages.length - 1)));
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}
