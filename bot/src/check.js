// Discord'a bağlanmadan tüm komut ve bileşenlerin yüklendiğini kontrol eder: npm run check
import { loadCommands, loadComponents } from './core/loader.js';

const commands = await loadCommands();
const components = await loadComponents();

for (const command of commands.values()) command.data.toJSON();

console.log(`✔ ${commands.size} komut: ${[...commands.keys()].join(', ')}`);
console.log(`✔ ${components.size} bileşen: ${[...components.keys()].join(', ')}`);
