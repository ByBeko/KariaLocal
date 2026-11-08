// Discord'da tıklanabilir komut etiketleri: </cal:123>. ID'ler açılışta komutlar yüklenince doldurulur.
import { ApplicationCommandOptionType as T } from 'discord.js';

const ids = new Map();

export function setCommandIds(commands) {
  ids.clear();
  for (const command of commands) ids.set(command.name, command.id);
}

/** Komutun tıklanabilir etiketleri; alt komutu varsa her biri için ayrı etiket döner. */
export function commandRefs(command) {
  const json = command.data.toJSON();
  const id = ids.get(json.name);
  const subs = (json.options ?? []).filter((o) => o.type === T.Subcommand);
  const names = subs.length ? subs.map((s) => `${json.name} ${s.name}`) : [json.name];
  return names.map((name) => (id ? `</${name}:${id}>` : `\`/${name}\``));
}

export function commandRef(client, name) {
  const command = client.commands.get(name);
  return command ? commandRefs(command)[0] : `\`/${name}\``;
}
