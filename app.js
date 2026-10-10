import { S, A, F, auth, db, ACTIONS, CHANGES, INPUTS, t, setLang, esc, av, val, num, numIn, icon, pubOf, checked, versionLine, toast, errMsg, openModal, closeModal, drawModal, confirmBox, bar, spinner,
  isAdmin, gref, gcol, genCode, resizeImage, $ } from './core.js';
import { groupTab } from './admin.js';
import { matchesTab, sessionView, refereeView, refAfterRender } from './session.js';
import { statsTab, memberBody, memberView, compute } from './stats.js';
import { firebaseConfig } from './firebase-config.js';

// ---------- boot ----------
try { setLang(localStorage.getItem('lang') || 'ar'); } catch (e) { setLang('ar'); }
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; S.render(); });
const joinParam = new URLSearchParams(location.search).get('join');
if (joinParam) history.replaceState(null, '', location.pathname);
let pendingJoin = joinParam ? joinParam.toUpperCase() : '';

S.go = (nav, replace) => {
  S.nav = nav;
  if (replace) history.replaceState(nav, ''); else { history.pushState(nav, ''); S.pushed++; }
  applyNav(true);
};
window.addEventListener('popstate', e => { S.pushed = Math.max(0, S.pushed - 1); S.nav = e.state || { view: 'groups' }; applyNav(true); });
S.render = render;

A.onAuthStateChanged(auth, async u => {
  S.user = u || null;
  if (!u) { leaveGroup(); S.myGroups = []; render(); return; }
  try {
    const ref = F.doc(db, 'users', u.uid), snap = await F.getDoc(ref);
    if (snap.exists()) S.profile = snap.data();
    else { S.profile = { name: u.displayName || '', photo: u.photoURL || '', lang: S.lang, createdAt: F.serverTimestamp() }; await F.setDoc(ref, S.profile); }
    if (S.profile.lang && !localStorage.getItem('lang')) setLang(S.profile.lang);
  } catch (e) { S.profile = { name: u.displayName || '', photo: u.photoURL || '' }; }
  F.onSnapshot(F.collection(db, 'users', u.uid, 'mygroups'), s => { S.myGroups = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); });
  history.replaceState(S.nav, ''); render();
  if (pendingJoin) { const c = pendingJoin; pendingJoin = ''; joinModal(c); }
});

// ---------- event delegation ----------
document.addEventListener('click', ev => {
  if (ev.target.id === 'modal') { closeModal(); return; }
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const fn = ACTIONS[el.dataset.act]; if (!fn) return;
  if (el.dataset.busy) return; el.dataset.busy = '1';
  Promise.resolve().then(() => fn(el, ev)).catch(e => { console.error(e); toast(errMsg(e)); }).finally(() => { delete el.dataset.busy; });
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-chg]'); const fn = el && CHANGES[el.dataset.chg];
  if (fn) Promise.resolve().then(() => fn(el, ev)).catch(e => { console.error(e); toast(errMsg(e)); });
});
document.addEventListener('input', ev => {
  const el = ev.target.closest('[data-inp]'); const fn = el && INPUTS[el.dataset.inp];
  if (fn) fn(el, ev);
});

// ---------- navigation & subscriptions ----------
function applyNav() {
  const n = S.nav;
  if (n.gid && n.gid !== S.gid) enterGroup(n.gid);
  if (!n.gid && S.gid) leaveGroup();
  const sv = n.view === 'session' || n.view === 'referee';
  if (sv && n.sid !== S.sid) enterSession(n.sid);
  if (!sv && S.sid) leaveSession();
  closeModal(); window.scrollTo(0, 0); render();
}
function unsubAll(arr) { arr.forEach(u => { try { u(); } catch (e) {} }); arr.length = 0; }
function leaveGroup() {
  leaveSession(); unsubAll(S.subs); unsubAll(S.rsubs);
  Object.values(S.osubs).forEach(u => u()); S.osubs = {}; S.oatt = {};
  Object.assign(S, { gid: null, g: null, me: undefined, members: {}, guests: {}, pos: {}, tiers: {}, balances: {}, sessions: [], ledger: [], stats: null, audit: null, report: null, admSub: undefined, active: false, pubSynced: false, tab: 'matches', gtab: 'members' });
}
function enterGroup(gid) {
  leaveGroup(); S.gid = gid;
  const uid = S.user.uid;
  S.subs.push(F.onSnapshot(F.doc(db, 'groups', gid, 'members', uid), snap => {
    S.me = snap.exists() ? snap.data() : null;
    if (S.me?.status === 'active') {
      if (!S.active) startActive(); syncRoleSubs();
      if (!S.pubSynced) { S.pubSynced = true; const want = pubOf(S.profile); if (JSON.stringify(want) !== JSON.stringify(S.me.pub || {})) F.updateDoc(F.doc(db, 'groups', gid, 'members', uid), { pub: want }).catch(() => {}); }
    }
    render();
  }, () => { S.me = null; render(); }));
}
function startActive() {
  S.active = true; const gid = S.gid;
  S.subs.push(F.onSnapshot(F.doc(db, 'groups', gid), s => { S.g = s.exists() ? { id: s.id, ...s.data() } : null; render(); }, () => {}));
  S.subs.push(F.onSnapshot(F.collection(db, 'groups', gid, 'members'), s => { S.members = {}; s.docs.forEach(d => { S.members[d.id] = d.data(); }); render(); }, () => {}));
  S.subs.push(F.onSnapshot(F.collection(db, 'groups', gid, 'pos'), s => { S.pos = {}; s.docs.forEach(d => { S.pos[d.id] = d.data().pos; }); if (S.stats) S.stats.per = compute(S.stats.matches); render(); }, () => {}));
  S.subs.push(F.onSnapshot(F.collection(db, 'groups', gid, 'guests'), s => { S.guests = {}; s.docs.forEach(d => { S.guests[d.id] = { id: d.id, ...d.data() }; }); render(); }, () => {}));
  S.subs.push(F.onSnapshot(F.query(F.collection(db, 'groups', gid, 'sessions'), F.orderBy('startsAt', 'desc'), F.limit(40)), s => {
    S.sessions = s.docs.map(d => ({ id: d.id, ...d.data() })); syncOpenAtt(); render();
  }, () => {}));
}
function syncRoleSubs() {
  const adm = isAdmin(); if (adm === S.admSub) return;
  S.admSub = adm; unsubAll(S.rsubs); const gid = S.gid, uid = S.user.uid; S.balances = {}; S.ledger = []; S.tiers = {};
  if (adm) {
    S.rsubs.push(F.onSnapshot(F.collection(db, 'groups', gid, 'tiers'), s => { S.tiers = {}; s.docs.forEach(d => { S.tiers[d.id] = d.data().tier; }); render(); }, () => {}));
    S.rsubs.push(F.onSnapshot(F.collection(db, 'groups', gid, 'balances'), s => { S.balances = {}; s.docs.forEach(d => { S.balances[d.id] = d.data(); }); render(); }, () => {}));
    S.rsubs.push(F.onSnapshot(F.query(F.collection(db, 'groups', gid, 'ledger'), F.orderBy('at', 'desc'), F.limit(150)), s => { S.ledger = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, () => {}));
  } else {
    S.rsubs.push(F.onSnapshot(F.doc(db, 'groups', gid, 'balances', uid), s => { S.balances = s.exists() ? { [uid]: s.data() } : {}; render(); }, () => {}));
    S.rsubs.push(F.onSnapshot(F.query(F.collection(db, 'groups', gid, 'ledger'), F.where('uid', '==', uid)), s => { S.ledger = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, () => {}));
  }
}
function syncOpenAtt() {
  const want = S.sessions.filter(s => s.status === 'open').sort((a, b) => a.startsAt.toMillis() - b.startsAt.toMillis()).slice(0, 4).map(s => s.id);
  Object.keys(S.osubs).forEach(id => { if (!want.includes(id)) { S.osubs[id](); delete S.osubs[id]; delete S.oatt[id]; } });
  want.forEach(id => {
    if (S.osubs[id]) return;
    S.osubs[id] = F.onSnapshot(F.collection(db, 'groups', S.gid, 'sessions', id, 'attendance'), s => {
      S.oatt[id] = {}; s.docs.forEach(d => { S.oatt[id][d.id] = d.data(); }); render();
    }, () => {});
  });
}
function enterSession(sid) {
  leaveSession(); S.sid = sid;
  S.ssubs.push(F.onSnapshot(F.collection(db, 'groups', S.gid, 'sessions', sid, 'attendance'), s => {
    S.att = {}; s.docs.forEach(d => { S.att[d.id] = d.data(); }); render();
  }, () => {}));
  S.ssubs.push(F.onSnapshot(F.query(F.collection(db, 'groups', S.gid, 'matches'), F.where('sid', '==', sid)), s => {
    S.smatches = s.docs.map(d => ({ id: d.id, ...d.data() })); render();
  }, () => {}));
}
function leaveSession() { unsubAll(S.ssubs); S.sid = null; S.att = {}; S.smatches = []; }

ACTIONS.back = () => {
  if (S.pushed > 0) { history.back(); return; }
  const n = S.nav;
  if (n.view === 'referee') S.go({ view: 'session', gid: n.gid, sid: n.sid }, true);
  else if (n.view === 'session' || n.view === 'member') S.go({ view: 'group', gid: n.gid }, true);
  else S.go({ view: 'groups' }, true);
};

// ---------- render ----------
function render() {
  const root = $('#app'); if (!root) return;
  if (String(firebaseConfig.apiKey || '').startsWith('PASTE')) {
    root.innerHTML = '<div class="card" style="margin-top:40px"><h2>ساعة كورة</h2><p>لازم تلصق إعدادات مشروع Firebase في ملف <b dir="ltr">firebase-config.js</b> الأول (الخطوة 2 في SETUP.md).</p></div>'; return;
  }
  if (S.user === undefined) { root.innerHTML = '<div class="center"><div class="spin"></div></div>'; return; }
  if (!S.user) { root.innerHTML = loginView(); return; }
  const n = S.nav;
  if (n.view === 'profile') root.innerHTML = profileView();
  else if (n.gid) root.innerHTML = groupShell();
  else root.innerHTML = groupsHome();
  refAfterRender();
}

function loginView() {
  return `<div class="login"><img class="logo" src="icons/icon-192.png" alt=""><h1>${t('app_name')}</h1><p>${t('tagline')}</p>
    <button class="gbtn" data-act="login"><svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>${t('login_google')}</button>
    <button class="lang" data-act="toggleLang">${S.lang === 'ar' ? 'English' : 'العربية'}</button>${versionLine()}</div>`;
}
ACTIONS.login = async () => {
  const p = new A.GoogleAuthProvider();
  try { await A.signInWithPopup(auth, p); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) await A.signInWithRedirect(auth, p);
    else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') throw e;
  }
};
ACTIONS.toggleLang = async () => {
  setLang(S.lang === 'ar' ? 'en' : 'ar');
  if (S.user) { try { await F.updateDoc(F.doc(db, 'users', S.user.uid), { lang: S.lang }); } catch (e) {} }
  render();
};
ACTIONS.logout = () => confirmBox(t('logout_q'), async () => { await A.signOut(auth); S.nav = { view: 'groups' }; S.pushed = 0; });

// ---------- groups home ----------
function groupsHome() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const meAv = `<button class="avatar" data-act="openProfile">${av(S.profile.name, S.profile.photo)}</button>`;
  let h = bar(t('app_name'), false, `<button data-act="toggleLang">${S.lang === 'ar' ? 'EN' : 'ع'}</button>${meAv}`);
  if (!standalone && deferredInstall) h += `<div class="card"><b>${t('install_title')}</b><div class="mute small">${t('install_hint')}</div><div class="row"><button class="btn primary" data-act="install">${t('install')}</button></div></div>`;
  else if (!standalone && ios) h += `<div class="card"><b>${t('install_title')}</b><div class="mute small">${t('install_ios')}</div></div>`;
  h += `<h3>${t('my_groups')}</h3>`;
  if (!S.myGroups.length) h += `<div class="empty">${t('no_groups')}</div>`;
  h += S.myGroups.map(g => `<div class="card" data-act="openGroup" data-gid="${esc(g.id)}" style="cursor:pointer;display:flex;align-items:center;gap:12px">
    ${av(g.name, '')}<div style="flex:1"><b>${esc(g.name)}</b></div><span class="mute">›</span></div>`).join('');
  h += `<button class="btn primary block" data-act="createModal">${t('create_group')}</button>
        <button class="btn block" data-act="joinModal">${t('join_group')}</button>` + versionLine();
  return h;
}
ACTIONS.install = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); };
ACTIONS.openGroup = el => { S.tab = 'matches'; S.go({ view: 'group', gid: el.dataset.gid }); };
ACTIONS.openProfile = () => { S.tmpPhoto = undefined; S.go({ view: 'profile' }); };

ACTIONS.createModal = () => openModal(() => `<h2>${t('create_group')}</h2>
  <label>${t('group_name')}</label><input id="cg_name" maxlength="60" placeholder="${t('group_name_ph')}">
  <div class="grid2"><div><label>${t('currency')}</label><input id="cg_cur" maxlength="8" value="${t('default_currency')}"></div>
  <div><label>${t('def_fee')}</label>${numIn('cg_fee', 10)}</div></div>
  <div class="grid2"><div><label>${t('hour_cost')}</label>${numIn('cg_cost', 70)}</div><div><label>${t('max_players')}</label>${numIn('cg_max', 18)}</div></div>
  <div class="grid2"><div><label>${t('cancel_hours')}</label>${numIn('cg_cancel', 12)}</div><div><label>${t('team_size')}</label>${numIn('cg_team', 6)}</div></div>
  <div class="grid2"><div><label>${t('sched_day')}</label><select id="cg_dow">${[0, 1, 2, 3, 4, 5, 6].map(d => `<option value="${d}" ${d === 4 ? 'selected' : ''}>${t('dow' + d)}</option>`).join('')}</select></div>
  <div><label>${t('sched_time')}</label><input id="cg_time" type="time" dir="ltr" lang="en" value="21:00"></div></div>
  <div class="row"><button class="btn primary" data-act="createGroup">${t('create')}</button><button class="btn" data-act="closeModal">${t('cancel')}</button></div>`);
ACTIONS.createGroup = async () => {
  const name = val('cg_name').trim(); if (!name) { toast(t('name_required')); return; }
  const uid = S.user.uid, gid = F.doc(F.collection(db, 'groups')).id, code = genCode();
  const g = {
    name, currency: val('cg_cur').trim(), defaultFee: num(val('cg_fee'), 10), hourCost: num(val('cg_cost'), 70),
    maxPlayers: Math.max(1, Math.round(num(val('cg_max'), 18))), cancelHours: Math.max(0, Math.round(num(val('cg_cancel'), 12))),
    teamSize: Math.max(1, Math.round(num(val('cg_team'), 6))), schedule: { dow: +val('cg_dow'), time: val('cg_time') || '21:00' },
    features: { results: true, scorers: true }, fund: 0, ownerId: uid, inviteCode: code, createdAt: F.serverTimestamp()
  };
  const b = F.writeBatch(db);
  b.set(F.doc(db, 'groups', gid), g);
  b.set(F.doc(db, 'groups', gid, 'members', uid), { uid, name: S.profile.name || S.user.displayName || '', photo: S.profile.photo || '', role: 'owner', status: 'active', canAddAdmins: true, pub: pubOf(S.profile), joinedAt: F.serverTimestamp() });
  b.set(F.doc(db, 'users', uid, 'mygroups', gid), { gid, name, createdAt: F.serverTimestamp() });
  await b.commit();
  await F.setDoc(F.doc(db, 'invites', code), { gid, name, createdAt: F.serverTimestamp() });
  closeModal(); S.tab = 'matches'; S.go({ view: 'group', gid });
};
function joinModal(code = '') {
  openModal(() => `<h2>${t('join_group')}</h2><div class="mute small">${t('join_hint')}</div>
    <label>${t('invite_code')}</label><input id="jc" dir="ltr" maxlength="10" style="text-transform:uppercase;letter-spacing:.2em;text-align:center" value="${esc(code)}">
    <div class="row"><button class="btn primary" data-act="joinGroup">${t('send_request')}</button><button class="btn" data-act="closeModal">${t('cancel')}</button></div>`);
}
ACTIONS.joinModal = () => joinModal();
ACTIONS.joinGroup = async () => {
  const code = val('jc').trim().toUpperCase(); if (!code) return;
  const inv = await F.getDoc(F.doc(db, 'invites', code));
  if (!inv.exists()) { toast(t('bad_code')); return; }
  const { gid, name } = inv.data(), uid = S.user.uid;
  const ex = await F.getDoc(F.doc(db, 'groups', gid, 'members', uid));
  if (ex.exists()) { closeModal(); toast(t('already_member')); return; }
  const b = F.writeBatch(db);
  b.set(F.doc(db, 'groups', gid, 'members', uid), { uid, name: S.profile.name || S.user.displayName || '', photo: S.profile.photo || '', role: 'player', status: 'pending', joinCode: code, pub: pubOf(S.profile), joinedAt: F.serverTimestamp() });
  b.set(F.doc(db, 'users', uid, 'mygroups', gid), { gid, name, createdAt: F.serverTimestamp() });
  await b.commit();
  closeModal(); toast(t('request_sent')); S.go({ view: 'group', gid });
};

// ---------- group shell ----------
function groupShell() {
  const back = bar(S.myGroups.find(g => g.id === S.gid)?.name || '…', true);
  if (S.me === undefined) return back + spinner();
  if (S.me === null) return back + `<div class="card"><b>${t('no_access')}</b><div class="row"><button class="btn danger" data-act="forgetGroup">${t('remove_from_list')}</button></div></div>`;
  if (S.me.status === 'pending') return back + `<div class="card" style="text-align:center"><b>${t('pending_title')}</b><div class="mute small">${t('pending_hint')}</div>
    <div class="row"><button class="btn danger" data-act="forgetGroup">${t('cancel_request')}</button></div></div>`;
  if (!S.g) return back + spinner();
  const v = S.nav.view;
  if (v === 'session') return sessionView();
  if (v === 'referee') return refereeView();
  if (v === 'member') return memberView(S.nav.uid);
  const tabs = [['matches', 'calendar', t('tab_matches')], ['rank', 'trophy', t('tab_rank')], ['me', 'user', t('tab_me')], ['group', isAdmin() ? 'settings' : 'info', isAdmin() ? t('tab_admin') : t('tab_group')]];
  let body;
  if (S.tab === 'rank') body = statsTab();
  else if (S.tab === 'me') body = `<div class="row" style="margin:12px 16px 0"><button class="btn" data-act="openProfile">${t('edit_profile')}</button></div>` + memberBody(S.user.uid);
  else if (S.tab === 'group') body = groupTab() + versionLine();
  else body = matchesTab();
  return bar(S.g.name, true) + `<div>${body}</div><div class="nav"><div>${tabs.map(([k, ic, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-k="${k}">${icon(ic)}${l}</button>`).join('')}</div></div>`;
}
ACTIONS.tab = el => { S.tab = el.dataset.k; window.scrollTo(0, 0); render(); };
ACTIONS.forgetGroup = async () => {
  const uid = S.user.uid, gid = S.gid, b = F.writeBatch(db);
  b.delete(F.doc(db, 'groups', gid, 'members', uid));
  b.delete(F.doc(db, 'users', uid, 'mygroups', gid));
  try { await b.commit(); } catch (e) { await F.deleteDoc(F.doc(db, 'users', uid, 'mygroups', gid)); }
  S.go({ view: 'groups' }, true);
};

// ---------- profile ----------
function profileView() {
  const p = S.profile, photo = S.tmpPhoto === undefined ? p.photo : S.tmpPhoto;
  return bar(t('profile'), true) + `<div class="card" style="text-align:center"><div id="pf_av">${av(p.name, photo, 'lg')}</div>
    <div class="row" style="justify-content:center"><label class="btn sm" style="margin:0;cursor:pointer">${t('change_photo')}<input type="file" accept="image/*" data-chg="pickPhoto" style="display:none"></label>
    <button class="btn sm" data-act="rmPhoto">${t('remove_photo')}</button></div></div>
    <div class="card"><label style="margin-top:0">${t('full_name')}</label><input id="pf_name" maxlength="60" value="${esc(p.name || '')}">
    <div class="grid2"><div><label>${t('birth_year')}</label>${numIn('pf_year', p.birthYear || '', 'maxlength="4" placeholder="1990"')}</div>
    <div><label>${t('language')}</label><select id="pf_lang"><option value="ar" ${S.lang === 'ar' ? 'selected' : ''}>العربية</option><option value="en" ${S.lang === 'en' ? 'selected' : ''}>English</option></select></div></div>
    <div class="grid2"><div><label>${t('height_cm')}</label>${numIn('pf_h', p.height || '')}</div><div><label>${t('weight_kg')}</label>${numIn('pf_w', p.weight || '')}</div></div>
    <label>${t('share_title')}</label><div class="mute small">${t('profile_private')}</div>
    <div class="chk"><input type="checkbox" id="pf_sh_age" ${p.share?.age ? 'checked' : ''}><label for="pf_sh_age">${t('share_age')}</label></div>
    <div class="chk"><input type="checkbox" id="pf_sh_h" ${p.share?.height ? 'checked' : ''}><label for="pf_sh_h">${t('share_height')}</label></div>
    <div class="chk"><input type="checkbox" id="pf_sh_w" ${p.share?.weight ? 'checked' : ''}><label for="pf_sh_w">${t('share_weight')}</label></div>
    <div class="row"><button class="btn primary" data-act="saveProfile">${t('save')}</button></div></div>
    <button class="btn danger block" data-act="logout">${t('logout')}</button>`;
}
CHANGES.pickPhoto = async el => {
  const f = el.files[0]; if (!f) return;
  S.tmpPhoto = await resizeImage(f);
  $('#pf_av').innerHTML = av(val('pf_name'), S.tmpPhoto, 'lg');
};
ACTIONS.rmPhoto = () => { S.tmpPhoto = ''; $('#pf_av').innerHTML = av(val('pf_name'), '', 'lg'); };
ACTIONS.saveProfile = async () => {
  const name = val('pf_name').trim(); if (!name) { toast(t('name_required')); return; }
  const photo = S.tmpPhoto === undefined ? (S.profile.photo || '') : S.tmpPhoto;
  const year = Math.round(num(val('pf_year'))), lang = val('pf_lang');
  const data = { name, photo, birthYear: year >= 1900 && year <= new Date().getFullYear() ? year : null, height: num(val('pf_h')) || null, weight: num(val('pf_w')) || null, lang,
    share: { age: checked('pf_sh_age'), height: checked('pf_sh_h'), weight: checked('pf_sh_w') } };
  await F.updateDoc(F.doc(db, 'users', S.user.uid), data);
  S.profile = { ...S.profile, ...data }; S.tmpPhoto = undefined;
  setLang(lang);
  await Promise.all(S.myGroups.map(g => F.updateDoc(F.doc(db, 'groups', g.id, 'members', S.user.uid), { name, photo, pub: pubOf(S.profile) }).catch(() => {})));
  toast(t('saved'));
  if (S.pushed > 0) history.back(); else S.go(S.gid ? { view: 'group', gid: S.gid } : { view: 'groups' }, true);
};
