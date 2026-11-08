import { Events } from 'discord.js';
import { handleAuditEntry } from '../systems/auditlog.js';
import { handleNukeEntry } from '../systems/antinuke.js';

// "Kim yaptı" bilgisi gereken loglar (rol, takma ad, elle ban/kick/zaman aşımı, kanal/rol/sunucu değişiklikleri)
export default {
  name: Events.GuildAuditLogEntryCreate,
  async execute(entry, guild) {
    await handleNukeEntry(entry, guild).catch((e) => console.error('[Toplu saldırı koruması]', e.message));
    await handleAuditEntry(entry, guild).catch((e) => console.error('[Denetim kaydı log]', e.message));
  },
};
