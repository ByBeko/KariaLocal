import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Collection } from 'discord.js';

const srcDir = path.join(import.meta.dirname, '..');

const jsFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith('.js'));
const importDefault = async (file) => (await import(pathToFileURL(file).href)).default;

/** src/commands/<kategori>/<komut>.js */
export async function loadCommands() {
  const commands = new Collection();
  const base = path.join(srcDir, 'commands');
  for (const category of readdirSync(base)) {
    for (const file of jsFiles(path.join(base, category))) {
      const command = await importDefault(path.join(base, category, file));
      command.category = category;
      commands.set(command.data.name, command);
    }
  }
  return commands;
}

/** src/components/<prefix>.js — customId "prefix:arg1:arg2" olan buton/menü/modal'ları karşılar */
export async function loadComponents() {
  const components = new Collection();
  const base = path.join(srcDir, 'components');
  for (const file of jsFiles(base)) {
    const component = await importDefault(path.join(base, file));
    components.set(component.prefix, component);
  }
  return components;
}

export async function loadEvents(client) {
  const base = path.join(srcDir, 'events');
  for (const file of jsFiles(base)) {
    const event = await importDefault(path.join(base, file));
    const run = async (...args) => {
      try {
        await event.execute(...args);
      } catch (error) {
        console.error(`[Olay hatası: ${event.name}]`, error);
      }
    };
    client[event.once ? 'once' : 'on'](event.name, run);
  }
}
