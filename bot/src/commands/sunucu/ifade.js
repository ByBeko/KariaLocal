import { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, StickerFormatType } from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { replySuccess } from '../../utils/embeds.js';
import { UserError } from '../../utils/errors.js';
import { parseEmoji, findGuildEmoji, findSticker } from '../../systems/expressions.js';

const EMOJI_MAX = 256 * 1024;
const STICKER_MAX = 512 * 1024;

/** Botun çalıştığı bilgisayarın yerel ağına istek attırılmasın */
function safeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i.test(u.hostname)) return null;
    return u.href;
  } catch {
    return null;
  }
}

async function download(url, max) {
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) throw new UserError('Dosya indirilemedi.');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > max) throw new UserError(`Dosya çok büyük (${Math.round(buffer.length / 1024)} KB). En fazla ${max / 1024} KB olabilir.`);
  return buffer;
}

export default {
  level: Level.MOD,
  aliases: ['ifadeler'],
  data: new SlashCommandBuilder()
    .setName('ifade')
    .setDescription('Emoji ve çıkartma ekle/sil (yetkili).')
    .addSubcommand((s) =>
      s
        .setName('emoji-ekle')
        .setDescription('Başka sunucudan emoji yapıştır, resim linki ver ya da dosya ekle')
        .addStringOption((o) => o.setName('kaynak').setDescription('Emoji (<:ad:id>) ya da resim linki'))
        .addStringOption((o) => o.setName('isim').setDescription('Emoji adı (boşsa kaynaktaki ad)'))
        .addAttachmentOption((o) => o.setName('dosya').setDescription('PNG/GIF/JPG, en fazla 256 KB')),
    )
    .addSubcommand((s) =>
      s
        .setName('emoji-sil')
        .setDescription('Emoji siler')
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji ya da adı').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('cikartma-ekle')
        .setDescription('PNG/APNG/GIF (320x320, en fazla 512 KB) dosyasından çıkartma ekler')
        .addStringOption((o) => o.setName('isim').setDescription('Çıkartma adı (2-30 karakter)').setRequired(true))
        .addAttachmentOption((o) => o.setName('dosya').setDescription('Resim (kl ile: çıkartmalı bir mesaja yanıt da verebilirsin)'))
        .addStringOption((o) => o.setName('etiket').setDescription('İlgili emoji (örn. 😂)')),
    )
    .addSubcommand((s) =>
      s
        .setName('cikartma-sil')
        .setDescription('Çıkartma siler')
        .addStringOption((o) => o.setName('isim').setDescription('Çıkartma adı').setRequired(true)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const { guild } = interaction;
    const sub = interaction.options.getSubcommand();
    const by = interaction.user.tag;

    if (sub === 'emoji-sil') {
      const emoji = findGuildEmoji(guild, interaction.options.getString('emoji', true));
      if (!emoji) throw new UserError('Bu sunucuda böyle bir emoji yok.');
      const name = emoji.name;
      await emoji.delete(`${by}: emoji sil`);
      return replySuccess(interaction, `\`:${name}:\` emojisi silindi.`, false);
    }

    if (sub === 'cikartma-sil') {
      await guild.stickers.fetch().catch(() => {});
      const sticker = findSticker(guild, interaction.options.getString('isim', true));
      if (!sticker) throw new UserError('Böyle bir çıkartma yok.');
      await sticker.delete(`${by}: çıkartma sil`);
      return replySuccess(interaction, `**${sticker.name}** çıkartması silindi.`, false);
    }

    if (sub === 'emoji-ekle') {
      const file = interaction.options.getAttachment('dosya');
      const source = interaction.options.getString('kaynak');
      if (!file && !source) throw new UserError('Bir emoji yapıştır, resim linki ver ya da dosya ekle.');
      const parsed = source ? parseEmoji(source) : {};
      const url = safeUrl(file?.url ?? parsed.url ?? '');
      if (!url) throw new UserError('Kaynağı anlayamadım. Başka sunucudaki emojiyi olduğu gibi yapıştır (`<:ad:id>`) ya da resim linki ver.');
      let name = (interaction.options.getString('isim') ?? parsed.name ?? file?.name.replace(/\.\w+$/, '') ?? 'emoji')
        .normalize('NFKD')
        .replace(/[^\w]/g, '_')
        .slice(0, 32);
      if (name.length < 2) name = `emoji_${name}`;

      await interaction.deferReply();
      const buffer = await download(url, EMOJI_MAX);
      const emoji = await guild.emojis.create({ attachment: buffer, name, reason: `${by}: emoji ekle` }).catch((e) => {
        throw new UserError(`Emoji eklenemedi: ${e.code === 30008 ? 'emoji yuvaları dolu' : e.message}`);
      });
      return replySuccess(interaction, `${emoji} \`:${emoji.name}:\` eklendi.`, false);
    }

    // cikartma-ekle
    const name = interaction.options.getString('isim', true).trim();
    if (name.length < 2 || name.length > 30) throw new UserError('Çıkartma adı 2-30 karakter olmalı.');
    let url = interaction.options.getAttachment('dosya')?.url;
    if (!url && interaction.isPrefix && interaction.message.reference) {
      const ref = await interaction.message.fetchReference().catch(() => null);
      const sticker = ref?.stickers.first();
      if (sticker) {
        if (sticker.format === StickerFormatType.Lottie) throw new UserError("Bu çıkartma Discord'a özel (Lottie) biçimde, kopyalanamaz.");
        url = sticker.url;
      } else url = ref?.attachments.first()?.url;
    }
    if (!url) throw new UserError('Bir resim ekle (ya da `kl` ile çıkartmalı bir mesaja yanıt vererek yaz).');

    await interaction.deferReply();
    const buffer = await download(url, STICKER_MAX);
    const tags = interaction.options.getString('etiket')?.trim() || '⭐';
    const sticker = await guild.stickers.create({ file: buffer, name, tags, reason: `${by}: çıkartma ekle` }).catch((e) => {
      throw new UserError(`Çıkartma eklenemedi: ${e.code === 30039 ? 'çıkartma yuvaları dolu' : e.message}`);
    });
    await replySuccess(interaction, `**${sticker.name}** çıkartması eklendi.`, false);
  },
};
