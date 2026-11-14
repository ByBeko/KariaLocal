// /bilgi altındaki butonlar: komutu, butona basan kişiye özel (gizli) olarak çalıştırır.
// Yetkili butonları (uyar, sustur, jail, ban...) önce sebep/süre formu açar, sonra komutu yetki kontrolüyle çalıştırır.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { listView } from '../systems/lists.js';
import { linksPanel } from '../systems/panels.js';
import { checkAccess, isStaff } from '../utils/permissions.js';
import { e } from '../utils/emojis.js';
import { runAs as run, withEphemeral } from '../utils/asCommand.js';

// ── Yetkili işlemleri ──
const MOD_ACTIONS = [
  ['uyar', 'Uyar', 'unlem', '⚠️', ButtonStyle.Secondary],
  ['mute', 'Sustur', 'sessiz', '🔇', ButtonStyle.Secondary],
  ['unmute', 'Susturmayı Kaldır', 'mikrofon', '🔊', ButtonStyle.Secondary],
  ['sicil', 'Sicil', 'kitap', '📋', ButtonStyle.Secondary],
  ['jail', 'Jail', 'kilit', '⛓️', ButtonStyle.Danger],
  ['unjail', 'Jail Kaldır', 'anahtar', '🔓', ButtonStyle.Secondary],
  ['kick', 'At', 'cikis', '👢', ButtonStyle.Danger],
  ['ban', 'Banla', 'tokmak', '🔨', ButtonStyle.Danger],
];

/** Formdaki alanlar: [seçenek adı, etiket, zorunlu mu, ipucu] */
const MOD_FIELDS = {
  uyar: [['sebep', 'Sebep', true, 'Neden uyarılıyor?']],
  mute: [['sure', 'Süre', true, 'Örn: 10dk, 1sa, 2g (en fazla 28g)'], ['sebep', 'Sebep', false, '']],
  unmute: [['sebep', 'Sebep', false, '']],
  jail: [['sure', 'Süre', false, 'Örn: 1sa, 3g (boş = süresiz)'], ['sebep', 'Sebep', false, '']],
  unjail: [['sebep', 'Sebep', false, '']],
  kick: [['sebep', 'Sebep', false, '']],
  ban: [['sebep', 'Sebep', false, ''], ['mesaj_sil', 'Son kaç günün mesajı silinsin? (0-7)', false, '0']],
};

/** Yetkilinin bu kişiye uygulayabileceği işlemlerin butonları (seviyesi yetmeyenler çıkmaz) */
export function staffRows(member, targetId) {
  const buttons = MOD_ACTIONS.filter(([name]) => {
    const command = member.client.commands.get(name);
    return command && !checkAccess(member, command);
  }).map(([name, text, key, fallback, style]) =>
    new ButtonBuilder().setCustomId(`bilgi:mod:${name}:${targetId}`).setLabel(text).setEmoji(e(key, fallback)).setStyle(style),
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 4) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 4)));
  return rows;
}

function modModal(name, target) {
  const title = MOD_ACTIONS.find(([n]) => n === name)[1];
  return new ModalBuilder()
    .setCustomId(`bilgi:modal:${name}:${target.id}`)
    .setTitle(`${title}: ${target.username}`.slice(0, 45))
    .addComponents(
      MOD_FIELDS[name].map(([id, text, required, placeholder]) => {
        const input = new TextInputBuilder()
          .setCustomId(id)
          .setLabel(text)
          .setStyle(id === 'sebep' ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(required)
          .setMaxLength(id === 'sebep' ? 500 : 20);
        if (placeholder) input.setPlaceholder(placeholder);
        return new ActionRowBuilder().addComponents(input);
      }),
    );
}

function modalValues(interaction, name) {
  const values = {};
  for (const [id] of MOD_FIELDS[name]) {
    const raw = interaction.fields.getTextInputValue(id).trim();
    if (!raw) continue;
    values[id] = id === 'mesaj_sil' ? Math.max(0, Math.min(7, Number.parseInt(raw, 10) || 0)) : raw;
  }
  return values;
}

async function findTarget(interaction, targetId) {
  const user = await interaction.client.users.fetch(targetId).catch(() => null);
  if (!user) return null;
  const member = interaction.guild.members.cache.get(user.id) ?? (await interaction.guild.members.fetch(user.id).catch(() => null));
  return { user, member };
}

export default {
  prefix: 'bilgi',
  async execute(interaction, args) {
    const [action] = args;
    const { guild, user, member } = interaction;
    const hidden = (payload) => interaction.reply(withEphemeral(payload));

    switch (action) {
      // Sunucu bilgisi butonları
      case 'roller':
        return hidden(listView('rol', guild, user.id, 0));
      case 'emoji':
        return hidden(listView('emoji', guild, user.id, 0));
      case 'baglantilar':
        return hidden(linksPanel(guild));
      case 'siralama':
        return run(interaction, 'siralama');
      case 'oduller':
        return run(interaction, 'seviye', { sub: 'oduller' });
    }

    // Yetkili işlemleri: bilgi:yetkili:<hedef>, bilgi:mod:<komut>:<hedef>, bilgi:modal:<komut>:<hedef>
    if (action === 'yetkili' || action === 'mod' || action === 'modal') {
      if (!isStaff(member)) return hidden({ content: 'Bu butonlar sadece yetkililer için.' });
      const name = action === 'yetkili' ? null : args[1];
      if (name && !MOD_FIELDS[name] && name !== 'sicil') return;
      const target = await findTarget(interaction, action === 'yetkili' ? args[1] : args[2]);
      if (!target) return hidden({ content: 'Kullanıcı bulunamadı.' });

      if (action === 'yetkili') {
        return hidden({ content: `${e('kalkan2', '🛡️')} **${target.user.username}** için yetkili işlemleri:`, components: staffRows(member, target.user.id) });
      }
      if (action === 'mod' && name !== 'sicil') return interaction.showModal(modModal(name, target.user));
      const values = action === 'modal' ? modalValues(interaction, name) : {};
      return run(interaction, name, { ...target, values });
    }

    // Kullanıcı bilgisi butonları: hedef kişi customId'de
    const target = (await findTarget(interaction, args[1])) ?? { user, member };
    if (action === 'avatar') return run(interaction, 'avatar', target);
    if (action === 'kart') return run(interaction, 'seviye', { ...target, sub: 'kart' });
    if (action === 'istatistik') return run(interaction, 'istatistik', target);
  },
};
