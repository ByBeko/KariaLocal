// Buton/menü/form etkileşimini, verilen seçeneklerle bir komut etkileşimi gibi gösterir.
// Böylece paneller komutun kendi kurallarını (yetki, doğrulama, log) tekrar yazmadan kullanır.
import { MessageFlags } from 'discord.js';
import { runCommand } from '../core/runner.js';

export const withEphemeral = (payload) => ({ ...payload, flags: Number(payload.flags ?? 0) | MessageFlags.Ephemeral });

/**
 * values: seçenek adı → değer (getString/getInteger/getBoolean/getRole/getChannel hepsi buradan okur)
 * capture: dizi verilirse komutun yanıtları gönderilmez, bu diziye toplanır (panel kendi görünümünü günceller).
 * Yoksa yanıtlar butona basana özel (gizli) gider.
 */
export function asCommand(interaction, { sub = null, user = null, member = null, values = {}, capture = null } = {}) {
  const read = (name) => values[name] ?? null;
  const options = {
    data: [],
    getSubcommand: () => sub,
    getUser: (name) => (name === 'kullanici' ? user : read(name)),
    getMember: (name) => (name === 'kullanici' ? member : read(name)),
    getString: read,
    getInteger: read,
    getNumber: read,
    getBoolean: read,
    getRole: read,
    getChannel: read,
  };
  const collect = async (payload) => { capture.push(typeof payload === 'string' ? { content: payload } : payload); };
  const noop = async () => {};
  return new Proxy(interaction, {
    get(target, prop) {
      if (prop === 'options') return options;
      if (capture) {
        if (prop === 'reply' || prop === 'editReply' || prop === 'followUp') return collect;
        if (prop === 'deferReply' || prop === 'deferUpdate') return noop;
        if (prop === 'deferred' || prop === 'replied') return false;
      } else {
        if (prop === 'reply') return (payload) => target.reply(withEphemeral(payload));
        if (prop === 'deferReply') return (payload = {}) => target.deferReply(withEphemeral(payload));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Komutu adıyla, yetki kontrolü ve yetkili logu ile çalıştırır */
export function runAs(interaction, name, opts = {}) {
  const command = interaction.client.commands.get(name);
  const target = opts.user ? ` @${opts.user.username}` : '';
  return runCommand(asCommand(interaction, opts), command, `panel /${name}${opts.sub ? ` ${opts.sub}` : ''}${target}`);
}

/** Toplanan yanıtların düz yazısı (başarı/hata mesajını panelde göstermek için) */
export const capturedText = (payloads) =>
  payloads
    .flatMap((p) => [p.content, ...(p.embeds ?? []).map((em) => (em.data ?? em).description)])
    .filter(Boolean)
    .join('\n');
