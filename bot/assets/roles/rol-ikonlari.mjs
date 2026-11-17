// Karia rol ikonları: düz gradyanlı altıgen + ince iç çerçeve + beyaz sembol (Karia Yaratıcı/Oyuncu/Kodcu stili)
// Çalıştır (bot klasöründe): node assets/roles/rol-ikonlari.mjs  → assets/roles/<slug>.png (256x256)
// Yeni rol için ROLES listesine satır ekle; sembol yoksa GLYPHS içine çiz.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas } from '@napi-rs/canvas';

const OUT = process.argv[2] || path.dirname(fileURLToPath(import.meta.url));
const SIZE = 256;
const S = SIZE / 128;
const PI = Math.PI;

// ---------- yardımcılar (128'lik koordinat sistemi) ----------
function rrectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
const rrect = (g, x, y, w, h, r) => { rrectPath(g, x, y, w, h, r); g.fill(); };
const strokeRrect = (g, x, y, w, h, r, lw) => { rrectPath(g, x, y, w, h, r); g.lineWidth = lw; g.stroke(); };
const circle = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, 2 * PI); g.fill(); };
const ring = (g, x, y, r, lw) => { g.beginPath(); g.arc(x, y, r, 0, 2 * PI); g.lineWidth = lw; g.stroke(); };
function line(g, pts, lw) {
  g.beginPath();
  g.moveTo(...pts[0]);
  for (const p of pts.slice(1)) g.lineTo(...p);
  g.lineWidth = lw;
  g.stroke();
}
function poly(g, pts) {
  g.beginPath();
  g.moveTo(...pts[0]);
  for (const p of pts.slice(1)) g.lineTo(...p);
  g.closePath();
  g.fill();
}
function cut(g, fn) {
  g.save();
  g.globalCompositeOperation = 'destination-out';
  fn();
  g.restore();
}
function sparkle(g, cx, cy, r, k = 0.16) {
  const c = r * k;
  g.beginPath();
  g.moveTo(cx, cy - r);
  g.quadraticCurveTo(cx + c, cy - c, cx + r, cy);
  g.quadraticCurveTo(cx + c, cy + c, cx, cy + r);
  g.quadraticCurveTo(cx - c, cy + c, cx - r, cy);
  g.quadraticCurveTo(cx - c, cy - c, cx, cy - r);
  g.closePath();
  g.fill();
}
function hexPath(g, cx, cy, R, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = ((-90 + 60 * i) * PI) / 180;
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  g.beginPath();
  g.moveTo((pts[5][0] + pts[0][0]) / 2, (pts[5][1] + pts[0][1]) / 2);
  for (let i = 0; i < 6; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % 6];
    g.arcTo(p[0], p[1], q[0], q[1], r);
  }
  g.closePath();
}

// ---------- semboller ----------
function gem(g, dy = 0, sc = 1) {
  g.save();
  g.translate(64, 64 + dy);
  g.scale(sc, sc);
  g.translate(-64, -64);
  poly(g, [[44, 42], [84, 42], [97, 57], [64, 94], [31, 57]]);
  cut(g, () => {
    g.lineCap = 'round';
    g.lineJoin = 'round';
    line(g, [[33, 57], [95, 57]], 3.6);
    line(g, [[52, 43], [46, 57], [64, 92], [82, 57], [76, 43]], 3.6);
    line(g, [[46, 57], [64, 43], [82, 57]], 3.6);
  });
  g.restore();
}

const GLYPHS = {
  karia(g) {
    line(g, [[42, 34], [42, 94]], 11);
    line(g, [[76, 36], [49, 64], [76, 92]], 11);
    sparkle(g, 89, 64, 10);
  },
  globe(g) {
    ring(g, 64, 64, 28, 7);
    g.beginPath();
    g.ellipse(64, 64, 12, 28, 0, 0, 2 * PI);
    g.lineWidth = 6;
    g.stroke();
    line(g, [[37, 64], [91, 64]], 6);
  },
  sheriff(g) {
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const a = ((-90 + 30 * i) * PI) / 180;
      const rad = i % 2 ? 16.5 : 33;
      pts.push([64 + rad * Math.cos(a), 65 + rad * Math.sin(a)]);
    }
    poly(g, pts);
    g.lineWidth = 2.5;
    g.stroke();
    for (let i = 0; i < 12; i += 2) circle(g, pts[i][0], pts[i][1], 4);
    cut(g, () => {
      ring(g, 64, 65, 9.5, 3.2);
      sparkle(g, 64, 65, 5.5, 0.3);
    });
  },
  wrench(g) {
    g.save();
    g.translate(64, 64);
    g.rotate(-PI / 4);
    line(g, [[-31, 0], [8, 0]], 14);
    circle(g, 19, 0, 17);
    cut(g, () => {
      g.fillRect(21, -6.5, 20, 13);
      circle(g, 21, 0, 6.5);
      circle(g, -27, 0, 3);
    });
    g.restore();
  },
  terminal(g) {
    rrect(g, 30, 36, 68, 56, 11);
    cut(g, () => {
      line(g, [[44, 54], [55, 64], [44, 74]], 7);
      line(g, [[62, 76], [82, 76]], 7);
    });
  },
  bag(g) {
    g.beginPath();
    g.moveTo(53, 52);
    g.bezierCurveTo(28, 62, 26, 95, 64, 95);
    g.bezierCurveTo(102, 95, 100, 62, 75, 52);
    g.closePath();
    g.fill();
    poly(g, [[55, 44], [45, 31], [64, 37], [83, 31], [73, 44]]);
    rrect(g, 51, 43, 26, 7, 3.5);
    cut(g, () => {
      line(g, [[50, 52.5], [78, 52.5]], 3);
      g.font = 'bold 34px Arial';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('$', 64, 75);
    });
  },
  flag(g) {
    line(g, [[41, 36], [41, 94]], 7);
    circle(g, 41, 33, 5.5);
    poly(g, [[44, 38], [91, 38], [79, 53], [91, 68], [44, 68]]);
    g.lineWidth = 3;
    g.stroke();
  },
  bug(g) {
    g.beginPath();
    g.ellipse(64, 72, 17, 22, 0, 0, 2 * PI);
    g.fill();
    circle(g, 64, 45, 10);
    line(g, [[59, 37], [52, 28]], 4.5);
    line(g, [[69, 37], [76, 28]], 4.5);
    for (const s of [-1, 1]) {
      line(g, [[64 + s * 16, 60], [64 + s * 29, 53]], 5);
      line(g, [[64 + s * 17, 72], [64 + s * 31, 72]], 5);
      line(g, [[64 + s * 15, 84], [64 + s * 28, 92]], 5);
    }
    cut(g, () => {
      line(g, [[64, 53], [64, 93]], 3.2);
      line(g, [[47, 54.5], [81, 54.5]], 3.2);
    });
  },
  vip(g) {
    gem(g);
  },
  vipPlus(g) {
    gem(g, 4, 0.9);
    line(g, [[90, 25], [90, 41]], 5.5);
    line(g, [[82, 33], [98, 33]], 5.5);
  },
  kvip(g) {
    gem(g, 8, 0.86);
    poly(g, [[48, 40], [46, 24], [56, 31], [64, 20], [72, 31], [82, 24], [80, 40]]);
    g.lineWidth = 2.5;
    g.stroke();
  },
  prime(g) {
    gem(g, 4, 0.9);
    sparkle(g, 92, 30, 10);
    sparkle(g, 33, 86, 6);
  },
  rocket(g) {
    g.save();
    g.translate(65, 63);
    g.rotate(PI / 4);
    g.scale(1.12, 1.12);
    g.beginPath();
    g.moveTo(0, -36);
    g.bezierCurveTo(17, -24, 16, 0, 12, 16);
    g.lineTo(-12, 16);
    g.bezierCurveTo(-16, 0, -17, -24, 0, -36);
    g.closePath();
    g.fill();
    poly(g, [[-13, 0], [-25, 14], [-25, 22], [-12, 17]]);
    poly(g, [[13, 0], [25, 14], [25, 22], [12, 17]]);
    g.beginPath();
    g.moveTo(-7, 21);
    g.quadraticCurveTo(0, 40, 7, 21);
    g.closePath();
    g.fill();
    cut(g, () => {
      circle(g, 0, -12, 6.5);
      line(g, [[-14, 18.5], [14, 18.5]], 3);
    });
    g.restore();
  },
  ballot(g) {
    rrect(g, 32, 62, 64, 32, 7);
    cut(g, () => rrect(g, 46, 56, 36, 15, 4));
    rrect(g, 49, 28, 30, 40, 4);
    cut(g, () => line(g, [[56, 46], [62, 52], [72, 40]], 4.5));
  },
  user(g) {
    circle(g, 64, 45, 15);
    g.beginPath();
    g.moveTo(34, 92);
    g.bezierCurveTo(34, 70, 46, 66, 64, 66);
    g.bezierCurveTo(82, 66, 94, 70, 94, 92);
    g.closePath();
    g.fill();
  },
  robot(g) {
    rrect(g, 36, 46, 56, 42, 12);
    rrect(g, 28, 58, 6, 18, 3);
    rrect(g, 94, 58, 6, 18, 3);
    line(g, [[64, 46], [64, 34]], 5);
    circle(g, 64, 31, 6);
    cut(g, () => {
      circle(g, 52, 64, 6.5);
      circle(g, 76, 64, 6.5);
      line(g, [[55, 78], [73, 78]], 4.5);
    });
  },
  happy(g) {
    circle(g, 64, 64, 31);
    cut(g, () => {
      circle(g, 53, 56, 5);
      circle(g, 75, 56, 5);
      g.beginPath();
      g.arc(64, 66, 15, 0.18 * PI, 0.82 * PI);
      g.lineWidth = 5.5;
      g.stroke();
    });
  },
  neutral(g) {
    circle(g, 64, 64, 31);
    cut(g, () => {
      circle(g, 53, 56, 5);
      circle(g, 75, 56, 5);
      line(g, [[52, 77], [76, 77]], 5.5);
    });
  },
  sad(g) {
    circle(g, 64, 64, 31);
    cut(g, () => {
      circle(g, 53, 56, 5);
      circle(g, 75, 56, 5);
      g.beginPath();
      g.arc(64, 92, 15, 1.22 * PI, 1.78 * PI);
      g.lineWidth = 5.5;
      g.stroke();
    });
  },
  chat(g) {
    rrect(g, 28, 32, 48, 36, 12);
    poly(g, [[36, 62], [34, 78], [50, 64]]);
    cut(g, () => {
      rrect(g, 47, 49, 56, 44, 15);
      poly(g, [[86, 85], [96, 100], [74, 88]]);
    });
    rrect(g, 51, 53, 48, 36, 12);
    poly(g, [[86, 83], [94, 96], [76, 86]]);
    cut(g, () => {
      circle(g, 63, 71, 4);
      circle(g, 75, 71, 4);
      circle(g, 87, 71, 4);
    });
  },
  joystick(g) {
    rrect(g, 34, 76, 60, 18, 8);
    line(g, [[64, 78], [64, 50]], 8);
    circle(g, 64, 40, 13);
    cut(g, () => rrect(g, 76, 66, 16, 12, 4));
    circle(g, 84, 72, 5);
  },
  braces(g) {
    const brace = (s) => {
      g.save();
      g.translate(64, 0);
      g.scale(s, 1);
      g.translate(-64, 0);
      g.beginPath();
      g.moveTo(55, 33);
      g.quadraticCurveTo(45, 33, 45, 43);
      g.lineTo(45, 55);
      g.quadraticCurveTo(45, 64, 36, 64);
      g.quadraticCurveTo(45, 64, 45, 73);
      g.lineTo(45, 85);
      g.quadraticCurveTo(45, 95, 55, 95);
      g.lineWidth = 8.5;
      g.stroke();
      g.restore();
    };
    brace(1);
    brace(-1);
    circle(g, 64, 64, 5);
  },
  cube(g) {
    const top = [[64, 30], [93, 46], [64, 62], [35, 46]];
    const left = [[35, 46], [64, 62], [64, 97], [35, 81]];
    const right = [[64, 62], [93, 46], [93, 81], [64, 97]];
    g.globalAlpha = 1;
    poly(g, top);
    g.globalAlpha = 0.86;
    poly(g, left);
    g.globalAlpha = 0.7;
    poly(g, right);
    g.globalAlpha = 1;
    cut(g, () => {
      line(g, [[35, 46], [64, 62], [93, 46]], 3);
      line(g, [[64, 62], [64, 97]], 3);
    });
  },
  music(g) {
    g.save();
    for (const [x, y] of [[47, 84], [83, 76]]) {
      g.beginPath();
      g.ellipse(x, y, 11, 8.5, -0.35, 0, 2 * PI);
      g.fill();
    }
    g.restore();
    line(g, [[56.5, 82], [56.5, 42]], 7);
    line(g, [[92.5, 74], [92.5, 34]], 7);
    poly(g, [[53, 38], [96, 28], [96, 42], [53, 52]]);
  },
  megaphone(g) {
    rrect(g, 26, 54, 13, 22, 3.5);
    poly(g, [[41, 54], [70, 37], [70, 93], [41, 76]]);
    g.lineWidth = 4;
    g.stroke();
    line(g, [[46, 78], [52, 93]], 7.5);
    g.beginPath();
    g.arc(72, 65, 14, -0.27 * PI, 0.27 * PI);
    g.lineWidth = 5.5;
    g.stroke();
    g.beginPath();
    g.arc(72, 65, 24, -0.28 * PI, 0.28 * PI);
    g.stroke();
  },
  refresh(g) {
    const r = 25;
    const arrow = (a0, a1) => {
      g.beginPath();
      g.arc(64, 64, r, a0, a1);
      g.lineWidth = 8;
      g.stroke();
      const x = 64 + r * Math.cos(a1);
      const y = 64 + r * Math.sin(a1);
      const t = a1 + PI / 2; // teğet yönü
      const n = a1; // dışa dönük normal
      const len = 12;
      const w = 11;
      poly(g, [
        [x + Math.cos(t) * len * 0.75, y + Math.sin(t) * len * 0.75],
        [x - Math.cos(t) * len * 0.35 + Math.cos(n) * w, y - Math.sin(t) * len * 0.35 + Math.sin(n) * w],
        [x - Math.cos(t) * len * 0.35 - Math.cos(n) * w, y - Math.sin(t) * len * 0.35 - Math.sin(n) * w],
      ]);
    };
    arrow(PI * 1.08, PI * 1.78);
    arrow(PI * 0.08, PI * 0.78);
  },
  news(g) {
    rrect(g, 32, 34, 64, 60, 9);
    cut(g, () => {
      g.fillRect(41, 44, 22, 18);
      for (const y of [46, 56]) line(g, [[70, y], [87, y]], 4.5);
      for (const y of [72, 83]) line(g, [[42, y], [87, y]], 4.5);
    });
  },
  gift(g) {
    rrect(g, 37, 61, 54, 33, 4);
    rrect(g, 32, 47, 64, 14, 4);
    g.lineWidth = 6;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(64 + s * 10, 38, 10, 7, s * 0.45, 0, 2 * PI);
      g.stroke();
    }
    cut(g, () => {
      g.fillRect(31, 59.5, 66, 3.5);
      g.fillRect(59, 46, 3, 50);
      g.fillRect(66, 46, 3, 50);
    });
  },
  calendar(g) {
    rrect(g, 32, 38, 64, 56, 10);
    cut(g, () => {
      g.fillRect(31, 52, 66, 3.5);
      for (const y of [62, 77]) for (const x of [42, 59, 76]) rrect(g, x, y, 10, 9, 2);
      line(g, [[49, 30], [49, 45]], 13);
      line(g, [[79, 30], [79, 45]], 13);
    });
    line(g, [[49, 30], [49, 45]], 7);
    line(g, [[79, 30], [79, 45]], 7);
  },
  chart(g) {
    rrect(g, 34, 62, 16, 32, 4);
    rrect(g, 56, 36, 16, 58, 4);
    rrect(g, 78, 50, 16, 44, 4);
  },
  pickaxe(g) {
    line(g, [[38, 92], [74, 56]], 9);
    g.beginPath();
    g.moveTo(44, 38);
    g.quadraticCurveTo(84, 26, 92, 86);
    g.quadraticCurveTo(84, 46, 44, 38);
    g.closePath();
    g.lineWidth = 5;
    g.stroke();
    g.fill();
    rrect(g, 64, 46, 20, 20, 4);
  },
  lock(g) {
    g.beginPath();
    g.moveTo(47, 60);
    g.lineTo(47, 50);
    g.arc(64, 50, 17, PI, 2 * PI);
    g.lineTo(81, 60);
    g.lineWidth = 8;
    g.stroke();
    rrect(g, 38, 58, 52, 36, 8);
    cut(g, () => {
      circle(g, 64, 72, 5.5);
      g.fillRect(61.5, 72, 5, 12);
    });
  },
};

// ---------- roller ----------
const ROLES = [
  { id: '1568323512710463508', name: 'Karia', slug: 'karia', glyph: 'karia', c: ['#5fe6ec', '#1494a3'] },
  { id: '1568708741795414167', name: 'Karia Network', slug: 'karia-network', glyph: 'globe', c: ['#6a8ad6', '#22346f'] },
  { id: '1568323512702214305', name: 'Moderatör', slug: 'moderator', glyph: 'sheriff', c: ['#ffb54f', '#ea6a00'] },
  { id: '1568323512702214304', name: 'Personel', slug: 'personel', glyph: 'wrench', c: ['#7590ff', '#2637d6'] },
  { id: '1568323512702214300', name: 'Geliştirici', slug: 'gelistirici', glyph: 'terminal', c: ['#62e39d', '#1c9954'] },
  { id: '1568323512702214299', name: 'Sponsor', slug: 'sponsor', glyph: 'bag', c: ['#ff7070', '#c91f2c'] },
  { id: '1568323512693821649', name: 'Erken Destekçi', slug: 'erken-destekci', glyph: 'flag', c: ['#afb7c3', '#5e6875'] },
  { id: '1568323512693821650', name: 'Hata Avcısı', slug: 'hata-avcisi', glyph: 'bug', c: ['#93d8aa', '#3a8759'] },
  { id: '1569468546713526443', name: 'Prime', slug: 'prime', glyph: 'prime', c: ['#ffe06a', '#e0a000'] },
  { id: '1571854953419378779', name: 'KVIP', slug: 'kvip', glyph: 'kvip', c: ['#5a5a66', '#141418'] },
  { id: '1571854951267827764', name: 'VIP+', slug: 'vip-plus', glyph: 'vipPlus', c: ['#ff6290', '#c4124a'] },
  { id: '1571854952303951994', name: 'VIP', slug: 'vip', glyph: 'vip', c: ['#6cb8ff', '#1d6ddf'] },
  { id: '1568654095991185488', name: 'Takviye', slug: 'takviye', glyph: 'rocket', c: ['#ff9df5', '#a444f0'] },
  { id: '1570211860911751251', name: 'Oy Destekçisi', slug: 'oy-destekcisi', glyph: 'ballot', c: ['#c48cff', '#7a2ee0'] },
  { id: '1568323512693821642', name: 'Sunucu Üyesi', slug: 'sunucu-uyesi', glyph: 'user', c: ['#cfccc8', '#8a8783'] },
  { id: '1568323512693821641', name: 'Botlar', slug: 'botlar', glyph: 'robot', c: ['#a9b8cb', '#55667c'] },
  { id: '1569026683485425754', name: 'Güzel', slug: 'ruh-guzel', glyph: 'happy', c: ['#80e08c', '#2ca64c'] },
  { id: '1569026687851700324', name: 'Orta', slug: 'ruh-orta', glyph: 'neutral', c: ['#ffd46c', '#e19810'] },
  { id: '1569026691429433464', name: 'Kötü', slug: 'ruh-kotu', glyph: 'sad', c: ['#ff9087', '#d6433b'] },
  { id: '1569026655878385724', name: 'Sohbet Sever', slug: 'sohbet-sever', glyph: 'chat', c: ['#74d4ff', '#1c8ed7'] },
  { id: '1569026659582087399', name: 'Oyun Sever', slug: 'oyun-sever', glyph: 'joystick', c: ['#ffa46c', '#e9592b'] },
  { id: '1569026663205834824', name: 'Yazılım Sever', slug: 'yazilim-sever', glyph: 'braces', c: ['#9290ff', '#4a3fd5'] },
  { id: '1569026671263228105', name: 'Blok Ustası', slug: 'blok-ustasi', glyph: 'cube', c: ['#d6a064', '#8a582a'] },
  { id: '1569026679744241835', name: 'Müzik Sever', slug: 'muzik-sever', glyph: 'music', c: ['#ff7cc8', '#cf277f'] },
  { id: '1568323512689623050', name: 'Duyuru Bildirimi', slug: 'bildirim-duyuru', glyph: 'megaphone', c: ['#ff8c5e', '#df4a1e'] },
  { id: '1568323512689623049', name: 'Güncelleme Bildirimi', slug: 'bildirim-guncelleme', glyph: 'refresh', c: ['#62e0f0', '#1494b2'] },
  { id: '1568323512689623048', name: 'Haber Bildirimi', slug: 'bildirim-haber', glyph: 'news', c: ['#82a9ff', '#3456c8'] },
  { id: '1569026695045054684', name: 'Çekiliş Bildirimi', slug: 'bildirim-cekilis', glyph: 'gift', c: ['#ff80b0', '#d42e6a'] },
  { id: '1569026698442317876', name: 'Etkinlik Bildirimi', slug: 'bildirim-etkinlik', glyph: 'calendar', c: ['#b68dff', '#6b3edf'] },
  { id: '1569026702523367524', name: 'Anket Bildirimi', slug: 'bildirim-anket', glyph: 'chart', c: ['#70e0b2', '#1e9d73'] },
  { id: '1569026706528936050', name: 'Minecraft Bildirimi', slug: 'bildirim-minecraft', glyph: 'pickaxe', c: ['#93dc5e', '#3e8e1e'] },
  { id: '1568709837477511320', name: 'Jail', slug: 'jail', glyph: 'lock', c: ['#7d828a', '#33373d'] },
];

function render(role) {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);
  const grad = ctx.createLinearGradient(0, 2, 0, 126);
  grad.addColorStop(0, role.c[0]);
  grad.addColorStop(1, role.c[1]);
  hexPath(ctx, 64, 64, 63, 7);
  ctx.fillStyle = grad;
  ctx.fill();
  hexPath(ctx, 64, 64, 47, 5);
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 2.6;
  ctx.stroke();

  const glyph = createCanvas(SIZE, SIZE);
  const g = glyph.getContext('2d');
  g.scale(S, S);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  GLYPHS[role.glyph](g);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(glyph, 0, 0);
  return canvas.toBuffer('image/png');
}

{
  fs.mkdirSync(OUT, { recursive: true });
  for (const role of ROLES) fs.writeFileSync(path.join(OUT, role.slug + '.png'), render(role));
  fs.writeFileSync(path.join(OUT, 'roles.json'), JSON.stringify(ROLES.map(({ id, name, slug }) => ({ id, name, slug })), null, 2));
  console.log('yazıldı:', ROLES.length);
}
