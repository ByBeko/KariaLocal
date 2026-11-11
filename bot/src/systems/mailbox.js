// Genel mail kutusu: @karia.live adreslerine gelen mailler Worker'dan buraya düşer, Yönetim > Mailler ekranında okunur.
import { randomBytes } from 'node:crypto';
import { db } from '../core/database.js';
import { UserError } from '../utils/errors.js';

const KEEP_COUNT = 500;
const KEEP_FOR = 90 * 24 * 3600_000;
const PER_HOUR = 120;
const LIST_SIZE = 100;
const MAX_BODY = 12_000;
const MAX_HTML = 700_000;
const VIEW_TTL = 30 * 60_000;
const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

db.exec(`
  CREATE TABLE IF NOT EXISTS mailbox (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    to_addr     TEXT NOT NULL,
    from_addr   TEXT NOT NULL,
    from_name   TEXT NOT NULL,
    subject     TEXT NOT NULL,
    body        TEXT NOT NULL,
    attachments INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    read_at     INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_mailbox_created ON mailbox (created_at);
`);

if (!db.prepare('PRAGMA table_info(mailbox)').all().some((column) => column.name === 'html')) {
  db.exec("ALTER TABLE mailbox ADD COLUMN html TEXT NOT NULL DEFAULT ''");
}

const insertStmt = db.prepare('INSERT INTO mailbox (to_addr, from_addr, from_name, subject, body, html, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const pruneStmt = db.prepare('DELETE FROM mailbox WHERE created_at < ? OR id NOT IN (SELECT id FROM mailbox ORDER BY id DESC LIMIT ?)');
const listStmt = db.prepare('SELECT id, to_addr, from_addr, from_name, subject, substr(body, 1, 140) AS preview, attachments, created_at, read_at FROM mailbox ORDER BY id DESC LIMIT ?');
const unreadStmt = db.prepare('SELECT COUNT(*) AS total FROM mailbox WHERE read_at IS NULL');
const getStmt = db.prepare('SELECT * FROM mailbox WHERE id = ?');
const readStmt = db.prepare('UPDATE mailbox SET read_at = ? WHERE id = ? AND read_at IS NULL');
const deleteStmt = db.prepare('DELETE FROM mailbox WHERE id = ?');

let hits = [];

/** Worker'dan gelen maili saklar. Doğrulama kodları otomatik gönderildiği için burada ayıklanmaz. */
export function storeMail(raw) {
  const to = String(raw.to ?? '').trim().toLowerCase().slice(0, 200);
  const from = String(raw.from ?? '').trim().toLowerCase().slice(0, 200);
  if (!ADDRESS.test(to) || !ADDRESS.test(from)) return { __status: 400, error: 'Geçersiz adres.' };
  const now = Date.now();
  hits = hits.filter((at) => now - at < 3600_000);
  if (hits.length >= PER_HOUR) return { __status: 429, limited: true };
  hits.push(now);
  const html = String(raw.html ?? '');
  insertStmt.run(to, from, String(raw.fromName ?? '').trim().slice(0, 100), String(raw.subject ?? '').trim().slice(0, 200) || 'Konu yok', String(raw.text ?? '').trim().slice(0, MAX_BODY), html.length <= MAX_HTML ? html : '', Math.max(0, Math.floor(Number(raw.attachments) || 0)), now);
  pruneStmt.run(now - KEEP_FOR, KEEP_COUNT);
  return { ok: true };
}

export function mailList() {
  const mails = listStmt.all(LIST_SIZE).map((m) => ({ id: m.id, to: m.to_addr, from: m.from_addr, fromName: m.from_name, subject: m.subject, preview: m.preview, attachments: m.attachments, at: m.created_at, read: Boolean(m.read_at) }));
  return { mails, unread: unreadStmt.get().total, addresses: [...new Set(mails.map((m) => m.to))].sort() };
}

export function openMail(id) {
  const mail = getStmt.get(id);
  if (!mail) throw new UserError('Mail bulunamadı.');
  readStmt.run(Date.now(), id);
  return { id: mail.id, body: mail.body, attachments: mail.attachments, viewToken: mail.html ? createViewToken(mail.id) : null, unread: unreadStmt.get().total };
}

// Mailin özgün görünümü ayrı bir adresten açılır; adres tahmin edilemez ve kısa sürede geçersiz olur
const viewTokens = new Map();

function createViewToken(id) {
  const now = Date.now();
  for (const [token, saved] of viewTokens) if (saved.expires < now) viewTokens.delete(token);
  const token = randomBytes(32).toString('hex');
  viewTokens.set(token, { id, expires: now + VIEW_TTL });
  return token;
}

export function mailViewHtml(token) {
  const saved = viewTokens.get(token);
  if (!saved || saved.expires < Date.now()) return null;
  return getStmt.get(saved.id)?.html || null;
}

export function deleteMail(id) {
  deleteStmt.run(id);
  return mailList();
}
