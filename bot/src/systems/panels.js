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
  // Önizlemeler mesajı uzatmasın diye kapalı; linkler ayrıca buton olarak da duruyor
  const content = ruleText({
    icon: logo(),
    title: 'Bağlantılar',
    intro: 'Karia’nın resmi hesapları aşağıda. Sadece buradaki bağlantılar bize aittir, başka hesaplara itibar etme.',
    sections: [
      {
        icon: e('zincir', '🔗'),
        title: 'Resmi Hesaplarımız',
        body: links.length
          ? links.map((l) => `${e(l.icon, l.emoji)}  **${l.label}** — [${l.cta}](${config.links[l.key]})`).join('\n')
          : 'Henüz bağlantı eklenmedi.',
      },
    ],
    note: 'Takip ederek yeni etkinlik ve duyurulardan ilk sen haberdar ol.',
  });
  const rows = [];
  for (let i = 0; i < links.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      links.slice(i, i + 5).map((l) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(l.label).setEmoji(e(l.icon, l.emoji)).setURL(config.links[l.key])),
    ));
  }
  return { ...panel(content, rows), flags: MessageFlags.SuppressEmbeds };
}

export function votePanel(guild) {
  const topgg = `https://top.gg/servers/${guild.id}/vote`;
  const disboard = `https://disboard.org/server/${guild.id}`;
  const content = ruleText({
    icon: logo(),
    title: 'Oy Ver',
    intro: 'Verdiğin her oy Karia’yı listelerde yukarı taşır ve topluluğumuzun büyümesine doğrudan destek olur.',
    sections: [
      {
        icon: e('yukari', '🔺'),
        title: 'Top.gg',
        body: `Aşağıdaki **Top.gg** butonuyla Karia sunucusuna oy ver.\nHer **12 saatte** bir tekrar oy verebilirsin.`,
      },
      {
        icon: e('megafon', '📣'),
        title: 'Disboard',
        body: 'Herhangi bir kanalda Disboard botunun `/bump` komutunu kullan.\nHer **2 saatte** bir sunucuyu öne çıkarabilirsin.',
      },
      {
        icon: e('kupa', '🏆'),
        title: 'Sıralama ve Ödüller',
        body: '• Her **Pazar 20.00**’de haftanın en çok oy veren ve bump yapan üyeleri duyurularda paylaşılır.\n• Ayın en çok oy veren üyesi **30 gün Prime** kazanır.',
      },
    ],
    note: 'Bize destek olan herkese teşekkür ederiz!',
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Top.gg’de Oy Ver').setEmoji(e('yukari', '🔺')).setURL(topgg),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Disboard Sayfası').setEmoji(e('megafon', '📣')).setURL(disboard),
  );
  return { ...panel(content, [row]), flags: MessageFlags.SuppressEmbeds };
}

export function ticketPanel(guild) {
  const categories = config.ticketCategories.filter((c) => !c.hidden);
  const content = ruleText({
    icon: logo(),
    title: 'Destek Talebi',
    intro: 'Bir sorun mu yaşıyorsun ya da yetkililere ulaşmak mı istiyorsun? Sana özel bir kanal açıp birlikte çözelim.',
    sections: [
      {
        icon: e('pano', '📋'),
        title: 'Talep Konuları',
        body: categories.map((c) => `${e(c.icon, c.emoji)}  **${c.label}** — ${c.description}`).join('\n'),
      },
      {
        icon: e('unlem', '❗'),
        title: 'Nasıl Çalışır?',
        body: [
          '**1.** Aşağıdaki menüden talep konunu seç.',
          '**2.** Sadece senin ve yetkililerin görebildiği bir kanal açılır.',
          '**3.** Sorununu detaylıca yaz; varsa ekran görüntüsü ekle.',
          `Bir üyeyi şikayet etmek için ${commandRef(guild.client, 'rapor')} komutunu kullan.`,
        ].join('\n'),
      },
    ],
    note: 'Gereksiz veya şaka amaçlı talep açanlar ceza alabilir.',
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:ac')
    .setPlaceholder('Talep konusunu seç')
    .addOptions(categories.map((c) => ({ label: c.label, value: c.value, description: c.description.slice(0, 100), emoji: e(c.icon, c.emoji) })));
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
