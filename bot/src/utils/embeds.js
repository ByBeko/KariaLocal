import { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { e } from './emojis.js';
import config from '../config.js';

export const COLORS = {
  brand: config.brand.color,
  success: 0x2ecc71,
  error: 0xe74c3c,
  warning: 0xf1c40f,
};

export const brandEmbed = () => new EmbedBuilder().setColor(COLORS.brand);

// ── Karia görünümü: üstte küçük bölüm başlığı, altta "Karia Local | /yardım" ve saat ──
const emojiUrl = (key) => {
  const id = e(key, '').match(/:(\d+)>/)?.[1];
  return id ? `https://cdn.discordapp.com/emojis/${id}.png` : undefined;
};

export const FOOTER_TEXT = 'Karia Local | /yardım';

// Açılışta ayarlanır; client verilmeyen yerlerde başlık ikonu botun avatarı olur
let botClient = null;
export const setEmbedClient = (client) => { botClient = client; };

/** Komut cevaplarının ortak kalıbı. section: üstteki küçük başlık ("Bot Bilgileri") */
export function kariaEmbed(client, section, { icon, footer } = {}) {
  client ??= botClient;
  const embed = brandEmbed()
    .setFooter({ text: footer ? `${FOOTER_TEXT} • ${footer}` : FOOTER_TEXT, iconURL: emojiUrl('kalp') })
    .setTimestamp();
  if (section) embed.setAuthor({ name: section, iconURL: icon ?? client?.user?.displayAvatarURL() });
  return embed;
}

/** ▰▰▰▱▱▱▱ şeklinde doluluk çubuğu (0–1 arası oran) */
export function bar(ratio, size = 7) {
  const filled = Math.max(0, Math.min(size, Math.round((Number(ratio) || 0) * size)));
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

/** Alan başlığı: Karia emojisi + ad */
export const label = (key, fallback, text) => `${e(key, fallback)} ${text}`;

/** Mesajın altındaki bağlantı butonları: Kontrol Paneli, Web Sitesi, Discord */
export function linkRow() {
  const button = (text, url, key, fallback) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(text).setURL(url).setEmoji(e(key, fallback));
  return new ActionRowBuilder().addComponents(
    button('Kontrol Paneli', 'https://karia.live/karia-local', 'pano', '📋'),
    button('Web Sitesi', config.links.website || 'https://karia.live', 'baglanti', '🌐'),
    ...(config.links.discord ? [button('Discord', config.links.discord, 'discord', '💬')] : []),
  );
}

/** Gecikmeye göre kısa yorum */
export const pingQuality = (ms) => (ms < 0 ? 'Ölçülüyor' : ms < 120 ? 'Mükemmel' : ms < 250 ? 'İyi' : ms < 500 ? 'Orta' : 'Yavaş');

export const successEmbed = (text) => new EmbedBuilder().setColor(COLORS.success).setDescription(`${e('onayli', '✅')} ${text}`);

export const errorEmbed = (text) => new EmbedBuilder().setColor(COLORS.error).setDescription(`${e('carpi', '❌')} ${text}`);

/** Etkileşime durumu ne olursa olsun (reply/defer edilmiş) güvenle cevap verir. */
export async function respond(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    const { flags, ...rest } = payload;
    return interaction.deferred && !interaction.replied ? interaction.editReply(rest) : interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

export const replyError = (interaction, text) =>
  respond(interaction, { embeds: [errorEmbed(text)], flags: MessageFlags.Ephemeral });

export const replySuccess = (interaction, text, ephemeral = true) =>
  respond(interaction, { embeds: [successEmbed(text)], flags: ephemeral ? MessageFlags.Ephemeral : undefined });
