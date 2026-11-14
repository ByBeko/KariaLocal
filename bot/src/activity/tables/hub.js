// Çok oyunculu masalar: oda kaydı, canlı güncelleme (uzun bekleyen istek) ve masadaki paranın güvencesi.
// Masadaki para cüzdandan düşülür ve "emanet" olarak veritabanına yazılır; bot kapanırsa açılışta sahibine geri verilir.
import { db } from '../../core/database.js';
import { takeMoney, addMoney } from '../../systems/economy.js';
import { UserError } from '../../utils/errors.js';

db.exec(`CREATE TABLE IF NOT EXISTS table_escrow (
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  amount   INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
)`);

const q = {
  add: db.prepare('INSERT INTO table_escrow (guild_id, user_id, amount) VALUES (?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET amount = amount + excluded.amount'),
  prune: db.prepare('DELETE FROM table_escrow WHERE guild_id=? AND user_id=? AND amount<=0'),
  all: db.prepare('SELECT guild_id, user_id, amount FROM table_escrow'),
  clear: db.prepare('DELETE FROM table_escrow'),
};

// Önceki çalışmada masada kalan para (yarım kalan el dahil) sahibine döner
for (const row of q.all.all()) {
  const amount = Number(row.amount);
  if (amount > 0) addMoney(row.guild_id, row.user_id, amount);
}
q.clear.run();

/** Masadaki bot oyuncular: parası cüzdandan gelmez, emanete yazılmaz */
export const isBot = (id) => String(id).startsWith('bot-');
const BOT_NAMES = ['Poyraz', 'Lodos', 'Kaptan', 'Martı', 'Fırtına', 'Yıldız', 'Kartal', 'Rüzgar'];
let botCounter = 0;
export function makeBot(taken = []) {
  const name = BOT_NAMES.find((n) => !taken.includes(`${n} (Bot)`)) ?? `Bot ${botCounter + 1}`;
  return { id: `bot-${++botCounter}`, name: `${name} (Bot)` };
}

/** Emanetteki miktarı değiştirir (masaya giren para +, masadan çıkan -) */
export function escrow(guildId, userId, delta) {
  if (!delta || isBot(userId)) return;
  q.add.run(guildId, userId, Math.trunc(delta));
  q.prune.run(guildId, userId);
}

/** Bahsi cüzdandan alıp emanete koyar; bakiye yetmezse UserError */
export function hold(guildId, userId, amount) {
  if (isBot(userId)) return;
  takeMoney(guildId, userId, amount);
  escrow(guildId, userId, amount);
}

/** Emanetteki bahis kapanır, kazanç cüzdana geçer */
export function release(guildId, userId, staked, payout) {
  if (isBot(userId)) return;
  if (payout > 0) addMoney(guildId, userId, payout);
  escrow(guildId, userId, -staked);
}

export const cardJson = (c) => ({ r: c.r, s: c.s[0] });

/** Tam sayı bahis ve sınır kontrolü */
export function amountOf(raw, min, max) {
  const amount = Number(String(raw ?? '').replace(/[.\s]/g, ''));
  if (!Number.isInteger(amount) || amount < min) throw new UserError(`En az ${min.toLocaleString('tr-TR')} coin olmalı.`);
  if (amount > max) throw new UserError(`En fazla ${max.toLocaleString('tr-TR')} coin olabilir.`);
  return amount;
}

const LONG_POLL = 20_000;

/** Bütün masaların ortak yanı: sürüm numarası, bekleyen istekler, izleyenler, son olaylar ve zamanlayıcı */
export class Room {
  constructor(id, game, guildId) {
    this.id = id;
    this.game = game;
    this.guildId = guildId;
    this.v = 0;
    this.waiters = new Set();
    this.viewers = new Map(); // kullanıcı -> son görülme
    this.log = [];
    this.timer = null;
  }

  /** Durum değişti: bekleyen herkes yeni görünümü alır */
  bump() {
    this.v++;
    const list = [...this.waiters];
    this.waiters.clear();
    for (const done of list) done();
  }

  wait(since) {
    if (since !== this.v) return null;
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.waiters.delete(done);
        resolve();
      };
      const t = setTimeout(done, LONG_POLL);
      this.waiters.add(done);
    });
  }

  seen(userId) {
    this.viewers.set(userId, Date.now());
  }

  away(userId) {
    this.viewers.delete(userId);
  }

  /** Son birkaç saniyede masaya bakanlar */
  present(ms = LONG_POLL + 8_000) {
    const now = Date.now();
    return [...this.viewers].filter(([, at]) => now - at < ms).map(([id]) => id);
  }

  note(text) {
    this.log.push(text);
    if (this.log.length > 6) this.log.shift();
  }

  /** Tek zamanlayıcı: yenisi eskisini iptal eder. Hata masayı kilitlemesin diye yakalanır. */
  schedule(fn, ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        fn();
      } catch (error) {
        console.error(`[Masa ${this.id}]`, error);
      }
      this.bump();
    }, Math.max(0, ms));
    this.timer.unref?.();
  }

  /** Botun hamlesi için ayrı zamanlayıcı (masanın sıra süresini bozmaz) */
  botLater(fn, ms) {
    clearTimeout(this.botTimer);
    this.botTimer = setTimeout(() => {
      try {
        fn();
      } catch (error) {
        console.error(`[Masa ${this.id} bot]`, error);
      }
      this.bump();
    }, ms);
    this.botTimer.unref?.();
  }

  botIds() {
    return this.seatedIds().filter(isBot);
  }

  /** Boş koltuğa bot oturtur */
  addBot() {
    if (!this.join) throw new UserError('Bu odaya bot eklenmez.');
    const taken = this.seats.filter(Boolean).map((s) => s.name);
    if (!this.seats.some((s) => !s)) throw new UserError('Masada boş koltuk yok.');
    const bot = makeBot(taken);
    this.join(bot, { buyIn: this.maxBuy });
    this.afterBotJoin?.();
  }

  // Alt sınıflar: summary(), view(userId), act(user, action, body), join(user, body), leave(userId), seatedIds()
  seatedIds() {
    return [];
  }
}
