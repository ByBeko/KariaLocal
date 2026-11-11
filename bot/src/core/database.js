import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// KARIA_DATA_DIR: testlerde gerçek veritabanına dokunmamak için
const dataDir = process.env.KARIA_DATA_DIR || path.join(import.meta.dirname, '..', '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'karia.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT NOT NULL,
    key      TEXT NOT NULL,
    value    TEXT NOT NULL,
    PRIMARY KEY (guild_id, key)
  );

  CREATE TABLE IF NOT EXISTS cases (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    mod_id     TEXT NOT NULL,
    type       TEXT NOT NULL,
    reason     TEXT NOT NULL,
    duration   INTEGER,
    created_at INTEGER NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_cases_user ON cases (guild_id, user_id);

  CREATE TABLE IF NOT EXISTS jails (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    roles    TEXT NOT NULL,
    until    INTEGER,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tickets (
    channel_id TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    number     INTEGER NOT NULL,
    category   TEXT NOT NULL,
    claimed_by TEXT,
    created_at INTEGER NOT NULL,
    closed_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS temp_channels (
    channel_id TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    owner_id   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS role_menu (
    guild_id    TEXT NOT NULL,
    role_id     TEXT NOT NULL,
    emoji       TEXT,
    description TEXT,
    PRIMARY KEY (guild_id, role_id)
  );

  -- ── İstatistik ── (gün: Türkiye saatiyle YYYY-MM-DD)
  CREATE TABLE IF NOT EXISTS msg_stats (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    day        TEXT NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, channel_id, day)
  );
  CREATE INDEX IF NOT EXISTS idx_msg_day ON msg_stats (guild_id, day);

  CREATE TABLE IF NOT EXISTS hour_stats (
    guild_id TEXT NOT NULL,
    day      TEXT NOT NULL,
    hour     INTEGER NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, day, hour)
  );

  CREATE TABLE IF NOT EXISTS voice_stats (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    day        TEXT NOT NULL,
    seconds    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, channel_id, day)
  );
  CREATE INDEX IF NOT EXISTS idx_voice_day ON voice_stats (guild_id, day);

  CREATE TABLE IF NOT EXISTS member_events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    type     TEXT NOT NULL, -- join | leave
    at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_member_events ON member_events (guild_id, at);

  -- ── Seviye (rank) ──
  CREATE TABLE IF NOT EXISTS levels (
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    xp          INTEGER NOT NULL DEFAULT 0,
    level       INTEGER NOT NULL DEFAULT 0,
    last_msg_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS level_rewards (
    guild_id TEXT NOT NULL,
    level    INTEGER NOT NULL,
    role_id  TEXT NOT NULL,
    PRIMARY KEY (guild_id, role_id)
  );

  -- ── Süreli roller ──
  CREATE TABLE IF NOT EXISTS temp_roles (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    role_id  TEXT NOT NULL,
    until    INTEGER NOT NULL,
    mod_id   TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id, role_id)
  );

  -- ── Çekiliş ──
  CREATE TABLE IF NOT EXISTS giveaways (
    message_id TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    host_id    TEXT NOT NULL,
    prize      TEXT NOT NULL,
    winners    INTEGER NOT NULL,
    ends_at    INTEGER NOT NULL,
    role_id    TEXT,
    entrants   TEXT NOT NULL DEFAULT '[]',
    ended      INTEGER NOT NULL DEFAULT 0,
    winner_ids TEXT
  );

  -- ── Oto cevap ──
  CREATE TABLE IF NOT EXISTS autoresponses (
    guild_id TEXT NOT NULL,
    trigger  TEXT NOT NULL,
    response TEXT NOT NULL,
    exact    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, trigger)
  );

  -- ── Anket ──
  CREATE TABLE IF NOT EXISTS polls (
    message_id TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    host_id    TEXT NOT NULL,
    question   TEXT NOT NULL,
    options    TEXT NOT NULL,
    votes      TEXT NOT NULL DEFAULT '{}',
    ends_at    INTEGER NOT NULL,
    ended      INTEGER NOT NULL DEFAULT 0
  );

  -- ── Üye raporları ──
  CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    reporter_id TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    reason      TEXT NOT NULL,
    link        TEXT,
    channel_id  TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by TEXT
  );

  -- ── İtibar ──
  CREATE TABLE IF NOT EXISTS rep (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    points     INTEGER NOT NULL DEFAULT 0,
    last_given INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );

  -- ── AFK ──
  CREATE TABLE IF NOT EXISTS afk (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    reason   TEXT NOT NULL,
    since    INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  -- ── Tek seferlik coin ödülleri (seviye ve rol) ──
  CREATE TABLE IF NOT EXISTS coin_rewards (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    reward   TEXT NOT NULL,
    coins    INTEGER NOT NULL,
    at       INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, reward)
  );

  -- ── Top.gg oyları (aylık) ──
  CREATE TABLE IF NOT EXISTS votes (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    month    TEXT NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    last_at  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, month)
  );

  -- ── E-posta ile açılan talepler ──
  CREATE TABLE IF NOT EXISTS mail_tickets (
    channel_id TEXT PRIMARY KEY,
    from_addr  TEXT NOT NULL,
    from_name  TEXT NOT NULL DEFAULT '',
    subject    TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  -- ── Ekonomi ──
  CREATE TABLE IF NOT EXISTS economy (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    wallet     INTEGER NOT NULL DEFAULT 0,
    daily_at   INTEGER NOT NULL DEFAULT 0,
    work_at    INTEGER NOT NULL DEFAULT 0,
    streak     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );

  -- ── Minecraft hesap bağlama ──
  CREATE TABLE IF NOT EXISTS mc_links (
    guild_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    uuid      TEXT NOT NULL,
    name      TEXT NOT NULL,
    linked_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id),
    UNIQUE (guild_id, uuid)
  );
  CREATE TABLE IF NOT EXISTS mc_link_codes (
    code       TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    uuid       TEXT NOT NULL,
    name       TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mc_transactions (
    guild_id TEXT NOT NULL,
    tx_id    TEXT NOT NULL,
    uuid     TEXT NOT NULL,
    amount   INTEGER NOT NULL,
    balance  INTEGER NOT NULL,
    reason   TEXT NOT NULL,
    at       INTEGER NOT NULL,
    PRIMARY KEY (guild_id, tx_id)
  );
`);
