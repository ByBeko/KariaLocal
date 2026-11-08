import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadCommands, loadComponents, loadEvents } from './core/loader.js';

if (!process.env.DISCORD_TOKEN) {
  console.error('.env dosyasında DISCORD_TOKEN yok. .env.example dosyasını .env olarak kopyalayıp doldur.');
  process.exit(1);
}

// Tek kopya koruması: aynı token ile iki bot çalışırsa butonlar/komutlar "Unknown interaction" hatası verir.
const dataDir = path.join(import.meta.dirname, '..', 'data');
const lockFile = path.join(dataDir, 'bot.pid');
mkdirSync(dataDir, { recursive: true });
try {
  const pid = Number(readFileSync(lockFile, 'utf8'));
  if (pid && pid !== process.pid) {
    process.kill(pid, 0); // işlem yaşıyorsa hata fırlatmaz
    console.error(`✖ Bot zaten çalışıyor (PID ${pid}). Önce onu kapat. Emin olarak kapattıysan data/bot.pid dosyasını sil.`);
    process.exit(1);
  }
} catch (error) {
  if (error.code === 'EPERM') {
    console.error('✖ Bot zaten başka bir kullanıcı tarafından çalışıyor.');
    process.exit(1);
  }
  // ENOENT (dosya yok) veya ESRCH (eski işlem ölmüş) → devam
}
writeFileSync(lockFile, String(process.pid));
process.on('exit', () => {
  try {
    if (Number(readFileSync(lockFile, 'utf8')) === process.pid) rmSync(lockFile);
  } catch {}
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));

// Presence Intent (özel durum taraması için) Developer Portal'da açıksa kullanılır, kapalıysa bot yine açılır.
const app = await fetch('https://discord.com/api/v10/applications/@me', { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } })
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
const presenceEnabled = Boolean(app && app.flags & ((1 << 12) | (1 << 13))); // GATEWAY_PRESENCE | GATEWAY_PRESENCE_LIMITED

const client = new Client({
  intents: [
    ...(presenceEnabled ? [GatewayIntentBits.GuildPresences] : []),
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // ayrıcalıklı: Developer Portal'dan açılmalı
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // ayrıcalıklı: Developer Portal'dan açılmalı
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration, // ban olayları + denetim kaydı (kim yaptı) logları
    GatewayIntentBits.GuildInvites, // davet takibi
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

client.presenceEnabled = presenceEnabled;
client.commands = await loadCommands();
client.components = await loadComponents();
await loadEvents(client);

process.on('unhandledRejection', (error) => console.error('[Yakalanmamış hata]', error));

await client.login(process.env.DISCORD_TOKEN);
