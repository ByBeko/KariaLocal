// "kl <komut> <argümanlar>" mesajlarını slash komutlarıyla aynı kodla çalıştırır.
// Mesajdaki argümanlar, komutun slash seçeneklerine (SlashCommandBuilder) göre ayrıştırılır;
// komut dosyaları sanki gerçek bir /komut etkileşimi gelmiş gibi çalışır.

import { ApplicationCommandOptionType as T } from 'discord.js';
import config from '../config.js';
import { chatWithAI } from '../systems/ai.js';
import { UserError } from '../utils/errors.js';
import { errorEmbed } from '../utils/embeds.js';
import { checkAccess } from '../utils/permissions.js';
import { usageLines } from '../systems/help.js';
import { runCommand } from './runner.js';

const TRUE_WORDS = ['evet', 'e', 'true', 'ac', 'aç', 'acik', 'açık', 'on', '1'];
const FALSE_WORDS = ['hayir', 'hayır', 'h', 'false', 'kapat', 'kapali', 'kapalı', 'off', '0'];

/** Boşluklara göre böler; "tırnak içindeki" kısımlar tek parça sayılır. */
export function tokenize(text) {
  const tokens = [];
  for (const m of text.matchAll(/"([^"]*)"|“([^”]*)”|(\S+)/g)) {
    tokens.push(m[3] !== undefined ? { text: m[3], quoted: false } : { text: m[1] ?? m[2], quoted: true });
  }
  return tokens;
}

const idFrom = (raw, mentionRe) => raw.match(mentionRe)?.[1] ?? (/^\d{17,20}$/.test(raw) ? raw : null);
const lower = (s) => s.toLocaleLowerCase('tr');

function looksLike(opt, text) {
  switch (opt.type) {
    case T.Integer: return /^-?\d+$/.test(text);
    case T.Number: return Number.isFinite(Number(text.replace(',', '.')));
    case T.Boolean: return TRUE_WORDS.includes(lower(text)) || FALSE_WORDS.includes(lower(text));
    case T.User:
    case T.Mentionable: return /^<@!?\d+>$/.test(text) || /^\d{17,20}$/.test(text);
    case T.Channel: return /^<#\d+>$/.test(text);
    case T.Role: return /^<@&\d+>$/.test(text);
    default: return false;
  }
}

async function resolveValue(message, opt, raw) {
  const { guild, client } = message;
  const bad = (why) => new UserError(`\`${opt.name}\` için geçersiz değer: **${raw}**${why ? ` (${why})` : ''}`);

  switch (opt.type) {
    case T.String: {
      if (opt.choices?.length) {
        const choice = opt.choices.find((c) => lower(String(c.value)) === lower(raw) || lower(c.name) === lower(raw));
        if (!choice) throw bad(`seçenekler: ${opt.choices.map((c) => `\`${c.value}\``).join(', ')}`);
        return choice.value;
      }
      if (opt.min_length && raw.length < opt.min_length) throw bad(`en az ${opt.min_length} karakter`);
      if (opt.max_length && raw.length > opt.max_length) throw bad(`en fazla ${opt.max_length} karakter`);
      return raw;
    }
    case T.Integer:
    case T.Number: {
      const n = Number(raw.replace(',', '.'));
      if (!Number.isFinite(n) || (opt.type === T.Integer && !Number.isInteger(n))) throw bad('sayı olmalı');
      if (opt.min_value !== undefined && n < opt.min_value) throw bad(`en az ${opt.min_value}`);
      if (opt.max_value !== undefined && n > opt.max_value) throw bad(`en fazla ${opt.max_value}`);
      if (opt.choices?.length && !opt.choices.some((c) => c.value === n)) throw bad();
      return n;
    }
    case T.Boolean: {
      if (TRUE_WORDS.includes(lower(raw))) return true;
      if (FALSE_WORDS.includes(lower(raw))) return false;
      throw bad('evet / hayır yaz');
    }
    case T.User:
    case T.Mentionable: {
      const id = idFrom(raw, /^<@!?(\d+)>$/);
      const user = id && (await client.users.fetch(id).catch(() => null));
      if (!user) throw bad('kullanıcı bulunamadı, etiketle ya da ID yaz');
      const member = await guild.members.fetch(id).catch(() => null);
      return { user, member };
    }
    case T.Channel: {
      const id = idFrom(raw, /^<#(\d+)>$/);
      const name = lower(raw.replace(/^#/, ''));
      const channel = id ? guild.channels.cache.get(id) : guild.channels.cache.find((c) => lower(c.name) === name);
      if (!channel) throw bad('kanal bulunamadı, #kanal şeklinde etiketle');
      if (opt.channel_types?.length && !opt.channel_types.includes(channel.type)) throw bad('bu tür kanal kabul edilmiyor');
      return channel;
    }
    case T.Role: {
      const id = idFrom(raw, /^<@&(\d+)>$/);
      const name = lower(raw.replace(/^@/, ''));
      const role = id ? guild.roles.cache.get(id) : guild.roles.cache.find((r) => lower(r.name) === name);
      if (!role) throw bad('rol bulunamadı, @rol şeklinde etiketle ya da "Rol Adı" yaz');
      return role;
    }
    default:
      return raw;
  }
}

/**
 * Argüman metnini komutun seçeneklerine göre ayrıştırır.
 * Yazı (string) seçenekleri:
 *  - son seçenekse kalan her şeyi alır  →  kl uyar @ali küfür etti
 *  - sonrasında sadece isteğe bağlı sayı/kullanıcı vb. varsa, sondaki uyan değerleri onlara bırakır
 *      →  kl ban @ali reklam yaptı 7   (sebep: "reklam yaptı", mesaj_sil: 7)
 *  - aksi halde tek kelime alır; boşluklu değer için "tırnak" kullanılır
 */
export async function parseArgs(message, command, argText) {
  const json = command.data.toJSON();
  let options = json.options ?? [];
  let subcommand = null;
  const tokens = tokenize(argText);
  const usage = () => new UserError(`Eksik ya da hatalı kullanım. Doğru kullanım:\n${usageLines(command, 'prefix').join('\n')}`);

  const subs = options.filter((o) => o.type === T.Subcommand);
  if (subs.length) {
    // Alt komut yazılmadıysa komutun defaultSub'ı kullanılır: "kl rank @ali" = "kl rank kart @ali"
    let sub = subs.find((s) => s.name === lower(tokens[0]?.text ?? ''));
    if (sub) tokens.shift();
    else if (command.defaultSub) sub = subs.find((s) => s.name === command.defaultSub);
    if (!sub) throw usage();
    subcommand = sub.name;
    options = sub.options ?? [];
  }

  const values = new Map();
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];

    if (opt.type === T.Attachment) {
      const file = message.attachments.first();
      if (file) values.set(opt.name, file);
      else if (opt.required) throw usage();
      continue;
    }
    if (!tokens.length) {
      if (opt.required) throw usage();
      continue;
    }

    let raw;
    const rest = options.slice(i + 1).filter((o) => o.type !== T.Attachment);
    if (opt.type === T.String && !tokens[0].quoted) {
      if (!rest.length) {
        raw = tokens.splice(0).map((t) => t.text).join(' ');
      } else if (rest.some((o) => o.type === T.String || o.required)) {
        raw = tokens.shift().text;
      } else {
        let keep = 0;
        for (let j = rest.length - 1, t = tokens.length - 1; j >= 0 && t >= 1; j--, t--) {
          if (!looksLike(rest[j], tokens[t].text)) break;
          keep++;
        }
        raw = tokens.splice(0, tokens.length - keep).map((t) => t.text).join(' ');
        i += rest.length - keep; // eşleşmeyen ara seçenekleri atla
      }
    } else {
      raw = tokens.shift().text;
    }
    values.set(opt.name, await resolveValue(message, opt, raw));
  }

  return { subcommand, values };
}

/** Komut kodlarının kullandığı ChatInputCommandInteraction arayüzünün mesaj versiyonu */
export class PrefixInteraction {
  constructor(message, command, { subcommand, values }) {
    this.message = message;
    this.commandName = command.data.name;
    this.isPrefix = true;
    this.deferred = false;
    this.replied = false;
    this.replyMessage = null;
    this.summary = message.content.slice(0, 500); // mod-log için

    const get = (name) => values.get(name) ?? null;
    this.options = {
      getSubcommand: () => subcommand,
      getString: get,
      getInteger: get,
      getNumber: get,
      getBoolean: get,
      getChannel: get,
      getRole: get,
      getAttachment: get,
      getUser: (name) => values.get(name)?.user ?? null,
      getMember: (name) => values.get(name)?.member ?? null,
    };
  }

  get client() { return this.message.client; }
  get guild() { return this.message.guild; }
  get member() { return this.message.member; }
  get user() { return this.message.author; }
  get channel() { return this.message.channel; }
  get channelId() { return this.message.channelId; }
  get createdTimestamp() { return this.message.createdTimestamp; }
  inGuild() { return true; }
  inCachedGuild() { return true; }
  isChatInputCommand() { return true; }

  static clean(payload) {
    const data = typeof payload === 'string' ? { content: payload } : { ...payload };
    delete data.flags;
    delete data.ephemeral;
    delete data.fetchReply;
    delete data.withResponse;
    data.allowedMentions ??= { repliedUser: false };
    return data;
  }

  async deferReply() {
    this.deferred = true;
    await this.channel.sendTyping().catch(() => {});
  }

  async reply(payload) {
    this.replyMessage = await this.message.reply(PrefixInteraction.clean(payload));
    this.replied = true;
    return this.replyMessage;
  }

  // Slash davranışı gibi: editReply "replied" durumunu değiştirmez, hep aynı mesajı günceller
  async editReply(payload) {
    if (!this.replyMessage) {
      this.replyMessage = await this.message.reply(PrefixInteraction.clean(payload));
      return this.replyMessage;
    }
    return this.replyMessage.edit(PrefixInteraction.clean(payload));
  }

  async followUp(payload) {
    return this.channel.send(PrefixInteraction.clean(payload));
  }

  async fetchReply() { return this.replyMessage; }
  async deleteReply() { await this.replyMessage?.delete().catch(() => {}); }
  async showModal() { throw new UserError('Bu komut sadece `/` ile kullanılabilir.'); }
}

/** Mesaj "kari / kl / k ..." ile başlıyorsa komutu çalıştırır (komut değilse yapay zekayla sohbet) ve true döner. */
export async function handlePrefix(message) {
  const content = message.content.trim();
  // "KARI" Türkçe küçültmede "karı" olur: iki küçültme de denenir. Uzun ön ek önce ("kari" → "k" sanılmasın)
  const variants = [lower(content), content.toLowerCase()];
  const matches = (p) => variants.some((v) => v === p || v.startsWith(`${p} `));
  const prefix = [...config.prefixes].sort((a, b) => b.length - a.length).find(matches);
  if (!prefix) return false;
  if (content.length === prefix.length && prefix.length === 1) return false; // tek başına "k" (tamam anlamında) yok sayılır

  const body = content.slice(prefix.length).trim();
  const first = body.split(/\s+/)[0];
  const name = lower(first) || 'yardim';
  const argText = body.slice(first.length).trim();

  const { commands } = message.client;
  const command = commands.get(name) ?? commands.find((c) => c.aliases?.includes(name));
  const fail = (text) => message.reply({ embeds: [errorEmbed(text)], allowedMentions: { repliedUser: false } }).catch(() => {});

  if (!command) {
    // Komut değil: yapay zekayla sohbet ("kari naber", "kl minecraft'ta elmas nerede çıkar")
    // Tek harfli "k" ile en az 2 kelime gerekir; "k tamam" gibi günlük mesajlar yakalanmasın
    if (prefix.length === 1 && body.split(/\s+/).length < 2) return false;
    await chatWithAI(message, body);
    return true;
  }
  const denied = checkAccess(message.member, command);
  if (denied) {
    await fail(denied);
    return true;
  }

  let parsed;
  try {
    parsed = await parseArgs(message, command, argText);
  } catch (error) {
    if (error instanceof UserError) await fail(error.message);
    else console.error(`[${prefix} ${name} ayrıştırma]`, error);
    return true;
  }

  await runCommand(new PrefixInteraction(message, command, parsed), command, `${prefix} ${name}`);
  return true;
}
