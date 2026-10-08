import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import * as A from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import * as F from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { DICT } from './i18n.js';

export { A, F };
export const app = initializeApp(firebaseConfig);
export const auth = A.getAuth(app);
export const db = F.getFirestore(app);

// ---------- shared state ----------
export const S = {
  user: undefined, profile: {}, lang: 'ar', nav: { view: 'groups' }, pushed: 0,
  myGroups: [], gid: null, g: null, me: undefined, members: {}, balances: {}, sessions: [], ledger: [],
  tab: 'matches', gtab: 'members', rtab: 'goals', subs: [], rsubs: [], osubs: {}, oatt: {},
  sid: null, ssubs: [], att: {}, smatches: [], stats: null, statsLoading: false,
  audit: null, report: null, modalFn: null, tmpPhoto: undefined,
  render() {}, go() {}
};
export const ACTIONS = {};
export const CHANGES = {};
export const INPUTS = {};

// ---------- i18n ----------
export function t(k, v) {
  let s = (DICT[S.lang] && DICT[S.lang][k]) ?? DICT.en[k] ?? k;
  if (v) for (const x in v) s = s.split('{' + x + '}').join(v[x]);
  return s;
}
export function setLang(l) {
  S.lang = l === 'en' ? 'en' : 'ar';
  try { localStorage.setItem('lang', S.lang); } catch (e) {}
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
}

// ---------- helpers ----------
export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const val = id => { const e = document.getElementById(id); return e ? e.value : ''; };
export const checked = id => { const e = document.getElementById(id); return !!(e && e.checked); };
export function num(v, d = 0) {
  const s = String(v ?? '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace('٫', '.').replace('،', '.').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : d;
}
export const fmtNum = n => Number(n || 0).toLocaleString('en', { maximumFractionDigits: 2 });
export const money = n => `${fmtNum(n)} ${esc(S.g?.currency || '')}`.trim();
export const sgn = n => (n > 0 ? '+' : '') + fmtNum(n);
export function dt(ms, o) {
  if (!ms) return '';
  const loc = S.lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
  return new Date(ms).toLocaleString(loc, o || { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export const dShort = ms => dt(ms, { day: 'numeric', month: 'short', year: 'numeric' });
export const tsMs = x => (x && x.toMillis ? x.toMillis() : (typeof x === 'number' ? x : 0));
export function toLocalInput(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function initial(n) { return (String(n || '?').trim()[0] || '?').toUpperCase(); }
export function av(name, photo, cls = '') {
  const inner = photo ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">` : esc(initial(name));
  return `<span class="av ${cls}">${inner}</span>`;
}
let toastTimer;
export function toast(m) {
  const e = $('#toast'); if (!e) return;
  e.textContent = m; e.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.remove('on'), 2600);
}
export function errMsg(e) {
  const c = e && (e.code || e.message || String(e));
  if (String(c).includes('permission-denied')) return t('err_perm');
  if (String(c).includes('unavailable') || String(c).includes('network')) return t('err_net');
  if (e && e.message === 'already_done') return t('err_done');
  return t('err_generic');
}
export function download(name, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
export const csvRow = r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',');

// ---------- modal ----------
export function drawModal() {
  const m = $('#modal');
  m.innerHTML = S.modalFn ? `<div class="sheet">${S.modalFn()}</div>` : '';
}
export function openModal(fn) { S.modalFn = fn; drawModal(); }
export function closeModal() { S.modalFn = null; $('#modal').innerHTML = ''; }
export function confirmBox(msg, onYes, danger = false) {
  ACTIONS._confirmYes = async () => { closeModal(); await onYes(); };
  openModal(() => `<h2>${esc(msg)}</h2>
    <div class="row"><button class="btn ${danger ? 'danger' : 'primary'}" data-act="_confirmYes">${t('yes_sure')}</button>
    <button class="btn" data-act="closeModal">${t('cancel')}</button></div>`);
}
ACTIONS.closeModal = () => closeModal();

// ---------- group helpers ----------
export const gref = (...p) => F.doc(db, 'groups', S.gid, ...p);
export const gcol = (...p) => F.collection(db, 'groups', S.gid, ...p);
export const myName = () => S.me?.name || S.profile?.name || S.user?.displayName || '';
export const isAdmin = () => !!(S.me && S.me.status === 'active' && ['owner', 'admin'].includes(S.me.role));
export const isOwner = () => !!(S.me && S.me.status === 'active' && S.me.role === 'owner');
export const canGrant = () => isAdmin() && (S.me.role === 'owner' || S.me.canAddAdmins === true);
export const feat = k => (S.g?.features?.[k] ?? true);

export function nameOf(id, extra) {
  return S.members[id]?.name || extra?.[id] || S.att[id]?.name || '—';
}
export function photoOf(id) { return S.members[id]?.photo || ''; }

// writer = batch or transaction
export function addAudit(w, action, details = '') {
  w.set(F.doc(gcol('audit')), { at: F.serverTimestamp(), by: S.user.uid, byName: myName(), action, details });
}
// returns fund delta; caller applies once via bumpFund
export function addLedger(w, e) {
  const ref = F.doc(gcol('ledger'));
  w.set(ref, {
    type: e.type, uid: e.uid || null, name: e.name || '', amount: e.amount || 0, fund: e.fund || 0,
    note: e.note || '', sid: e.sid || null, ref: e.ref || null, by: S.user.uid, byName: myName(), at: F.serverTimestamp()
  });
  if (e.uid && e.amount) w.set(gref('balances', e.uid), { uid: e.uid, balance: F.increment(e.amount) }, { merge: true });
  return e.fund || 0;
}
export function bumpFund(w, delta) {
  if (delta) w.update(gref(), { fund: F.increment(delta) });
}
export const balanceOf = uid => S.balances[uid]?.balance || 0;

// ---------- attendance helpers ----------
export function slotCount(att) {
  return Object.values(att).filter(a => a.rsvp === 'yes' && !a.subFor).length;
}
export function playersOf(att) {
  return Object.values(att).filter(a => a.rsvp === 'yes').filter(a =>
    a.subFor ? (att[a.subFor]?.rsvp === 'yes' && att[a.subFor]?.sub?.status === 'approved')
             : !(a.sub && a.sub.status === 'approved'));
}
export function attMapFor(sid) { return S.sid === sid ? S.att : (S.oatt[sid] || {}); }

export function genCode() {
  const cs = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(6); crypto.getRandomValues(a);
  return Array.from(a, x => cs[x % cs.length]).join('');
}
export function resizeImage(file, max = 256) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = rej; img.src = url;
  });
}
export function bar(title, back = false, extra = '') {
  return `<div class="bar">${back ? `<button data-act="back" aria-label="back">${S.lang === 'ar' ? '→' : '←'}</button>` : ''}<h1>${esc(title)}</h1>${extra}</div>`;
}
export const spinner = () => '<div class="empty">⚽</div>';
// أرقام لاتينية (123) دائماً — حتى في الإدخال
export const numIn = (id, v = '', extra = '') =>
  `<input id="${id}" type="text" inputmode="decimal" dir="ltr" lang="en" autocomplete="off" value="${esc(v)}" ${extra}>`;
export const dtIn = (id, v = '') => `<input id="${id}" type="datetime-local" dir="ltr" lang="en-GB" value="${esc(v)}">`;
