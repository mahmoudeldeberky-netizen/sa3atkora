import { S, F, db, ACTIONS, CHANGES, INPUTS, t, esc, av, val, num, checked, money, fmtNum, dt, tsMs, toLocalInput, toast, openModal, closeModal, drawModal, confirmBox,
  numIn, dtIn, icon, bar, spinner, isAdmin, gref, gcol, addAudit, addLedger, bumpFund, balanceOf, slotCount, playersOf, attMapFor, myName, photoOf, feat, download } from './core.js';
import { matchModal, eventLine } from './stats.js';

const sessOf = id => S.sessions.find(x => x.id === (id || S.sid));
const startMs = s => tsMs(s.startsAt);
const attRef = (sid, id) => gref('sessions', sid, 'attendance', id);

// =============== matches tab (home) ===============
export function matchesTab() {
  const bal = balanceOf(S.user.uid);
  let h = `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
    <div><div class="mute small">${t('my_balance')}</div><div class="big ${bal < 0 ? 'neg' : 'pos'}" dir="ltr">${fmtNum(bal)} <span class="small">${esc(S.g.currency || '')}</span></div></div>
    <div style="text-align:end"><div class="mute small">${t('fund')}</div><b dir="ltr">${fmtNum(S.g.fund || 0)}</b></div></div>`;
  if (isAdmin()) h += `<button class="btn primary block" data-act="sessionForm">${t('new_session')}</button>`;
  const open = S.sessions.filter(s => s.status === 'open').sort((a, b) => startMs(a) - startMs(b));
  const rest = S.sessions.filter(s => s.status !== 'open').sort((a, b) => startMs(b) - startMs(a));
  if (!S.sessions.length) h += `<div class="empty">${t('no_sessions')}</div>`;
  if (open.length) h += `<h3>${t('upcoming')}</h3>` + open.map(sessionCard).join('');
  if (rest.length) h += `<h3>${t('previous')}</h3>` + rest.map(sessionCard).join('');
  return h;
}

function sessionCard(s) {
  const att = S.oatt[s.id] || {}, mine = att[S.user.uid];
  const open = s.status === 'open', past = Date.now() > startMs(s);
  const n = slotCount(att);
  let h = `<div class="card"><div data-act="openSession" data-id="${esc(s.id)}" style="cursor:pointer">
    <div class="mhead"><div><div class="when">${dt(startMs(s))}</div>${s.location ? `<div class="mute small">${t('location')}: ${esc(s.location)}</div>` : ''}</div>
    <span class="fee">${money(s.fee)}</span></div>`;
  if (open) {
    h += `<div class="meter"><i style="width:${Math.min(100, n / s.maxPlayers * 100)}%"></i></div>
      <div class="mute small">${t('players_count', { n, max: s.maxPlayers })}</div>`;
    if (past && isAdmin()) h += `<span class="tag gold">${t('needs_finalize')}</span>`;
  } else h += `<span class="tag ${s.status === 'cancelled' ? 'warn' : ''}">${t('st_' + s.status)}</span>`;
  h += `</div>`;
  if (open && !past) {
    const r = mine?.rsvp;
    h += `<div class="row"><button class="btn ${r === 'yes' ? 'primary' : ''}" data-act="rsvp" data-sid="${esc(s.id)}" data-v="yes">${t('im_in')}</button>
      <button class="btn ${r === 'no' ? 'dark' : ''}" data-act="rsvp" data-sid="${esc(s.id)}" data-v="no">${t('im_out')}</button></div>
      ${r === 'waitlist' ? `<div class="tag gold" style="margin-top:8px">${t('waitlisted')}</div>` : ''}`;
  }
  return h + `</div>`;
}
ACTIONS.openSession = el => S.go({ view: 'session', gid: S.gid, sid: el.dataset.id });

// =============== RSVP ===============
ACTIONS.rsvp = async el => {
  const sid = el.dataset.sid, v = el.dataset.v, s = sessOf(sid); if (!s || s.status !== 'open') return;
  const att = attMapFor(sid), mine = att[S.user.uid], uid = S.user.uid;
  if (Date.now() > startMs(s)) { toast(t('rsvp_closed')); return; }
  let rs = v;
  if (v === 'yes') {
    if (mine?.rsvp === 'yes') return;
    if (mine?.rsvp === 'waitlist') { toast(t('waitlisted')); return; }
    if (slotCount(att) >= s.maxPlayers) rs = 'waitlist';
  } else {
    if (mine?.rsvp === 'no') return;
    if (mine?.rsvp === 'yes' && Date.now() > startMs(s) - s.cancelHours * 3600e3) { toast(t('late_cancel', { h: s.cancelHours })); return; }
  }
  await F.setDoc(attRef(sid, uid), { uid, name: myName(), rsvp: rs, updatedAt: F.serverTimestamp() });
  toast(rs === 'waitlist' ? t('waitlisted') : t('saved'));
};
ACTIONS.subModal = () => openModal(() => `<h2>${t('send_sub')}</h2><div class="mute small">${t('sub_hint', { fee: money(sessOf().fee) })}</div>
  <label>${t('sub_name')}</label><input id="sub_name" maxlength="40">
  <div class="row"><button class="btn primary" data-act="subSend">${t('send_request')}</button><button class="btn" data-act="closeModal">${t('cancel')}</button></div>`);
ACTIONS.subSend = async () => {
  const name = val('sub_name').trim(); if (!name) { toast(t('name_required')); return; }
  const uid = S.user.uid;
  await F.setDoc(attRef(S.sid, uid), { uid, name: myName(), rsvp: 'yes', updatedAt: F.serverTimestamp(), sub: { name, status: 'pending' } });
  closeModal(); toast(t('saved'));
};

// =============== session view ===============
export function sessionView() {
  const s = sessOf(); if (!s) return bar(t('match'), true) + spinner();
  const adm = isAdmin(), open = s.status === 'open', uid = S.user.uid, mine = S.att[uid];
  const origins = Object.values(S.att).filter(a => !a.subFor);
  const byTime = (a, b) => tsMs(a.updatedAt) - tsMs(b.updatedAt);
  const yes = origins.filter(a => a.rsvp === 'yes').sort(byTime);
  const wl = origins.filter(a => a.rsvp === 'waitlist').sort(byTime);
  const no = origins.filter(a => a.rsvp === 'no');
  const deadline = startMs(s) - s.cancelHours * 3600e3;
  let h = bar(dt(startMs(s), { weekday: 'long', day: 'numeric', month: 'short' }), true);
  h += `<div class="card"><div class="mhead"><div><div class="when">${dt(startMs(s))}</div>
    ${s.location ? `<div class="mute small">${t('location')}: ${esc(s.location)}</div>` : ''}
    ${s.note ? `<div class="small" style="margin-top:6px">${esc(s.note)}</div>` : ''}</div><span class="fee">${money(s.fee)}</span></div>
    <div class="mute small" style="margin-top:8px">${t('free_cancel_until', { time: dt(deadline) })}</div>
    <div style="margin-top:8px"><span class="tag ${s.status === 'cancelled' ? 'warn' : ''}">${t('st_' + s.status)}</span>
    ${adm ? `<span class="tag">${t('pitch_cost')}: ${money(s.cost)}</span>` : ''}</div></div>`;

  if (open && Date.now() < startMs(s)) {
    const r = mine?.rsvp;
    h += `<div class="card"><b>${t('your_status')}: ${r ? t('rs_' + r) : t('rs_none')}</b>
      <div class="row"><button class="btn ${r === 'yes' ? 'primary' : ''}" data-act="rsvp" data-sid="${esc(s.id)}" data-v="yes">${t('im_in')}</button>
      <button class="btn ${r === 'no' ? 'dark' : ''}" data-act="rsvp" data-sid="${esc(s.id)}" data-v="no">${t('im_out')}</button></div>
      ${r === 'yes' && !mine?.sub ? `<div class="row"><button class="btn" data-act="subModal">${t('send_sub')}</button></div>` : ''}
      ${mine?.sub ? `<div class="mute small" style="margin-top:8px">${t('substitute')}: ${esc(mine.sub.name)} — ${t('sub_' + mine.sub.status)}</div>` : ''}</div>`;
  }

  const row = a => {
    const sub = a.sub;
    const subLine = sub ? `<div class="mute small">${t('substitute')}: ${esc(sub.name)} — ${t('sub_' + sub.status)}</div>` : '';
    return `<div class="li">${av(a.name, photoOf(a.uid))}<div><b>${esc(a.name)}</b>
      ${a.guest ? `<span class="tag gold">${t('guest')}</span>` : ''}${a.excused ? `<span class="tag">${t('excused')}</span>` : ''}${subLine}</div>
      ${adm ? `<button class="btn sm" data-act="attMenu" data-id="${esc(a.uid)}">⋯</button>` : ''}</div>`;
  };
  h += `<h3>${t('attending')} (${slotCount(S.att)}/${s.maxPlayers})</h3><div class="card">${yes.length ? yes.map(row).join('') : `<div class="empty">${t('nobody_yet')}</div>`}</div>`;
  if (wl.length) h += `<h3>${t('waitlist')} (${wl.length})</h3><div class="card">${wl.map(a => `<div class="li">${av(a.name, photoOf(a.uid))}<div><b>${esc(a.name)}</b></div>
    ${adm ? `<button class="btn primary sm" data-act="attSet" data-id="${esc(a.uid)}" data-v="yes">${t('approve')}</button>` : ''}</div>`).join('')}</div>`;
  if (no.length) h += `<h3>${t('not_coming')} (${no.length})</h3><div class="card">${no.map(a => `<div class="li">${av(a.name, photoOf(a.uid))}<div class="mute">${esc(a.name)}</div></div>`).join('')}</div>`;

  h += `<div class="row" style="margin:12px 16px"><button class="btn" data-act="ics">${t('add_calendar')}</button></div>`;

  if (adm) {
    h += `<h3>${t('admin_tools')}</h3><div class="card"><div class="row" style="margin-top:0">
      ${open ? `<button class="btn" data-act="addPlayerModal">${t('add_player')}</button><button class="btn" data-act="addGuestModal">${t('add_guest')}</button>
      <button class="btn" data-act="sessionForm" data-id="${esc(s.id)}">${t('edit')}</button>
      <button class="btn primary" data-act="finalize">${t('finalize')}</button>
      <button class="btn danger" data-act="cancelSession">${t('cancel_session')}</button>` : ''}
      ${s.status === 'done' && s.summary ? `<div class="mute small">${t('summary_line', { n: s.summary.charged, fee: fmtNum(s.summary.fee), cost: fmtNum(s.summary.cost), guests: fmtNum(s.summary.guests) })}</div>` : ''}
    </div></div>`;
  }

  if (feat('results') && s.status !== 'cancelled') h += teamsAndMatches(s);
  return h;
}

// =============== admin attendance tools ===============
ACTIONS.attMenu = el => {
  const id = el.dataset.id;
  openModal(() => {
    const a = S.att[id]; if (!a) return '';
    const b = (v, label, cls = '') => `<button class="btn ${cls}" data-act="attSet" data-id="${esc(id)}" data-v="${v}">${label}</button>`;
    return `<h2>${esc(a.name)}</h2><div class="row" style="flex-direction:column">
      ${a.rsvp !== 'yes' ? b('yes', t('mark_in'), 'primary') : b('no', t('mark_out'))}
      ${!a.guest && a.rsvp === 'yes' ? (a.excused ? b('unexcuse', t('unexcuse')) : b('excuse', t('excuse'))) : ''}
      ${a.sub?.status === 'pending' ? b('subok', t('sub_approve'), 'primary') + b('subno', t('sub_reject')) : ''}
      ${b('del', t('remove_record'), 'danger')}<button class="btn" data-act="closeModal">${t('close')}</button></div>`;
  });
};
ACTIONS.attSet = async el => {
  const id = el.dataset.id, v = el.dataset.v, a = S.att[id]; if (!a) return;
  const b = F.writeBatch(db), ref = attRef(S.sid, id), subRef = attRef(S.sid, 's_' + id), now = F.serverTimestamp();
  if (v === 'yes') b.update(ref, { rsvp: 'yes', updatedAt: now });
  else if (v === 'no') { b.update(ref, { rsvp: 'no', updatedAt: now, sub: F.deleteField() }); b.delete(subRef); }
  else if (v === 'excuse') b.update(ref, { excused: true });
  else if (v === 'unexcuse') b.update(ref, { excused: false });
  else if (v === 'subok') {
    b.update(ref, { 'sub.status': 'approved' });
    b.set(subRef, { uid: 's_' + id, name: a.sub.name, guest: true, subFor: id, rsvp: 'yes', paid: 0, updatedAt: now });
  } else if (v === 'subno') { b.update(ref, { 'sub.status': 'rejected' }); b.delete(subRef); }
  else if (v === 'del') { b.delete(ref); b.delete(subRef); }
  addAudit(b, 'att_' + v, `${a.name} · ${dt(startMs(sessOf()), { day: 'numeric', month: 'short' })}`);
  await b.commit(); closeModal(); toast(t('saved'));
};
ACTIONS.addPlayerModal = () => {
  const list = Object.values(S.members).filter(m => m.status === 'active' && S.att[m.uid]?.rsvp !== 'yes').sort((a, b) => a.name.localeCompare(b.name));
  openModal(() => `<h2>${t('add_player')}</h2><label>${t('member')}</label>
    <select id="ap_uid">${list.map(m => `<option value="${esc(m.uid)}">${esc(m.name)}</option>`).join('')}</select>
    <div class="row"><button class="btn primary" data-act="addPlayer">${t('save')}</button><button class="btn" data-act="closeModal">${t('cancel')}</button></div>`);
};
ACTIONS.addPlayer = async () => {
  const uid = val('ap_uid'); if (!uid) return;
  const m = S.members[uid], b = F.writeBatch(db);
  b.set(attRef(S.sid, uid), { uid, name: m.name, rsvp: 'yes', updatedAt: F.serverTimestamp() });
  addAudit(b, 'att_add', m.name);
  await b.commit(); closeModal(); toast(t('saved'));
};
ACTIONS.addGuestModal = () => openModal(() => `<h2>${t('add_guest')}</h2>
  <label>${t('guest_name')}</label><input id="ag_name" maxlength="40">
  <label>${t('guest_paid')} (${esc(S.g.currency || '')})</label>${numIn('ag_paid', sessOf().fee)}
  <div class="row"><button class="btn primary" data-act="addGuest">${t('save')}</button><button class="btn" data-act="closeModal">${t('cancel')}</button></div>`);
ACTIONS.addGuest = async () => {
  const name = val('ag_name').trim(); if (!name) { toast(t('name_required')); return; }
  const id = 'g_' + Math.random().toString(36).slice(2, 9), paid = Math.max(0, num(val('ag_paid')));
  const b = F.writeBatch(db);
  b.set(attRef(S.sid, id), { uid: id, name, guest: true, rsvp: 'yes', paid, updatedAt: F.serverTimestamp() });
  addAudit(b, 'att_guest', `${name} · ${fmtNum(paid)}`);
  await b.commit(); closeModal(); toast(t('saved'));
};

// =============== session form ===============
function nextSlot() {
  const sc = S.g.schedule || { dow: 4, time: '21:00' };
  const [hh, mm] = (sc.time || '21:00').split(':').map(Number);
  const d = new Date(); d.setHours(hh, mm, 0, 0);
  let add = (sc.dow - d.getDay() + 7) % 7;
  if (add === 0 && d.getTime() < Date.now()) add = 7;
  d.setDate(d.getDate() + add); return d;
}
ACTIONS.sessionForm = el => {
  const s = el?.dataset?.id ? sessOf(el.dataset.id) : null, g = S.g;
  openModal(() => `<h2>${s ? t('edit_session') : t('new_session')}</h2>
    <label>${t('date_time')}</label>${dtIn('sf_dt', toLocalInput(s ? new Date(startMs(s)) : nextSlot()))}
    <div class="grid2"><div><label>${t('fee_per_player')}</label>${numIn('sf_fee', s?.fee ?? g.defaultFee ?? 10)}</div>
    <div><label>${t('pitch_cost')}</label>${numIn('sf_cost', s?.cost ?? g.hourCost ?? 70)}</div></div>
    <div class="grid2"><div><label>${t('max_players')}</label>${numIn('sf_max', s?.maxPlayers ?? g.maxPlayers ?? 18)}</div>
    <div><label>${t('cancel_hours')}</label>${numIn('sf_cancel', s?.cancelHours ?? g.cancelHours ?? 12)}</div></div>
    <label>${t('location')}</label><input id="sf_loc" maxlength="80" value="${esc(s?.location || '')}">
    <label>${t('note')}</label><input id="sf_note" maxlength="160" value="${esc(s?.note || '')}">
    <div class="row"><button class="btn primary" data-act="saveSession" data-id="${esc(s?.id || '')}">${t('save')}</button><button class="btn" data-act="closeModal">${t('cancel')}</button></div>`);
};
ACTIONS.saveSession = async el => {
  const id = el.dataset.id, d = new Date(val('sf_dt'));
  if (isNaN(d)) { toast(t('bad_date')); return; }
  const data = {
    startsAt: F.Timestamp.fromDate(d), fee: Math.max(0, num(val('sf_fee'))), cost: Math.max(0, num(val('sf_cost'))),
    maxPlayers: Math.max(1, Math.round(num(val('sf_max'), 18))), cancelHours: Math.max(0, Math.round(num(val('sf_cancel'), 12))),
    location: val('sf_loc').trim(), note: val('sf_note').trim()
  };
  const b = F.writeBatch(db);
  if (id) b.update(gref('sessions', id), data);
  else b.set(F.doc(gcol('sessions')), { ...data, durationMin: 60, status: 'open', createdAt: F.serverTimestamp(), createdBy: S.user.uid });
  addAudit(b, id ? 'session_edit' : 'session_new', dt(d.getTime(), { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
  await b.commit(); closeModal(); toast(t('saved'));
};
ACTIONS.cancelSession = () => confirmBox(t('cancel_session_q'), async () => {
  const b = F.writeBatch(db);
  b.update(gref('sessions', S.sid), { status: 'cancelled' });
  addAudit(b, 'session_cancel', dt(startMs(sessOf()), { day: 'numeric', month: 'short' }));
  await b.commit(); toast(t('saved'));
}, true);

// =============== finalize ===============
function plan() {
  const s = sessOf(), all = Object.values(S.att);
  const charged = all.filter(a => a.rsvp === 'yes' && !a.guest && !a.excused);
  const guests = all.filter(a => a.rsvp === 'yes' && a.guest && !a.subFor && a.paid > 0);
  return { s, charged, guests, guestSum: guests.reduce((x, a) => x + a.paid, 0) };
}
ACTIONS.finalize = () => {
  const p = plan();
  openModal(() => `<h2>${t('finalize')}</h2><div class="mute small">${t('finalize_hint')}</div>
    <div class="card" style="margin:12px 0">
      <div class="li"><div>${t('charged_players')}</div><b>${p.charged.length} × ${money(p.s.fee)}</b></div>
      <div class="li"><div>${t('guest_income')}</div><b>+${money(p.guestSum)}</b></div>
      <div class="li"><div>${t('pitch_cost')}</div><b class="neg">-${money(p.s.cost)}</b></div>
      <div class="li"><div>${t('fund_change')}</div><b dir="ltr">${fmtNum(p.guestSum - p.s.cost)}</b></div></div>
    <div class="row"><button class="btn primary" data-act="doFinalize">${t('confirm')}</button><button class="btn" data-act="closeModal">${t('cancel')}</button></div>`);
};
ACTIONS.doFinalize = async () => {
  const p = plan(), sref = gref('sessions', S.sid);
  await F.runTransaction(db, async tx => {
    const snap = await tx.get(sref);
    if (!snap.exists() || snap.data().status !== 'open') throw new Error('already_done');
    let fund = 0;
    const when = dt(startMs(p.s), { day: 'numeric', month: 'short' });
    p.charged.forEach(a => { addLedger(tx, { type: 'charge', uid: a.uid, amount: -p.s.fee, sid: S.sid, note: when }); });
    p.guests.forEach(a => { fund += addLedger(tx, { type: 'guest', name: a.name, fund: a.paid, sid: S.sid, note: when }); });
    if (p.s.cost > 0) fund += addLedger(tx, { type: 'expense', fund: -p.s.cost, sid: S.sid, note: when });
    bumpFund(tx, fund);
    tx.update(sref, { status: 'done', finalizedAt: F.serverTimestamp(), finalizedBy: S.user.uid,
      summary: { charged: p.charged.length, fee: p.s.fee, cost: p.s.cost, guests: p.guestSum } });
    addAudit(tx, 'finalize', `${when} · ${p.charged.length}`);
  });
  closeModal(); toast(t('saved'));
};

// =============== calendar ===============
ACTIONS.ics = () => {
  const s = sessOf(), z = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const txt = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//sa3et-kora//EN', 'BEGIN:VEVENT', `UID:${s.id}@sa3et-kora`, `DTSTAMP:${z(Date.now())}`,
    `DTSTART:${z(startMs(s))}`, `DTEND:${z(startMs(s) + (s.durationMin || 60) * 60000)}`, `SUMMARY:${S.g.name}`, s.location ? `LOCATION:${s.location}` : '',
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Football', 'END:VALARM', 'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:Football', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  download('football.ics', txt, 'text/calendar;charset=utf-8');
};

// =============== teams & matches ===============
function teamsAndMatches(s) {
  const adm = isAdmin(), teams = s.teams || [];
  const nm = id => S.att[id]?.name || '—';
  const ms = [...S.smatches].sort((a, b) => (a.no || 0) - (b.no || 0));
  let h = `<h3>${t('teams_matches')}</h3>`;
  if (teams.length) {
    h += `<div class="card"><div class="grid2">${teams.map(tm => `<div class="tile"><b>${t('team')} ${esc(tm.name)}</b>
      ${tm.players.map(id => `<div class="small">${esc(nm(id))}</div>`).join('')}</div>`).join('')}</div></div>`;
  }
  h += `<div class="card">${ms.length ? ms.map(m => `<div class="li" data-act="openMatch" data-id="${esc(m.id)}" style="cursor:pointer">
    <div><b>${t('match')} ${m.no || ''}</b>${m.status === 'live' ? ` <span class="tag warn">${t('live')}</span>` : ''}</div><b dir="ltr">${esc(m.teamA?.name)} ${m.scoreA} - ${m.scoreB} ${esc(m.teamB?.name)}</b>
    ${m.pens ? `<span class="tag gold" dir="ltr">${m.pens.a}-${m.pens.b}</span>` : ''}<span class="mute">›</span></div>`).join('') : `<div class="empty">${t('no_matches')}</div>`}
    ${adm ? `<div class="row"><button class="btn" data-act="splitTeams">${t('split_teams')}</button><button class="btn primary" data-act="refSetup">${t('start_live')}</button><button class="btn" data-act="newMatch">${t('new_match')}</button></div>` : ''}</div>`;
  return h;
}

// ---- split teams ----
let T = null;
const letters = 'ABCDEF';
function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function randomAssign(ids, n) { const o = {}; shuffle(ids).forEach((id, i) => { o[id] = i % n; }); return o; }
function splitHtml() {
  const pl = playersOf(S.att);
  return `<h2>${t('split_teams')}</h2>
  <label>${t('num_teams')}</label><select data-chg="tN">${[2, 3, 4, 5, 6].map(n => `<option ${T.n === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
  <div class="row"><button class="btn" data-act="reshuffle">${t('reshuffle')}</button></div>
  ${Array.from({ length: T.n }, (_, i) => `<div class="mute small" style="margin-top:12px"><b>${t('team')} ${letters[i]}</b> (${pl.filter(p => T.assign[p.uid] === i).length})</div>`).join('')}
  <div>${pl.map(p => `<div class="li"><div><b>${esc(p.name)}</b></div>
    <select style="width:90px" data-chg="tAssign" data-id="${esc(p.uid)}">${Array.from({ length: T.n }, (_, i) => `<option value="${i}" ${T.assign[p.uid] === i ? 'selected' : ''}>${letters[i]}</option>`).join('')}</select></div>`).join('')}</div>
  <div class="row"><button class="btn primary" data-act="saveTeams">${t('save')}</button><button class="btn" data-act="closeModal">${t('cancel')}</button></div>`;
}
function redraw() {
  const sc = document.querySelector('.sheet'), y = sc ? sc.scrollTop : 0;
  drawModal(); const n = document.querySelector('.sheet'); if (n) n.scrollTop = y;
}
ACTIONS.splitTeams = () => {
  const pl = playersOf(S.att); if (pl.length < 2) { toast(t('need_players')); return; }
  const s = sessOf();
  if (s.teams?.length) {
    const assign = {}; s.teams.forEach((tm, i) => tm.players.forEach(id => { assign[id] = i; }));
    pl.forEach(p => { if (assign[p.uid] === undefined) assign[p.uid] = 0; });
    T = { n: s.teams.length, assign };
  } else {
    const n = Math.min(6, Math.max(2, Math.round(pl.length / (S.g.teamSize || 6))));
    T = { n, assign: randomAssign(pl.map(p => p.uid), n) };
  }
  openModal(splitHtml);
};
CHANGES.tN = el => { T.n = +el.value; T.assign = randomAssign(playersOf(S.att).map(p => p.uid), T.n); redraw(); };
CHANGES.tAssign = el => { T.assign[el.dataset.id] = +el.value; redraw(); };
ACTIONS.reshuffle = () => { T.assign = randomAssign(playersOf(S.att).map(p => p.uid), T.n); redraw(); };
ACTIONS.saveTeams = async () => {
  const pl = playersOf(S.att);
  const teams = Array.from({ length: T.n }, (_, i) => ({ name: letters[i], players: pl.filter(p => T.assign[p.uid] === i).map(p => p.uid) }));
  const b = F.writeBatch(db);
  b.update(gref('sessions', S.sid), { teams });
  addAudit(b, 'teams', `${T.n}`);
  await b.commit(); closeModal(); toast(t('saved'));
};

// ---- match editor ----
let E = null;
const opp = x => (x === 'A' ? 'B' : 'A');
function pool() { return E.pool; }
function teamOf(id) { return E.assign[id] || ''; }
function assigned() { return E.pool.filter(p => teamOf(p.id)); }
function fillFromTeams() {
  const s = sessOf(), ta = s.teams?.[E.ia], tb = s.teams?.[E.ib];
  E.assign = {};
  if (ta) { E.a = ta.name; ta.players.forEach(id => { E.assign[id] = 'A'; }); }
  if (tb) { E.b = tb.name; tb.players.forEach(id => { E.assign[id] = 'B'; }); }
}
ACTIONS.newMatch = () => {
  const s = sessOf(), pl = playersOf(S.att);
  if (pl.length < 2) { toast(t('need_players')); return; }
  E = { id: null, no: S.smatches.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1, a: 'A', b: 'B', ia: 0, ib: 1, assign: {}, scoreA: 0, scoreB: 0, goals: [], saves: {}, pens: null,
    pool: pl.map(p => ({ id: p.uid, name: p.name })) };
  if (s.teams?.length >= 2) fillFromTeams();
  openModal(editorHtml);
};
ACTIONS.editMatch = el => {
  const m = S.smatches.find(x => x.id === el.dataset.id) || S.stats?.matches.find(x => x.id === el.dataset.id); if (!m || m.status === 'live') return;
  const assign = {}; (m.teamA?.players || []).forEach(id => { assign[id] = 'A'; }); (m.teamB?.players || []).forEach(id => { assign[id] = 'B'; });
  const ids = new Set(m.players || []);
  const pl = (m.players || []).map(id => ({ id, name: m.names?.[id] || S.members[id]?.name || '—' }));
  if (m.sid === S.sid) playersOf(S.att).forEach(p => { if (!ids.has(p.uid)) pl.push({ id: p.uid, name: p.name }); });
  E = { id: m.id, sid: m.sid, no: m.no || 1, a: m.teamA?.name || 'A', b: m.teamB?.name || 'B', ia: 0, ib: 1, assign, scoreA: m.scoreA, scoreB: m.scoreB,
    goals: (m.goals || []).map(g => ({ ...g })), saves: { ...(m.saves || {}) }, pens: m.pens ? { ...m.pens } : null, pool: pl, date: m.date };
  openModal(editorHtml);
};
function editorHtml() {
  const s = sessOf(), tms = s?.teams || [];
  const pn = id => esc(E.pool.find(p => p.id === id)?.name || '—');
  const as = assigned();
  const tOpt = (sel) => tms.map((tm, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(tm.name)}</option>`).join('');
  const stepper = (k, label, score) => `<div style="text-align:center;flex:1"><div class="small mute">${t('team')} ${esc(label)}</div>
    <div style="display:flex;align-items:center;justify-content:center;gap:8px"><button class="btn sm" data-act="meScore" data-k="${k}" data-d="-1">-</button><b class="big" dir="ltr">${score}</b><button class="btn sm" data-act="meScore" data-k="${k}" data-d="1">+</button></div></div>`;
  const pOpts = as.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(teamOf(p.id) === 'A' ? E.a : E.b)})</option>`).join('');
  return `<h2>${t('match')} ${E.no}</h2>
  ${!E.id && tms.length >= 2 ? `<div class="grid2"><div><label>${t('team')} A</label><select data-chg="meTeamA">${tOpt(E.ia)}</select></div><div><label>${t('team')} B</label><select data-chg="meTeamB">${tOpt(E.ib)}</select></div></div>` : ''}
  <div class="card" style="margin:12px 0"><div style="display:flex;align-items:center;gap:6px">${stepper('A', E.a, E.scoreA)}<b>-</b>${stepper('B', E.b, E.scoreB)}</div>
    ${E.scoreA === E.scoreB ? `<div class="chk" style="margin-top:12px"><input type="checkbox" id="me_pens" data-chg="mePens" ${E.pens ? 'checked' : ''}><label for="me_pens">${t('pens_played')}</label></div>
      ${E.pens ? `<div class="grid2" dir="ltr"><input data-inp="mePA" type="text" inputmode="numeric" lang="en" value="${E.pens.a}"><input data-inp="mePB" type="text" inputmode="numeric" lang="en" value="${E.pens.b}"></div>` : ''}` : ''}</div>
  <b>${t('lineups')}</b>
  ${E.pool.map(p => `<div class="li"><div>${esc(p.name)}</div><select style="width:110px" data-chg="meAssign" data-id="${esc(p.id)}">
    <option value="">—</option><option value="A" ${teamOf(p.id) === 'A' ? 'selected' : ''}>${t('team')} ${esc(E.a)}</option><option value="B" ${teamOf(p.id) === 'B' ? 'selected' : ''}>${t('team')} ${esc(E.b)}</option></select></div>`).join('')}
  ${feat('scorers') && as.length ? `<h3 style="margin:16px 0 4px">${t('goals')}</h3>
    ${E.goals.map((g, i) => `<div class="li"><div><b>${pn(g.uid)}</b>${g.og ? ` <span class="tag warn">${t('own_goal')}</span>` : ''}${g.penalty ? ` <span class="tag gold">${t('penalty')}</span>` : ''}
      ${g.assist ? `<div class="mute small">${t('assist_by')}: ${pn(g.assist)}</div>` : ''}</div><span class="tag">${esc(g.team === 'A' ? E.a : E.b)}</span><button class="btn sm danger" data-act="meDelGoal" data-i="${i}">${icon('x')}</button></div>`).join('')}
    <div class="card" style="margin:8px 0"><label style="margin-top:0">${t('scorer')}</label><select id="mg_sc">${pOpts}</select>
    <label>${t('assist')}</label><select id="mg_as"><option value="">—</option>${pOpts}</select>
    <div class="chk"><input type="checkbox" id="mg_pen"><label for="mg_pen">${t('penalty')}</label></div>
    <div class="chk"><input type="checkbox" id="mg_og"><label for="mg_og">${t('own_goal')}</label></div>
    <button class="btn primary" data-act="meAddGoal">${t('add_goal')}</button></div>
    <h3 style="margin:16px 0 4px">${t('saves')}</h3>
    ${Object.entries(E.saves).map(([id, n]) => `<div class="li"><div>${pn(id)}</div><b>${n}</b><button class="btn sm danger" data-act="meDelSave" data-id="${esc(id)}">${icon('x')}</button></div>`).join('')}
    <div class="row"><select id="mg_gk" style="flex:2">${pOpts}</select><button class="btn" data-act="meAddSave">${t('add_save')}</button></div>` : ''}
  <div class="row" style="margin-top:18px"><button class="btn primary" data-act="meSave">${t('save')}</button>
    ${E.id ? `<button class="btn danger" data-act="meDelete">${t('delete')}</button>` : ''}<button class="btn" data-act="closeModal">${t('cancel')}</button></div>`;
}
CHANGES.meTeamA = el => { E.ia = +el.value; fillFromTeams(); redraw(); };
CHANGES.meTeamB = el => { E.ib = +el.value; fillFromTeams(); redraw(); };
CHANGES.meAssign = el => { E.assign[el.dataset.id] = el.value; E.goals = E.goals.filter(g => teamOf(g.uid) && true); redraw(); };
CHANGES.mePens = el => { E.pens = el.checked ? { a: 0, b: 0 } : null; redraw(); };
INPUTS.mePA = el => { E.pens.a = Math.max(0, Math.round(num(el.value))); };
INPUTS.mePB = el => { E.pens.b = Math.max(0, Math.round(num(el.value))); };
ACTIONS.meScore = el => {
  const k = 'score' + el.dataset.k; E[k] = Math.max(0, E[k] + +el.dataset.d);
  if (E.scoreA !== E.scoreB) E.pens = null;
  redraw();
};
ACTIONS.meAddGoal = () => {
  const uid = val('mg_sc'), assist = val('mg_as'); if (!uid) return;
  const og = checked('mg_og'), penalty = checked('mg_pen');
  const ut = teamOf(uid);
  if (assist && (og || teamOf(assist) !== ut || assist === uid)) { toast(t('bad_assist')); return; }
  const team = og ? opp(ut) : ut;
  E.goals.push({ team, uid, assist: assist || '', penalty: penalty && !og, og });
  E['score' + team]++;
  if (E.scoreA !== E.scoreB) E.pens = null;
  redraw();
};
ACTIONS.meDelGoal = el => {
  const g = E.goals.splice(+el.dataset.i, 1)[0];
  if (g) E['score' + g.team] = Math.max(0, E['score' + g.team] - 1);
  redraw();
};
ACTIONS.meAddSave = () => { const id = val('mg_gk'); if (!id) return; E.saves[id] = (E.saves[id] || 0) + 1; redraw(); };
ACTIONS.meDelSave = el => { delete E.saves[el.dataset.id]; redraw(); };
ACTIONS.meSave = async () => {
  const as = assigned();
  if (!as.length) { toast(t('need_lineups')); return; }
  const ids = as.map(p => p.id), names = {}; as.forEach(p => { names[p.id] = p.name; });
  const inSet = new Set(ids);
  const goals = E.goals.filter(g => inSet.has(g.uid));
  const saves = {}; Object.entries(E.saves).forEach(([id, n]) => { if (inSet.has(id)) saves[id] = n; });
  const data = {
    no: E.no, teamA: { name: E.a, players: as.filter(p => teamOf(p.id) === 'A').map(p => p.id) },
    teamB: { name: E.b, players: as.filter(p => teamOf(p.id) === 'B').map(p => p.id) },
    scoreA: E.scoreA, scoreB: E.scoreB, pens: E.scoreA === E.scoreB ? E.pens : null, goals, saves, players: ids, names,
    by: S.user.uid, updatedAt: F.serverTimestamp()
  };
  const b = F.writeBatch(db);
  if (E.id) b.update(gref('matches', E.id), data);
  else b.set(F.doc(gcol('matches')), { ...data, sid: S.sid, date: startMs(sessOf()), createdAt: F.serverTimestamp() });
  addAudit(b, E.id ? 'match_edit' : 'match_new', `#${E.no} ${E.a} ${E.scoreA}-${E.scoreB} ${E.b}`);
  await b.commit(); S.stats = null; closeModal(); toast(t('saved'));
};
ACTIONS.meDelete = () => confirmBox(t('delete_match_q'), async () => {
  const b = F.writeBatch(db);
  b.delete(gref('matches', E.id));
  addAudit(b, 'match_delete', `#${E.no}`);
  await b.commit(); S.stats = null; toast(t('saved'));
}, true);

// =============== referee mode (stopwatch + live events) ===============
let refTimer = null, audioCtx = null, wake = null, firedKey = '', R = null;
const liveOf = id => S.smatches.find(m => m.id === id);
const elapsedOf = m => (m.elapsedMs || 0) + (m.running ? Date.now() - (m.lastStart || Date.now()) : 0);
const remainingMs = m => (m.durationSec || 900) * 1000 - elapsedOf(m);
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const clockCls = m => (m.status !== 'live' ? '' : (!m.running ? 'pause' : (remainingMs(m) <= 60000 ? 'low' : 'run')));
const evId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

function ensureAudio() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {}
}
function beep(n = 3) {
  try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 500]); } catch (e) {}
  if (!audioCtx) return;
  for (let i = 0; i < n; i++) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), at = audioCtx.currentTime + i * 0.4;
    o.frequency.value = i === n - 1 ? 1100 : 800; o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.4, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    o.start(at); o.stop(at + 0.32);
  }
}
function derive(events) {
  let scoreA = 0, scoreB = 0; const goals = [], saves = {};
  events.forEach(e => {
    if (e.type === 'goal') { if (e.team === 'A') scoreA++; else scoreB++; goals.push({ team: e.team, uid: e.uid, assist: e.assist || '', penalty: !!e.penalty, og: !!e.og, t: e.t || 0 }); }
    else if (e.type === 'save') saves[e.uid] = (saves[e.uid] || 0) + 1;
  });
  return { scoreA, scoreB, goals, saves };
}
async function pushEvents(m, fn) {
  const events = fn([...(m.events || [])]);
  await F.updateDoc(gref('matches', m.id), { events, ...derive(events), updatedAt: F.serverTimestamp() });
}
const patchLive = (id, data) => F.updateDoc(gref('matches', id), { ...data, updatedAt: F.serverTimestamp() });

function refTick() {
  const m = S.nav.view === 'referee' && liveOf(S.nav.mid); if (!m) return;
  const el = document.getElementById('ref_clock');
  if (el) { el.textContent = mmss(m.status === 'live' ? remainingMs(m) : 0); el.className = 'clock ' + clockCls(m); }
  const key = m.id + ':' + m.durationSec;
  if (m.status === 'live' && m.running && remainingMs(m) <= 0 && firedKey !== key) {
    firedKey = key; beep();
    if (isAdmin()) patchLive(m.id, { running: false, elapsedMs: (m.durationSec || 900) * 1000, lastStart: 0, timeUp: true }).catch(() => {});
  }
}
export function refAfterRender() {
  if (S.nav.view === 'referee') {
    if (!refTimer) refTimer = setInterval(refTick, 250);
    if (!wake && navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { wake = l; l.addEventListener('release', () => { wake = null; }); }).catch(() => {});
  } else {
    if (refTimer) { clearInterval(refTimer); refTimer = null; }
    if (wake) { try { wake.release(); } catch (e) {} wake = null; }
  }
}

// ---- setup ----
ACTIONS.refSetup = () => {
  const s = sessOf(), pl = playersOf(S.att);
  if (pl.length < 2) { toast(t('need_players')); return; }
  E = { id: null, no: S.smatches.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1, a: 'A', b: 'B', ia: 0, ib: 1, assign: {}, scoreA: 0, scoreB: 0, goals: [], saves: {}, pens: null,
    pool: pl.map(p => ({ id: p.uid, name: p.name })), mins: S.g.matchMinutes ?? 15 };
  if (s.teams?.length >= 2) fillFromTeams();
  openModal(refSetupHtml);
};
function refSetupHtml() {
  const s = sessOf(), tms = s?.teams || [];
  const tOpt = sel => tms.map((tm, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(tm.name)}</option>`).join('');
  return `<h2>${t('start_live')}</h2>
  ${tms.length >= 2 ? `<div class="grid2"><div><label>${t('team')} A</label><select data-chg="meTeamA">${tOpt(E.ia)}</select></div><div><label>${t('team')} B</label><select data-chg="meTeamB">${tOpt(E.ib)}</select></div></div>` : ''}
  <label>${t('match_minutes')}</label>${numIn('rf_min', E.mins)}
  <b style="display:block;margin-top:14px">${t('lineups')}</b>
  ${E.pool.map(p => `<div class="li"><div>${esc(p.name)}</div><select style="width:110px" data-chg="meAssign" data-id="${esc(p.id)}">
    <option value="">-</option><option value="A" ${teamOf(p.id) === 'A' ? 'selected' : ''}>${t('team')} ${esc(E.a)}</option><option value="B" ${teamOf(p.id) === 'B' ? 'selected' : ''}>${t('team')} ${esc(E.b)}</option></select></div>`).join('')}
  <div class="row" style="margin-top:16px"><button class="btn primary" data-act="refStart">${t('start_live')}</button><button class="btn" data-act="closeModal">${t('cancel')}</button></div>`;
}
ACTIONS.refStart = async () => {
  const as = assigned();
  if (!as.some(p => teamOf(p.id) === 'A') || !as.some(p => teamOf(p.id) === 'B')) { toast(t('need_lineups')); return; }
  const mins = Math.max(1, Math.round(num(val('rf_min'), 15)));
  ensureAudio();
  const ref = F.doc(gcol('matches')), b = F.writeBatch(db), names = {};
  as.forEach(p => { names[p.id] = p.name; });
  b.set(ref, {
    sid: S.sid, no: E.no, date: startMs(sessOf()), status: 'live', durationSec: mins * 60, elapsedMs: 0, running: false, lastStart: 0, timeUp: false,
    teamA: { name: E.a, players: as.filter(p => teamOf(p.id) === 'A').map(p => p.id) }, teamB: { name: E.b, players: as.filter(p => teamOf(p.id) === 'B').map(p => p.id) },
    scoreA: 0, scoreB: 0, pens: null, goals: [], saves: {}, events: [], players: as.map(p => p.id), names, by: S.user.uid, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp()
  });
  addAudit(b, 'match_live', `#${E.no} ${E.a} - ${E.b}`);
  await b.commit();
  S.go({ view: 'referee', gid: S.gid, sid: S.sid, mid: ref.id });
};

// ---- console ----
export function refereeView() {
  const m = liveOf(S.nav.mid);
  if (!m) return bar(t('match'), true) + spinner();
  const adm = isAdmin(), live = m.status === 'live';
  const pl = id => esc(m.names?.[id] || '-');
  const panel = k => {
    const tm = k === 'A' ? m.teamA : m.teamB;
    const b = (type, label, cls = '') => `<button class="btn ${cls}" data-act="refEv" data-team="${k}" data-type="${type}">${label}</button>`;
    return `<div class="tile" style="text-align:center"><b>${t('team')} ${esc(tm.name)}</b><div class="big" dir="ltr">${k === 'A' ? m.scoreA : m.scoreB}</div>
      ${adm && live ? `<div style="display:grid;gap:6px;margin-top:8px">${b('goal', t('goal_btn'), 'primary')}${b('yellow', t('yellow_btn'))}${b('red', t('red_btn'))}${b('save', t('save_btn'))}</div>` : ''}</div>`;
  };
  const events = [...(m.events || [])].reverse();
  let h = bar(`${t('match')} ${m.no || ''}`, true, live ? `<span class="tag warn" style="background:#fff;margin-inline-end:8px">${t('live')}</span>` : '');
  h += `<div class="card" style="text-align:center"><div id="ref_clock" class="clock ${clockCls(m)}" dir="ltr">${mmss(live ? remainingMs(m) : 0)}</div>
    <div class="mute small">${live ? (m.timeUp ? t('time_up') : (m.running ? t('running') : t('paused'))) : t('match_ended')} · ${t('match_minutes')}: ${fmtNum((m.durationSec || 900) / 60)}</div>
    ${adm && live ? `<div class="row"><button class="btn primary" data-act="refToggle">${m.running ? t('pause') : (m.elapsedMs ? t('resume') : t('kickoff'))}</button>
      <button class="btn" data-act="refAddMin">${t('add_minute')}</button></div>` : ''}</div>`;
  h += `<div class="grid2" style="margin:12px 16px">${panel('A')}${panel('B')}</div>`;
  if (m.scoreA === m.scoreB && (m.pens || (adm && live))) {
    h += `<div class="card"><b>${t('shootout')}</b>${m.pens ? `<div class="grid2" style="margin-top:8px">${['a', 'b'].map(k => `<div style="text-align:center"><div class="small mute">${t('team')} ${esc(k === 'a' ? m.teamA.name : m.teamB.name)}</div>
      <div style="display:flex;justify-content:center;align-items:center;gap:8px">${adm && live ? `<button class="btn sm" data-act="refPen" data-k="${k}" data-d="-1">-</button>` : ''}<b class="big" dir="ltr">${m.pens[k]}</b>${adm && live ? `<button class="btn sm" data-act="refPen" data-k="${k}" data-d="1">+</button>` : ''}</div></div>`).join('')}</div>` : ''}
      ${adm && live ? `<div class="row"><button class="btn" data-act="refPens">${m.pens ? t('remove_shootout') : t('start_shootout')}</button></div>` : ''}</div>`;
  }
  h += `<h3>${t('events')}</h3><div class="card">${events.length ? events.map(e => eventLine(m, e, adm && live)).join('') : `<div class="empty">${t('no_events')}</div>`}</div>`;
  if (adm && live) h += `<div class="row" style="margin:12px 16px"><button class="btn primary" data-act="refEnd">${t('end_match')}</button><button class="btn danger" data-act="refAbort">${t('abort_match')}</button></div>`;
  if (!adm && live) h += `<div class="mute small" style="text-align:center;padding:8px 16px">${t('ref_readonly_hint')}</div>`;
  return h;
}

// ---- actions ----
ACTIONS.refToggle = async () => {
  const m = liveOf(S.nav.mid); if (!m || m.status !== 'live') return; ensureAudio();
  if (m.running) await patchLive(m.id, { running: false, elapsedMs: elapsedOf(m), lastStart: 0 });
  else { if (remainingMs(m) <= 0) { toast(t('time_up')); return; } await patchLive(m.id, { running: true, lastStart: Date.now(), timeUp: false }); }
};
ACTIONS.refAddMin = async () => {
  const m = liveOf(S.nav.mid); if (!m || m.status !== 'live') return;
  await patchLive(m.id, { durationSec: (m.durationSec || 900) + 60, timeUp: false });
};
ACTIONS.refPens = async () => {
  const m = liveOf(S.nav.mid); if (!m) return;
  await patchLive(m.id, { pens: m.pens ? null : { a: 0, b: 0 } });
};
ACTIONS.refPen = async el => {
  const m = liveOf(S.nav.mid); if (!m || !m.pens) return;
  const k = el.dataset.k; await patchLive(m.id, { pens: { ...m.pens, [k]: Math.max(0, m.pens[k] + +el.dataset.d) } });
};
ACTIONS.refEnd = () => confirmBox(t('end_match_q'), async () => {
  const m = liveOf(S.nav.mid); if (!m) return;
  const b = F.writeBatch(db);
  b.update(gref('matches', m.id), { status: 'done', running: false, elapsedMs: elapsedOf(m), lastStart: 0, pens: m.scoreA === m.scoreB ? (m.pens || null) : null, endedAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
  addAudit(b, 'match_end', `#${m.no} ${m.teamA.name} ${m.scoreA}-${m.scoreB} ${m.teamB.name}`);
  await b.commit(); S.stats = null;
  S.go({ view: 'session', gid: S.gid, sid: S.sid }, true);
});
ACTIONS.refAbort = () => confirmBox(t('abort_match_q'), async () => {
  const m = liveOf(S.nav.mid); if (!m) return;
  const b = F.writeBatch(db);
  b.delete(gref('matches', m.id)); addAudit(b, 'match_abort', `#${m.no}`);
  await b.commit(); S.go({ view: 'session', gid: S.gid, sid: S.sid }, true);
}, true);
ACTIONS.refDelEv = el => confirmBox(t('delete_event_q'), async () => {
  const m = liveOf(S.nav.mid); if (!m) return;
  await pushEvents(m, ev => ev.filter(e => e.id !== el.dataset.id));
}, true);

// ---- event sheets ----
ACTIONS.refEv = el => {
  const m = liveOf(S.nav.mid); if (!m || m.status !== 'live') return;
  R = { team: el.dataset.team, type: el.dataset.type, og: false, penalty: false, step: 'pick', scorer: '' };
  openModal(refEvHtml);
};
function refEvHtml() {
  const m = liveOf(S.nav.mid), tm = R.team === 'A' ? m.teamA : m.teamB, op = R.team === 'A' ? m.teamB : m.teamA;
  const yc = id => (m.events || []).filter(e => e.type === 'yellow' && e.uid === id).length;
  const btn = (id, extra = '') => `<button class="btn block" style="width:100%;margin:6px 0;justify-content:space-between" data-act="refPick" data-id="${esc(id)}"><span>${esc(m.names?.[id] || '-')}</span>${extra}</button>`;
  let body;
  if (R.type === 'goal' && R.step === 'assist') {
    body = `<h2>${t('pick_assist')}</h2>${tm.players.filter(id => id !== R.scorer).map(id => btn(id)).join('')}
      <button class="btn block" style="width:100%;margin:6px 0" data-act="refNoAssist">${t('no_assist')}</button>`;
  } else if (R.type === 'goal') {
    body = `<h2>${t('goal_btn')} - ${t('team')} ${esc(tm.name)}</h2>
      <div class="row" style="margin-top:0"><button class="btn ${R.penalty ? 'primary' : ''}" data-act="refTog" data-k="penalty">${t('penalty')}</button>
      <button class="btn ${R.og ? 'primary' : ''}" data-act="refTog" data-k="og">${t('own_goal')}</button></div>
      <h3 style="margin:12px 0 4px">${t('pick_scorer')}${R.og ? ` (${t('team')} ${esc(op.name)})` : ''}</h3>${(R.og ? op : tm).players.map(id => btn(id)).join('')}`;
  } else {
    const title = { yellow: t('yellow_btn'), red: t('red_btn'), save: t('save_btn') }[R.type];
    body = `<h2>${title} - ${t('team')} ${esc(tm.name)}</h2>${tm.players.map(id => btn(id, R.type === 'yellow' && yc(id) ? `<span class="tag gold">${t('yellow_btn')} x${yc(id)}</span>` : '')).join('')}`;
  }
  return body + `<div class="row"><button class="btn" data-act="closeModal">${t('cancel')}</button></div>`;
}
ACTIONS.refTog = el => { const k = el.dataset.k; R[k] = !R[k]; if (k === 'og' && R.og) R.penalty = false; if (k === 'penalty' && R.penalty) R.og = false; redraw(); };
async function commitEv(extra) {
  const m = liveOf(S.nav.mid); if (!m) return;
  const t0 = Math.floor(elapsedOf(m) / 1000);
  const add = [{ id: evId(), type: R.type, team: R.team, t: t0, uid: '', assist: '', penalty: false, og: false, ...extra }];
  if (R.type === 'yellow' && (m.events || []).some(e => e.type === 'yellow' && e.uid === extra.uid)) add.push({ id: evId(), type: 'red', team: R.team, t: t0, uid: extra.uid, second: true });
  await pushEvents(m, ev => [...ev, ...add]);
  closeModal(); try { navigator.vibrate && navigator.vibrate(60); } catch (e) {}
}
ACTIONS.refPick = async el => {
  const id = el.dataset.id;
  if (R.type === 'goal') {
    if (R.step === 'assist') return commitEv({ uid: R.scorer, assist: id, penalty: R.penalty, og: R.og });
    R.scorer = id;
    if (R.og || R.penalty) return commitEv({ uid: id, penalty: R.penalty, og: R.og });
    R.step = 'assist'; redraw(); return;
  }
  return commitEv({ uid: id });
};
ACTIONS.refNoAssist = () => commitEv({ uid: R.scorer, assist: '', penalty: R.penalty, og: R.og });
