// Resimli kartlar (seviye kartı). @napi-rs/canvas ile PNG çizilir.
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import path from 'node:path';
import config from '../config.js';

// Yazı tipi: proje içinde assets/fonts varsa o, yoksa Windows'un Segoe UI'ı (Türkçe karakterli)
const FONT_DIRS = [path.join(import.meta.dirname, '..', '..', 'assets', 'fonts'), 'C:\\Windows\\Fonts'];
const FONTS = [
  ['segoeui.ttf', 'Karia'],
  ['segoeuib.ttf', 'Karia Bold'],
  ['seguiemj.ttf', 'Karia Emoji'],
];
for (const [file, family] of FONTS) {
  const found = FONT_DIRS.map((d) => path.join(d, file)).find((p) => existsSync(p));
  if (found) GlobalFonts.registerFromPath(found, family);
}
const font = (size, bold = false) => `${size}px "${bold ? 'Karia Bold' : 'Karia'}", "Karia Emoji", sans-serif`;

const BRAND = `#${config.brand.color.toString(16).padStart(6, '0')}`;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Metni genişliğe sığacak kadar kısaltır */
function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

const short = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString('tr-TR'));

/**
 * Seviye kartı
 * data: { name, tag, avatarURL, level, rank, xp, current, needed, color?, nextReward? }
 */
export async function rankCard(data) {
  const W = 934;
  const H = 282;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const accent = data.color && data.color !== '#000000' ? data.color : BRAND;

  // Arka plan: koyu degrade + vurgu rengi parıltısı
  roundRect(ctx, 0, 0, W, H, 28);
  ctx.save();
  ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#16181d');
  bg.addColorStop(1, '#0d0e12');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 120, -40, 10, W - 120, -40, 520);
  glow.addColorStop(0, `${accent}55`);
  glow.addColorStop(1, `${accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // ince desen
  ctx.strokeStyle = '#ffffff08';
  ctx.lineWidth = 2;
  for (let x = -H; x < W; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + H, 0);
    ctx.stroke();
  }
  ctx.restore();

  // İç kart
  ctx.fillStyle = '#ffffff0d';
  roundRect(ctx, 20, 20, W - 40, H - 40, 22);
  ctx.fill();

  // Avatar + halka
  const AX = 130;
  const AY = H / 2;
  const AR = 88;
  ctx.beginPath();
  ctx.arc(AX, AY, AR + 8, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  try {
    const avatar = await loadImage(data.avatarURL);
    ctx.save();
    ctx.beginPath();
    ctx.arc(AX, AY, AR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, AX - AR, AY - AR, AR * 2, AR * 2);
    ctx.restore();
  } catch {
    ctx.beginPath();
    ctx.arc(AX, AY, AR, 0, Math.PI * 2);
    ctx.fillStyle = '#2b2d31';
    ctx.fill();
  }

  const LX = 260;
  const RX = W - 50;

  // Sağ üst: sıra ve seviye
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  let x = RX;
  const stat = (label, value, color) => {
    ctx.font = font(56, true);
    ctx.fillStyle = color;
    ctx.fillText(value, x, 92);
    x -= ctx.measureText(value).width + 10;
    ctx.font = font(24);
    ctx.fillStyle = '#b5bac1';
    ctx.fillText(label, x, 92);
    x -= ctx.measureText(label).width + 34;
  };
  stat('SEVİYE', String(data.level), accent);
  stat('SIRA', data.rank ? `#${data.rank}` : '—', '#ffffff');

  // İsim
  ctx.textAlign = 'left';
  ctx.font = font(40, true);
  ctx.fillStyle = '#ffffff';
  const name = fit(ctx, data.name, x - LX - 10);
  ctx.fillText(name, LX, 92);
  ctx.font = font(22);
  ctx.fillStyle = '#949ba4';
  ctx.fillText(fit(ctx, `@${data.tag}`, 360), LX, 126);

  // XP yazısı
  ctx.textAlign = 'right';
  ctx.font = font(24, true);
  ctx.fillStyle = '#ffffff';
  const need = `/ ${short(data.needed)} XP`;
  ctx.fillText(need, RX, 168);
  const needW = ctx.measureText(need).width;
  ctx.fillStyle = accent;
  ctx.fillText(`${short(data.current)} `, RX - needW, 168);

  // İlerleme çubuğu
  const BX = LX;
  const BY = 184;
  const BW = RX - LX;
  const BH = 34;
  ctx.fillStyle = '#2b2d31';
  roundRect(ctx, BX, BY, BW, BH, BH / 2);
  ctx.fill();
  const ratio = Math.max(0, Math.min(1, data.current / data.needed));
  if (ratio > 0) {
    const fillW = Math.max(BH, BW * ratio);
    const grad = ctx.createLinearGradient(BX, 0, BX + fillW, 0);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, '#ffffff');
    ctx.fillStyle = grad;
    roundRect(ctx, BX, BY, fillW, BH, BH / 2);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.font = font(18, true);
  ctx.fillStyle = ratio > 0.55 ? '#16181d' : '#ffffff';
  ctx.fillText(`%${Math.floor(ratio * 100)}`, BX + BW / 2, BY + 24);

  // Alt bilgi
  ctx.textAlign = 'left';
  ctx.font = font(19);
  ctx.fillStyle = '#949ba4';
  ctx.fillText(fit(ctx, `Toplam ${data.xp.toLocaleString('tr-TR')} XP${data.nextReward ? `  •  Sıradaki ödül: ${data.nextReward}` : ''}`, BW), LX, 248);

  return canvas.encode('png');
}
