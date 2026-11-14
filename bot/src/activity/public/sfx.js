// Oyun ses efektleri. Hepsi tarayıcıda üretilir, dosya indirilmez (Discord CSP'sine takılmaz).
const STORE_KEY = 'karia-sfx-off';
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem(STORE_KEY) === '1'; } catch { /* depolama kapalı olabilir */ }

// Tarayıcı sesi ancak bir tıklamadan sonra açar
function unlock() {
  if (!ctx) {
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}
document.addEventListener('pointerdown', unlock, { capture: true });

const ready = () => !muted && ctx && ctx.state === 'running';

function tone(freq, duration, { type = 'sine', gain = 0.3, at = 0, to = null } = {}) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + duration);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

let noiseBuffer = null;
function noise(duration, { freq = 2000, q = 1, gain = 0.3, at = 0 } = {}) {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const start = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gain, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(amp).connect(master);
  source.start(start, Math.random() * 0.8, duration + 0.02);
}

const arpeggio = (notes, step, options) => notes.forEach((freq, i) => tone(freq, step * 2.4, { ...options, at: i * step }));
const play = (draw) => (...args) => { if (ready()) draw(...args); };

export const sfx = {
  chip: play(() => { tone(1900, 0.05, { type: 'triangle', gain: 0.16 }); tone(2600, 0.04, { type: 'triangle', gain: 0.1, at: 0.03 }); }),
  card: play((count = 1) => { for (let i = 0; i < Math.min(count, 5); i++) noise(0.075, { freq: 3200, q: 0.8, gain: 0.5, at: i * 0.13 }); }),
  reelStop: play(() => { tone(150, 0.1, { type: 'square', gain: 0.18, to: 70 }); noise(0.05, { freq: 900, gain: 0.3 }); }),
  coinFlip: play(() => { for (let i = 0; i < 9; i++) tone(2200 + i * 130, 0.05, { type: 'triangle', gain: 0.1, at: i * 0.085 }); }),
  coinLand: play(() => { tone(3100, 0.22, { type: 'triangle', gain: 0.2 }); tone(4200, 0.16, { type: 'sine', gain: 0.1, at: 0.02 }); }),
  // Top, çark yavaşladıkça seyrekleşen tıkırtılarla döner
  wheel: play((seconds = 4) => {
    let at = 0;
    let gap = 0.05;
    while (at < seconds) {
      noise(0.018, { freq: 3800, q: 3, gain: 0.32, at });
      at += gap;
      gap *= 1.055;
    }
  }),
  win: play(() => arpeggio([523, 659, 784, 1047], 0.09, { type: 'triangle', gain: 0.24 })),
  jackpot: play(() => {
    arpeggio([523, 659, 784, 1047, 1319, 1568, 2093], 0.075, { type: 'triangle', gain: 0.26 });
    for (let i = 0; i < 12; i++) tone(3000 + (i % 4) * 400, 0.09, { type: 'sine', gain: 0.07, at: 0.5 + i * 0.07 });
  }),
  lose: play(() => { tone(311, 0.2, { type: 'sawtooth', gain: 0.1, to: 262 }); tone(233, 0.34, { type: 'sawtooth', gain: 0.11, at: 0.17, to: 175 }); }),
  push: play(() => { tone(440, 0.13, { type: 'triangle', gain: 0.16 }); tone(440, 0.13, { type: 'triangle', gain: 0.13, at: 0.17 }); }),
  coins: play(() => { for (let i = 0; i < 7; i++) tone(2400 + (i % 3) * 520, 0.12, { type: 'triangle', gain: 0.15, at: i * 0.07 }); }),
  /** Makaralar dönerken süren tıkırtı; dönen işlev sesi durdurur */
  spinLoop() {
    if (!ready()) return () => {};
    const timer = setInterval(() => { if (ready()) noise(0.03, { freq: 1500, q: 2, gain: 0.2 }); }, 75);
    return () => clearInterval(timer);
  },
  /** Oyun sonucuna göre ses: büyük kazanç (bahsin 5 katı ve üstü) ayrı çalar */
  result(net, bet = 0) {
    if (net > 0) (bet && net >= bet * 5 ? sfx.jackpot : sfx.win)();
    else if (net < 0) sfx.lose();
    else sfx.push();
  },
  isMuted: () => muted,
  setMuted(value) {
    muted = value;
    try { localStorage.setItem(STORE_KEY, value ? '1' : '0'); } catch { /* depolama kapalı olabilir */ }
  },
};
