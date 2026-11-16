import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import { fileURLToPath } from 'node:url';
import { e, logo } from '../utils/emojis.js';
import { db } from '../core/database.js';
import config from '../config.js';
import { ruleText, fit } from '../utils/style.js';
import { commandRef } from '../utils/commandRefs.js';
import { UserError } from '../utils/errors.js';

// Kanal banner'ları (bot/assets/banners). Panel mesajından hemen önce ayrı mesaj olarak gönderilir.
const BANNER_DIR = fileURLToPath(new URL('../../assets/banners/', import.meta.url));
export const bannerMessage = (key) => ({ files: [new AttachmentBuilder(`${BANNER_DIR}${key}.png`, { name: `${key}.png` })] });

// Bağlantılar kanalındaki sıra; link "ziyaret et" gibi yazıya bağlanır
const LINKS = [
  { key: 'website', label: 'Website', icon: 'baglanti', emoji: '🌐', cta: 'ziyaret et' },
  { key: 'instagram', label: 'Instagram', icon: 'instagram', emoji: '📸', cta: 'takip et' },
  { key: 'tiktok', label: 'TikTok', icon: 'kisa_video', emoji: '🎵', cta: 'takip et' },
  { key: 'youtube', label: 'YouTube', icon: 'video_oynat', emoji: '▶️', cta: 'abone ol' },
  { key: 'minecraft', label: 'Minecraft', icon: 'kazma', emoji: '⛏️', cta: 'ziyaret et' },
];

// Bu metinler rol etiketi içerebilir; panel gönderilince kimseye bildirim gitmemeli
const panel = (content, components) => ({ content: fit(content), embeds: [], components, allowedMentions: { parse: [] } });

export function verifyPanel() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('dogrula:onay').setLabel('Kuralları kabul ediyorum').setEmoji(e('onayli', '✅')).setStyle(ButtonStyle.Success),
  );
  return panel(
    ruleText({
      icon: logo(),
      title: 'Doğrulama',
      intro: 'Kuralları okuduysan aşağıdaki butona basarak sunucunun geri kalanına erişebilirsin.',
      note: 'Butona basarak kuralları kabul etmiş sayılırsın.',
    }),
    [row],
  );
}

export function linksPanel() {
  const links = LINKS.filter((l) => config.links[l.key]);
  // Banner başlık işini görür; önizlemeler mesajı uzatmasın diye kapalı
  const lines = [`### ${e('zincir', '🔗')}  Resmi Bağlantılar`];
  if (links.length) for (const l of links) lines.push(`> ${e(l.icon, l.emoji)} ${l.label} [${l.cta}](${config.links[l.key]})`);
  else lines.push('> Henüz link eklenmedi.');
  return { ...panel(lines.join('\n'), []), flags: MessageFlags.SuppressEmbeds };
}

export function ticketPanel(guild) {
  const content = ruleText({
    icon: logo(),
    title: 'Destek Talebi',
    intro: `Bir sorunun mu var? Aşağıdaki menüden konuyu seç, sana özel bir kanal açılsın.\nBir üyeyi şikayet etmek için ${commandRef(guild.client, 'rapor')} komutunu kullan.`,
    note: 'Gereksiz talep açanlar ceza alabilir.',
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:ac')
    .setPlaceholder('Talep konusunu seç')
    .addOptions(config.ticketCategories.filter((c) => !c.hidden).map((c) => ({ label: c.label, value: c.value, description: c.description.slice(0, 100) })));
  return panel(content, [new ActionRowBuilder().addComponents(menu)]);
}

const roleMenuStmt = db.prepare('SELECT * FROM role_menu WHERE guild_id = ?');
export const getRoleMenu = (guildId) => roleMenuStmt.all(guildId);

export function rolePanel(guild) {
  const items = getRoleMenu(guild.id).filter((r) => guild.roles.cache.has(r.role_id));
  if (!items.length) throw new UserError('Rol menüsü boş. Önce `/rol-menu ekle` ile rol ekle.');

  const content = ruleText({
    icon: logo(),
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
