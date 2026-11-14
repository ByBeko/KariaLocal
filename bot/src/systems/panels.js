import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import { e } from '../utils/emojis.js';
import { db } from '../core/database.js';
import config from '../config.js';
import { ruleText, fit } from '../utils/style.js';
import { mcEnabled, mcIp } from './minecraft.js';
import { UserError } from '../utils/errors.js';

const LINK_INFO = {
  website: { label: 'Website', get emoji() { return e('baglanti', '🌐'); } },
  discord: { label: 'Discord', get emoji() { return e('discord', '💬'); } },
  instagram: { label: 'Instagram', get emoji() { return e('instagram', '📸'); } },
  tiktok: { label: 'TikTok', get emoji() { return e('kisa_video', '🎵'); } },
  youtube: { label: 'YouTube', get emoji() { return e('video_oynat', '▶️'); } },
  x: { label: 'X (Twitter)', get emoji() { return e('x', '🐦'); } },
  github: { label: 'GitHub', get emoji() { return e('kod', '💻'); } },
};

// Bu metinler rol etiketi içerebilir; panel gönderilince kimseye bildirim gitmemeli
const panel = (content, components) => ({ content: fit(content), embeds: [], components, allowedMentions: { parse: [] } });

export function verifyPanel() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('dogrula:onay').setLabel('Kuralları kabul ediyorum').setEmoji(e('onayli', '✅')).setStyle(ButtonStyle.Success),
  );
  return panel(
    ruleText({
      icon: e('onayli', '✅'),
      title: 'Doğrulama',
      intro: 'Kuralları okuduysan aşağıdaki butona basarak sunucunun geri kalanına erişebilirsin.',
      note: 'Butona basarak kuralları kabul etmiş sayılırsın.',
    }),
    [row],
  );
}

export function linksPanel() {
  const entries = Object.entries(config.links).filter(([, url]) => url);
  // Maskeli bağlantı ve boş satırsız düzen; önizlemeler mesajı uzatmasın diye kapalı
  const lines = [`# ${e('baglanti', '🌍')}  Karia — Bağlantılar`, `### ${e('zincir', '🔗')}  Resmi Bağlantılar`];
  if (entries.length) for (const [k, url] of entries) lines.push(`> ${LINK_INFO[k]?.emoji ?? e('baglanti', '🔗')} [${LINK_INFO[k]?.label ?? k}](${url})`);
  else lines.push('> Henüz link eklenmedi.');
  if (mcEnabled) lines.push(`### ${e('kazma', '⛏️')}  Minecraft IP`, `> \`${mcIp}\``);
  const content = lines.join('\n');

  const buttons = entries.map(([k, url]) =>
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(LINK_INFO[k]?.label ?? k).setEmoji(LINK_INFO[k]?.emoji ?? e('baglanti', '🔗')),
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  return { ...panel(content, rows), flags: MessageFlags.SuppressEmbeds };
}

export function ticketPanel() {
  const content = ruleText({
    icon: e('cankurtaran', '🎫'),
    title: 'Destek Talebi',
    intro: 'Bir sorunun mu var? Aşağıdaki menüden konuyu seç, sana özel bir kanal açılsın.',
    sections: [
      {
        icon: e('bilgi', '📌'),
        title: 'Talep Konuları',
        body: config.ticketCategories.map((c) => `${e(c.icon, c.emoji)} **${c.label}** — ${c.description}`).join('\n'),
      },
    ],
    note: 'Gereksiz talep açanlar ceza alabilir.',
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:ac')
    .setPlaceholder('Talep konusunu seç')
    .addOptions(config.ticketCategories.map((c) => ({ label: c.label, value: c.value, emoji: e(c.icon, c.emoji), description: c.description.slice(0, 100) })));
  return panel(content, [new ActionRowBuilder().addComponents(menu)]);
}

const roleMenuStmt = db.prepare('SELECT * FROM role_menu WHERE guild_id = ?');
export const getRoleMenu = (guildId) => roleMenuStmt.all(guildId);

export function rolePanel(guild) {
  const items = getRoleMenu(guild.id).filter((r) => guild.roles.cache.has(r.role_id));
  if (!items.length) throw new UserError('Rol menüsü boş. Önce `/rol-menu ekle` ile rol ekle.');

  const content = ruleText({
    icon: e('rozet', '🎭'),
    title: 'Rollerini Seç',
    intro: 'Aşağıdaki menüden istediğin rolleri seç. Seçmediklerin üzerinden alınır.',
    sections: [
      {
        icon: e('yildiz', '⭐'),
        title: 'Seçilebilir Roller',
        body: items.map((r) => `${r.emoji ?? '•'} <@&${r.role_id}>${r.description ? ` — ${r.description}` : ''}`).join('\n'),
      },
    ],
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('roller:sec')
    .setPlaceholder('Rollerini seç')
    .setMinValues(0)
    .setMaxValues(items.length)
    .addOptions(
      items.map((r) => ({
        label: guild.roles.cache.get(r.role_id).name.slice(0, 100),
        value: r.role_id,
        emoji: r.emoji || undefined,
        description: r.description?.slice(0, 100) || undefined,
      })),
    );
  const clear = new ButtonBuilder().setCustomId('roller:temizle').setLabel('Rollerimi temizle').setEmoji(e('cop', '🧹')).setStyle(ButtonStyle.Secondary);
  return panel(content, [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(clear)]);
}
