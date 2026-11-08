// /rapor ile gelen bildirimler. Yönetim panelinde listelenir ve çözüldü olarak işaretlenir.
import { db } from '../core/database.js';

const q = {
  add: db.prepare('INSERT INTO reports (guild_id, reporter_id, target_id, reason, link, channel_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  list: db.prepare('SELECT * FROM reports WHERE guild_id = ? ORDER BY resolved_at IS NOT NULL, id DESC LIMIT ?'),
  open: db.prepare('SELECT count(*) n FROM reports WHERE guild_id = ? AND resolved_at IS NULL'),
  resolve: db.prepare('UPDATE reports SET resolved_at = ?, resolved_by = ? WHERE id = ? AND guild_id = ? AND resolved_at IS NULL'),
};

export const addReport = (guildId, { reporterId, targetId, reason, link, channelId }) => q.add.run(guildId, reporterId, targetId, reason, link ?? null, channelId, Date.now());
export const listReports = (guildId, limit = 40) => q.list.all(guildId, limit);
export const openReportCount = (guildId) => Number(q.open.get(guildId).n);
export const resolveReport = (guildId, id, modId) => Number(q.resolve.run(Date.now(), modId, id, guildId).changes) > 0;
