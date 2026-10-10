// تأثيرات صوتية وبصرية لشاشة الحكم (بدون ملفات صوت: الأصوات بتتولّد بالكود)
let ctx = null, noiseBuf = null;
export const soundOn = () => { try { return localStorage.getItem('snd') !== '0'; } catch (e) { return true; } };
export const setSound = v => { try { localStorage.setItem('snd', v ? '1' : '0'); } catch (e) {} };
export function ensureAudio() {
  try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch (e) {}
  return ctx;
}
const noise = () => {
  if (noiseBuf || !ctx) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
};
const env = (g, at, peak, a, hold, rel) => {
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + a);
  g.gain.setValueAtTime(peak, at + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, at + a + hold + rel);
};
// صفارة حكم: نغمتين قريبتين مع اهتزاز سريع
function whistleAt(at, dur) {
  const g = ctx.createGain(); g.connect(ctx.destination); env(g, at, 0.35, 0.02, Math.max(0.01, dur - 0.1), 0.08);
  const trem = ctx.createGain(); trem.gain.value = 0.7; trem.connect(g);
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 38; lg.gain.value = 0.3; lfo.connect(lg); lg.connect(trem.gain);
  [2850, 3150].forEach(f => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(trem); o.start(at); o.stop(at + dur + 0.1); });
  lfo.start(at); lfo.stop(at + dur + 0.1);
}
function tone(at, f0, f1, dur, type = 'sine', peak = 0.3) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  o.connect(g); g.connect(ctx.destination); env(g, at, peak, 0.02, dur * 0.4, dur * 0.6); o.start(at); o.stop(at + dur + 0.05);
}
function burst(at, dur, f, q, peak, swell = 0.05) {
  const s = ctx.createBufferSource(); s.buffer = noise(); s.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
  const g = ctx.createGain(); s.connect(bp); bp.connect(g); g.connect(ctx.destination); env(g, at, peak, swell, dur * 0.4, dur * 0.6); s.start(at); s.stop(at + dur + 0.1);
}
const SOUNDS = {
  kickoff: n => whistleAt(n, 0.9),
  resume: n => whistleAt(n, 0.4),
  short: n => whistleAt(n, 0.35),
  end: n => { whistleAt(n, 0.35); whistleAt(n + 0.5, 0.35); whistleAt(n + 1.0, 1.1); },
  yellow: n => whistleAt(n, 0.5),
  red: n => { whistleAt(n, 0.35); whistleAt(n + 0.5, 0.9); },
  goal: n => { burst(n, 2.6, 1400, 0.6, 0.55, 0.25); burst(n, 2.6, 700, 0.5, 0.35, 0.35); tone(n, 392, 392, 0.25, 'square', 0.12); tone(n + 0.25, 523, 523, 0.25, 'square', 0.12); tone(n + 0.5, 659, 659, 0.6, 'square', 0.12); },
  save: n => { tone(n, 260, 90, 0.25, 'sine', 0.5); burst(n, 0.18, 2500, 1.2, 0.5, 0.005); burst(n + 0.15, 0.9, 900, 0.5, 0.18, 0.1); },
  miss: n => { tone(n, 420, 190, 0.7, 'sawtooth', 0.12); tone(n + 0.15, 330, 150, 0.7, 'sawtooth', 0.1); burst(n, 0.8, 600, 0.5, 0.12, 0.15); }
};
export function sound(name) {
  try { navigator.vibrate && navigator.vibrate(name === 'goal' ? [200, 100, 200] : [80]); } catch (e) {}
  if (!soundOn() || !ensureAudio() || !SOUNDS[name]) return;
  try { SOUNDS[name](ctx.currentTime + 0.02); } catch (e) {}
}

// تأثير بصري: لافتة كبيرة + توهج + قصاصات للأهداف
export function banner({ kind, title, sub = '', team = '' }) {
  let host = document.getElementById('fx');
  if (!host) { host = document.createElement('div'); host.id = 'fx'; document.body.appendChild(host); }
  const el = document.createElement('div'); el.className = 'fxb fx-' + kind;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  el.innerHTML = `<div class="fxglow"></div>${kind === 'goal' || kind === 'pgoal' ? Array.from({ length: 28 }, (_, i) => `<i class="fxc" style="left:${(i * 37) % 100}%;animation-delay:${(i % 7) * 0.08}s;background:${['#4caf50', '#e0a82e', '#ffffff', '#2e7d32'][i % 4]}"></i>`).join('') : ''}
    <div class="fxcard"><div class="fxt">${esc(title)}</div>${sub ? `<div class="fxs">${esc(sub)}</div>` : ''}${team ? `<div class="fxm">${esc(team)}</div>` : ''}</div>`;
  host.appendChild(el);
  setTimeout(() => el.remove(), kind === 'goal' || kind === 'pgoal' ? 3200 : 2200);
}
