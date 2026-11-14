// /ayarlar panelinin menü, buton ve formları. Değişiklik web paneliyle aynı kurallardan (changeSetting) geçer.
import { MessageFlags } from 'discord.js';
import { SETTINGS, getSetting } from '../core/settings.js';
import { changeSetting, isPanelAdmin } from '../activity/admin.js';
import { homeView, groupView, settingView, settingModal, listView, listModal, LIST_KINDS } from '../commands/yonetim/ayarlar.js';
import { UserError } from '../utils/errors.js';
import { runAs, capturedText } from '../utils/asCommand.js';

export default {
  prefix: 'ayarlar',
  async execute(interaction, [action, arg]) {
    const { guild, client, member } = interaction;
    if (!isPanelAdmin(member)) return interaction.reply({ content: 'Ayarları sadece yöneticiler değiştirebilir.', flags: MessageFlags.Ephemeral });

    const key = Object.hasOwn(SETTINGS, arg ?? '') ? arg : null;
    const save = async (value) => {
      await changeSetting(guild, member, { key, value });
      return `✅ **${SETTINGS[key].label}** güncellendi.`;
    };

    // Liste işlemleri ilgili komutun kendisiyle yapılır; komutun yanıtı panelde not olarak görünür
    const apply = async (kind, name, opts) => {
      await interaction.deferUpdate();
      const out = [];
      await runAs(interaction, name, { ...opts, capture: out });
      await interaction.editReply(listView(guild, client, kind, capturedText(out)));
    };
    const role = (id) => guild.roles.cache.get(id) ?? null;
    const field = (id) => interaction.fields.getTextInputValue(id).trim();

    switch (action) {
      case 'grup': {
        const picked = interaction.values[0];
        if (picked === 'ana') return interaction.update(homeView(guild, client));
        return interaction.update(LIST_KINDS.has(picked) ? listView(guild, client, picked) : groupView(guild, client, picked));
      }
      case 'odulrol':
        return interaction.showModal(listModal('odul', interaction.values[0]));
      case 'rmrol':
        return interaction.showModal(listModal('rolmenu', interaction.values[0]));
      case 'ocekle':
        return interaction.showModal(listModal('otocevap'));
      case 'odulform': {
        const level = Number.parseInt(field('seviye'), 10);
        if (!Number.isInteger(level) || level < 1 || level > 500) throw new UserError('Seviye 1 ile 500 arasında olmalı.');
        return apply('odul', 'seviye-ayar', { sub: 'odul-ekle', values: { seviye: level, rol: role(arg) } });
      }
      case 'odulsil':
        return apply('odul', 'seviye-ayar', { sub: 'odul-sil', values: { rol: role(interaction.values[0]) } });
      case 'rmform':
        return apply('rolmenu', 'rol-menu', { sub: 'ekle', values: { rol: role(arg), emoji: field('emoji') || null, aciklama: field('aciklama') || null } });
      case 'rmsil':
        return apply('rolmenu', 'rol-menu', { sub: 'cikar', values: { rol: role(interaction.values[0]) } });
      case 'ocform':
        return apply('otocevap', 'oto-cevap', { sub: 'ekle', values: { tetik: field('tetik'), cevap: field('cevap'), tam_eslesme: /^(e|evet|yes|1|true)$/i.test(field('tam')) } });
      case 'ocsil':
        return apply('otocevap', 'oto-cevap', { sub: 'sil', values: { tetik: interaction.values[0] } });
      case 'geri':
        return interaction.update(groupView(guild, client, arg));
      case 'sec': {
        const picked = interaction.values[0];
        const def = SETTINGS[picked];
        if (!def) return;
        if (def.type === 'bool') {
          await changeSetting(guild, member, { key: picked, value: !getSetting(guild.id, picked) });
          return interaction.update(groupView(guild, client, 'bool', `✅ **${def.label}** ${getSetting(guild.id, picked) ? 'açıldı' : 'kapatıldı'}.\n`));
        }
        if (def.type === 'number' || def.type === 'text') return interaction.showModal(settingModal(guild, picked));
        return interaction.update(settingView(guild, client, picked));
      }
    }

    if (!key) throw new UserError('Böyle bir ayar yok.');
    const type = SETTINGS[key].type;
    if (action === 'kanal' || action === 'rol') return interaction.update(groupView(guild, client, type, `${await save(interaction.values[0])}\n`));
    if (action === 'sifirla') return interaction.update(groupView(guild, client, type, `${await save(null)}\n`));
    if (action === 'form') {
      const note = await save(interaction.fields.getTextInputValue('deger').trim());
      // Form, mesajın kendisinden açıldıysa mesaj güncellenir
      if (interaction.isFromMessage?.()) return interaction.update(groupView(guild, client, type, `${note}\n`));
      return interaction.reply({ content: note, flags: MessageFlags.Ephemeral });
    }
  },
};
