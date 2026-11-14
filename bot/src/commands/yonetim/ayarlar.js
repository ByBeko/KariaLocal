import {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags, ChannelType,
  ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { Level } from '../../utils/permissions.js';
import { SETTINGS, settingsOfType, formatSetting, getSetting } from '../../core/settings.js';
import { kariaEmbed } from '../../utils/embeds.js';
import { e } from '../../utils/emojis.js';
import { getRewards } from '../../systems/levels.js';
import { getRoleMenu } from '../../systems/panels.js';
import { getAutoResponses } from '../../systems/autoresponse.js';

// Etkileşimli ayar paneli: grup seç → ayar seç → kanal/rol menüsü, aç-kapa ya da form. Butonlar components/ayarlar.js'te.
const groups = () => [
  ['channel', `${e('pano', '📁')} Kanallar`, 'Hoş geldin, log, jail, talep kanalları'],
  ['role', `${e('rozet', '🎭')} Roller`, 'Üye, jail ve yetki rolleri'],
  ['bool', `${e('ayarlar', '🔘')} Özellikler`, 'Korumalar, seviye, ekonomi aç/kapat'],
  ['number', `${e('hedef', '🔢')} Sayılar`, 'Raid eşiği, uyarı sınırı, hesap yaşı'],
  ['text', `${e('kalem', '📝')} Yazılar`, 'Hoş geldin mesajı, izinli linkler, yasaklı kelimeler'],
];
/** Liste yönetimi grupları: ekleme/silme ilgili komutun kendisiyle yapılır (components/ayarlar.js) */
const lists = () => [
  ['odul', `${e('kupa', '🏆')} Seviye Ödülleri`, 'Hangi seviyede hangi rol verilir'],
  ['otocevap', `${e('simsek', '⚡')} Oto Cevaplar`, 'Belirli mesajlara otomatik cevap'],
  ['rolmenu', `${e('rozet', '🎭')} Rol Menüsü`, 'Üyelerin kendi seçtiği roller'],
];
export const LIST_KINDS = new Set(['odul', 'otocevap', 'rolmenu']);
const GROUP_LABEL = (type) => [...groups(), ...lists()].find(([t]) => t === type)?.[1] ?? type;
const CHANNEL_TYPES = {
  text: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
  voice: [ChannelType.GuildVoice],
  category: [ChannelType.GuildCategory],
};

const groupSelect = (selected) =>
  new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ayarlar:grup')
      .setPlaceholder('Bir ayar grubu seç...')
      .addOptions({ label: 'Özet', value: 'ana', description: 'Tüm ayarlar tek sayfada', emoji: e('ev', '🏠') }, ...[...groups(), ...lists()].map(([type, title, description]) => ({ label: title.replace(/^\S+\s/, ''), value: type, description, default: type === selected }))),
  );

/** Ana görünüm: tüm ayarların özeti + grup menüsü */
export function homeView(guild, client) {
  const embed = kariaEmbed(client, 'Bot Ayarları', { footer: 'Değiştirmek için aşağıdan bir grup seç' })
    .setTitle(guild.name)
    .setThumbnail(guild.iconURL({ size: 256 }));
  for (const [type, title] of groups()) {
    const lines = settingsOfType(type).map(([key, s]) => `**${s.label}:** ${formatSetting(guild.id, key)}`);
    embed.addFields({ name: title, value: lines.join('\n').slice(0, 1024) });
  }
  return { embeds: [embed], components: [groupSelect()] };
}

/** Bir grubun ayarları + o gruptan ayar seçme menüsü */
export function groupView(guild, client, type, note) {
  const list = settingsOfType(type);
  const embed = kariaEmbed(client, 'Bot Ayarları', { footer: type === 'bool' ? 'Seçtiğin özellik açılır/kapanır' : 'Değiştirmek istediğin ayarı seç' })
    .setTitle(GROUP_LABEL(type))
    .setDescription([note, ...list.map(([key, s]) => `**${s.label}:** ${formatSetting(guild.id, key)}`)].filter(Boolean).join('\n').slice(0, 4096));
  const select = new StringSelectMenuBuilder()
    .setCustomId(`ayarlar:sec:${type}`)
    .setPlaceholder(type === 'bool' ? 'Açıp kapatmak istediğin özelliği seç' : 'Değiştirmek istediğin ayarı seç')
    .addOptions(
      list.slice(0, 25).map(([key, s]) => ({
        label: s.label.slice(0, 100),
        value: key,
        ...(type === 'bool' ? { emoji: getSetting(guild.id, key) ? '✅' : '❌' } : {}),
      })),
    );
  return { embeds: [embed], components: [groupSelect(type), new ActionRowBuilder().addComponents(select)] };
}

const row = (component) => new ActionRowBuilder().addComponents(component);
const removeSelect = (id, placeholder, options) =>
  options.length ? [row(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(options.slice(0, 25)))] : [];

/** Seviye ödülleri / oto cevaplar / rol menüsü: liste + ekleme ve silme menüleri */
export function listView(guild, client, kind, note) {
  const embed = kariaEmbed(client, 'Bot Ayarları').setTitle(GROUP_LABEL(kind));
  const roleName = (id) => guild.roles.cache.get(id)?.name ?? 'silinmiş rol';
  let lines;
  let components;

  if (kind === 'odul') {
    const rewards = getRewards(guild.id);
    lines = rewards.map((r) => `**Seviye ${r.level}** → <@&${r.roleId}>`);
    components = [
      row(new RoleSelectMenuBuilder().setCustomId('ayarlar:odulrol').setPlaceholder('Ödül eklemek için rol seç (sonra seviye sorulur)')),
      ...removeSelect('ayarlar:odulsil', 'Silmek istediğin ödülü seç', rewards.map((r) => ({ label: `Seviye ${r.level}: @${roleName(r.roleId)}`.slice(0, 100), value: r.roleId }))),
    ];
  } else if (kind === 'rolmenu') {
    const items = getRoleMenu(guild.id);
    lines = items.map((r) => `${r.emoji ? `${r.emoji} ` : ''}<@&${r.role_id}>${r.description ? ` — ${r.description}` : ''}`);
    components = [
      row(new RoleSelectMenuBuilder().setCustomId('ayarlar:rmrol').setPlaceholder('Menüye eklemek için rol seç (sonra emoji/açıklama sorulur)')),
      ...removeSelect('ayarlar:rmsil', 'Menüden çıkarmak istediğin rolü seç', items.map((r) => ({ label: `@${roleName(r.role_id)}`.slice(0, 100), value: r.role_id }))),
    ];
  } else {
    const items = getAutoResponses(guild.id);
    lines = items.map((r) => `\`${r.trigger}\`${r.exact ? ' (tam)' : ''} → ${r.response.replaceAll('\n', ' ').slice(0, 80)}`);
    components = [
      row(new ButtonBuilder().setCustomId('ayarlar:ocekle').setLabel('Oto Cevap Ekle').setEmoji(e('arti', '➕')).setStyle(ButtonStyle.Success)),
      ...removeSelect('ayarlar:ocsil', 'Silmek istediğin oto cevabı seç', items.map((r) => ({ label: r.trigger.slice(0, 100), value: r.trigger.slice(0, 100), description: r.response.replaceAll('\n', ' ').slice(0, 100) }))),
    ];
  }
  embed.setDescription([note, lines.join('\n') || 'Henüz kayıt yok.'].filter(Boolean).join('\n\n').slice(0, 4096));
  return { embeds: [embed], components: [groupSelect(kind), ...components] };
}

/** Liste eklemelerinde sorulan form */
export function listModal(kind, roleId) {
  const input = (id, label, { required = false, max = 100, paragraph = false, placeholder } = {}) => {
    const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(required).setMaxLength(max);
    if (placeholder) field.setPlaceholder(placeholder);
    return row(field);
  };
  if (kind === 'odul') {
    return new ModalBuilder().setCustomId(`ayarlar:odulform:${roleId}`).setTitle('Seviye Ödülü Ekle').addComponents(input('seviye', 'Kaçıncı seviyede verilsin? (1-500)', { required: true, max: 3 }));
  }
  if (kind === 'rolmenu') {
    return new ModalBuilder().setCustomId(`ayarlar:rmform:${roleId}`).setTitle('Rol Menüsüne Ekle').addComponents(
      input('emoji', 'Emoji (isteğe bağlı)', { max: 60 }),
      input('aciklama', 'Kısa açıklama (isteğe bağlı)'),
    );
  }
  return new ModalBuilder().setCustomId('ayarlar:ocform').setTitle('Oto Cevap Ekle').addComponents(
    input('tetik', 'Tetik (örn. sa, ip ne)', { required: true }),
    input('cevap', 'Cevap ({user} {server} {count} {ip} {site})', { required: true, max: 1500, paragraph: true }),
    input('tam', 'Sadece tam eşleşmede mi? (evet / hayır)', { max: 5, placeholder: 'hayır' }),
  );
}

/** Kanal ya da rol ayarı: seçici menü + sıfırla/geri butonları */
export function settingView(guild, client, key) {
  const def = SETTINGS[key];
  const type = def.type;
  const embed = kariaEmbed(client, 'Bot Ayarları', { footer: 'Boş bırakmak için Sıfırla' })
    .setTitle(def.label)
    .setDescription(`Şu an: ${formatSetting(guild.id, key)}`);
  const picker =
    type === 'channel'
      ? new ChannelSelectMenuBuilder().setCustomId(`ayarlar:kanal:${key}`).setPlaceholder('Kanal seç').setChannelTypes(...CHANNEL_TYPES[def.kind])
      : new RoleSelectMenuBuilder().setCustomId(`ayarlar:rol:${key}`).setPlaceholder('Rol seç');
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ayarlar:geri:${type}`).setLabel('Geri').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ayarlar:sifirla:${key}`).setLabel('Sıfırla').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(picker), buttons] };
}

/** Sayı ya da yazı ayarı için form */
export function settingModal(guild, key) {
  const def = SETTINGS[key];
  const current = getSetting(guild.id, key);
  const input = new TextInputBuilder()
    .setCustomId('deger')
    .setLabel(def.type === 'number' ? 'Değer (boş = varsayılan)' : 'Yazı (boş = varsayılan)')
    .setStyle(def.type === 'number' ? TextInputStyle.Short : TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(def.type === 'number' ? 10 : 1000);
  if (current !== null && current !== '') input.setValue(String(current).slice(0, 1000));
  return new ModalBuilder()
    .setCustomId(`ayarlar:form:${key}`)
    .setTitle(def.label.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(input));
}

export default {
  level: Level.ADMIN,
  data: new SlashCommandBuilder()
    .setName('ayarlar')
    .setDescription('Botun tüm ayarlarını gösterir ve menülerle değiştirir.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.reply({ ...homeView(interaction.guild, interaction.client), flags: MessageFlags.Ephemeral });
  },
};
