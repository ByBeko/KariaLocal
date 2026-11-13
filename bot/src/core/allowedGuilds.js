// Botun çalışabileceği sunucular: Karia (GUILD_ID) her zaman, diğerleri yalnızca sahibin /sunucu-izin ile eklediği sunucular.
// Listede olmayan bir sunucuya eklenirse bot oradan çıkar.
import { db } from './database.js';

db.exec(`CREATE TABLE IF NOT EXISTS allowed_guilds (
  guild_id TEXT PRIMARY KEY,
  note     TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL
)`);

const q = {
  get: db.prepare('SELECT guild_id FROM allowed_guilds WHERE guild_id=?'),
  add: db.prepare('INSERT OR REPLACE INTO allowed_guilds (guild_id, note, added_by, added_at) VALUES (?, ?, ?, ?)'),
  remove: db.prepare('DELETE FROM allowed_guilds WHERE guild_id=?'),
  all: db.prepare('SELECT * FROM allowed_guilds ORDER BY added_at'),
};

export const homeGuildId = () => process.env.GUILD_ID;

export const isAllowedGuild = (guildId) => guildId === homeGuildId() || Boolean(q.get.get(String(guildId)));

export function allowGuild(guildId, addedBy, note = '') {
  q.add.run(String(guildId), String(note).slice(0, 100), String(addedBy), Date.now());
}

export const disallowGuild = (guildId) => Number(q.remove.run(String(guildId)).changes) > 0;

export const allowedGuilds = () => q.all.all();
