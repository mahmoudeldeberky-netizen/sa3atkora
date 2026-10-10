import { S, F, db, ACTIONS, CHANGES, t, esc, av, val, num, checked, money, fmtNum, sgn, dt, tsMs, toast, openModal, closeModal, confirmBox, numIn,
  isAdmin, isOwner, canGrant, gref, gcol, addAudit, addLedger, bumpFund, balanceOf, download, csvRow, spinner, genCode, feat } from './core.js';

const dowOpts = sel => [0, 1, 2, 3, 4, 5, 6].map(d => `<option value="${d}" ${+sel === d ? 'selected' : ''}>${t('dow' + d)}</option>`).join('');
const activeMembers = () => Object.values(S.members).filter(m => m.status === 'active').sort((a, b) => a.name.localeCompare(b.name));

// =============== group tab ===============
export function groupTab() {
  const g = S.g, fund = g.fund || 0, adm = isAdmin();
  const pending = Object.values(S.members).filter(m => m.status === 'pending');
  let h = `<div class="card"><div class="mute small">${t('fund')}</div>
    <div class="big ${fund < 0 ? 'neg' : 'pos'}" dir="ltr">${fmtNum(fund)} <span class="small">${esc(g.currency || '')}</span></div>
    <div class="mute small">${t('fund_hint')}</div></div>`;
  if (adm && pending.length) {
    h += `<h3>${t('pending_req')} (${pending.length})</h3><div class="card">${pending.map(m => `
      <div class="li">${av(m.name, m.photo)}<div><b>${esc(m.name)}</b></div>
      <button class="btn primary sm" data-act="approve" data-uid="${esc(m.uid)}">${t('approve')}</button>
      <button class="btn danger sm" data-act="reject" data-uid="${esc(m.uid)}">${t('reject')}</button></div>`).join('')}</div>`;
  }
  if (adm) {
    const tabs = ['members', 'accounts', 'reports', 'audit', 'settings'];
    h += `<div class="seg">${tabs.map(k => `<button class="${S.gtab === k ? 'on' : ''}" data-act="gtab" data-k="${k}">${t('gt_' + k)}</button>`).join('')}</div>`;
  }
  const tab = adm ? S.gtab : 'members';
  if (tab === 'members') h += membersList();
  else if (tab === 'accounts') h += accountsView();
  else if (tab === 'reports') h += reportsView();
  else if (tab === 'audit') h += auditView();
  else if (tab === 'settings') h += settingsView();
  return h;
}

ACTIONS.gtab = el => {
  S.gtab = el.dataset.k;
  if (S.gtab === 'audit') loadAudit();
  S.render();
};

function membersList() {
  const adm = isAdmin();
  const list = activeMembers();
  let h = `<h3>${t('members')} (${list.length})</h3><div class="card">${list.map(m => {
    const b = balanceOf(m.uid);
    return `<div class="li" data-act="openMember" data-uid="${esc(m.uid)}" style="cursor:pointer">${av(m.name, m.photo)}
      <div><b>${esc(m.name)}</b> ${m.role !== 'player' ? `<span class="tag">${t('role_' + m.role)}</span>` : ''}</div>
      ${adm ? `<span class="amt ${b < 0 ? 'neg' : 'pos'}" dir="ltr">${fmtNum(b)}</span>` : ''}<span class="mute">›</span></div>`;
  }).join('')}</div>`;
  const gl = Object.values(S.guests).sort((x, y) => x.name.localeCompare(y.name));
  if (gl.length) h += `<h3>${t('guests')} (${gl.length})</h3><div class="card">${gl.map(g => `<div class="li" data-act="openMember" data-uid="${esc(g.id)}" style="cursor:pointer">${av(g.name, '')}
      <div><b>${esc(g.name)}</b> <span class="tag gold">${t('role_guest')}</span></div><span class="mute">›</span></div>`).join('')}</div>`;
  if (adm) {
    const code = S.g.inviteCode || '';
    h += `<h3>${t('invite')}</h3><div class="card"><div class="invite" dir="ltr">${esc(code)}</div>
      <div class="mute small">${t('invite_hint')}</div>
      <div class="row"><button class="btn primary" data-act="shareInvite">${t('share_invite')}</button>
      <button class="btn" data-act="newCode">${t('new_code')}</button></div></div>`;
  }
  h += `<button class="btn danger block" data-act="leave">${t('leave_group')}</button>`;
  return h;
}

ACTIONS.shareInvite = async () => {
  const url = `${location.origin}${location.pathname}?join=${S.g.inviteCode}`;
  const text = t('invite_msg', { name: S.g.name, code: S.g.inviteCode });
  try { if (navigator.share) { await navigator.share({ title: t('app_name'), text, url }); return; } } catch (e) { return; }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast(t('copied')); } catch (e) { toast(url); }
};
ACTIONS.newCode = () => confirmBox(t('new_code_q'), async () => {
  const old = S.g.inviteCode, code = genCode(), b = F.writeBatch(db);
  b.set(F.doc(db, 'invites', code), { gid: S.gid, name: S.g.name, createdAt: F.serverTimestamp() });
  if (old) b.delete(F.doc(db, 'invites', old));
  b.update(gref(), { inviteCode: code });
  addAudit(b, 'new_invite_code', '');
  await b.commit(); toast(t('saved'));
});
ACTIONS.approve = async el => {
  const uid = el.dataset.uid, b = F.writeBatch(db);
  b.update(gref('members', uid), { status: 'active' });
  addAudit(b, 'approve_member', S.members[uid]?.name || uid);
  await b.commit(); toast(t('saved'));
};
ACTIONS.reject = el => confirmBox(t('reject_q'), async () => {
  const uid = el.dataset.uid, b = F.writeBatch(db);
  b.delete(gref('members', uid));
  b.delete(F.doc(db, 'users', uid, 'mygroups', S.gid));
  addAudit(b, 'reject_member', S.members[uid]?.name || uid);
  await b.commit();
}, true);
ACTIONS.leave = () => {
  if (isOwner()) { toast(t('owner_cannot_leave')); return; }
  confirmBox(t('leave_q'), async () => {
    const b = F.writeBatch(db), uid = S.user.uid;
    b.delete(gref('members', uid));
    b.delete(F.doc(db, 'users', uid, 'mygroups', S.gid));
    await b.commit();
    S.go({ view: 'groups' }, true);
  }, true);
};

// =============== member admin panel ===============
export function memberAdmin(uid) {
  if (!isAdmin() || uid === S.user.uid) return '';
  const m = S.members[uid]; if (!m || m.status !== 'active') return '';
  let b = `<button class="btn primary" data-act="payModal" data-uid="${esc(uid)}">${t('record_payment')}</button>
    <button class="btn" data-act="exportMember" data-uid="${esc(uid)}">${t('export_csv')}</button>`;
  if (m.role === 'player' && canGrant()) b += `<button class="btn" data-act="setRole" data-uid="${esc(uid)}" data-role="admin">${t('make_admin')}</button>`;
  if (m.role === 'admin' && canGrant()) b += `<button class="btn" data-act="setRole" data-uid="${esc(uid)}" data-role="player">${t('remove_admin')}</button>`;
  if (m.role === 'admin' && isOwner()) {
    b += `<button class="btn" data-act="toggleGrant" data-uid="${esc(uid)}">${m.canAddAdmins ? t('revoke_grant') : t('give_grant')}</button>
          <button class="btn" data-act="transfer" data-uid="${esc(uid)}">${t('transfer_owner')}</button>`;
  }
  if (m.role === 'player' || (m.role === 'admin' && isOwner())) b += `<button class="btn danger" data-act="removeMember" data-uid="${esc(uid)}">${t('remove_member')}</button>`;
  return `<h3>${t('admin_actions')}</h3><div class="card"><div class="row" style="margin-top:0">${b}</div></div>`;
}
ACTIONS.setRole = async el => {
  const uid = el.dataset.uid, role = el.dataset.role, b = F.writeBatch(db);
  b.update(gref('members', uid), { role });
  addAudit(b, role === 'admin' ? 'make_admin' : 'remove_admin', S.members[uid]?.name);
  await b.commit(); toast(t('saved'));
};
ACTIONS.toggleGrant = async el => {
  const uid = el.dataset.uid, b = F.writeBatch(db), v = !S.members[uid]?.canAddAdmins;
  b.update(gref('members', uid), { canAddAdmins: v });
  addAudit(b, v ? 'give_grant' : 'revoke_grant', S.members[uid]?.name);
  await b.commit(); toast(t('saved'));
};
ACTIONS.transfer = el => confirmBox(t('transfer_q', { name: S.members[el.dataset.uid]?.name }), async () => {
  const uid = el.dataset.uid, b = F.writeBatch(db);
  b.update(gref(), { ownerId: uid });
  b.update(gref('members', uid), { role: 'owner', canAddAdmins: true });
  b.update(gref('members', S.user.uid), { role: 'admin', canAddAdmins: true });
  addAudit(b, 'transfer_owner', S.members[uid]?.name);
  await b.commit(); toast(t('saved'));
}, true);
ACTIONS.removeMember = el => {
  const uid = el.dataset.uid, m = S.members[uid], bal = balanceOf(uid);
  confirmBox(t('remove_q', { name: m?.name, bal: fmtNum(bal) }), async () => {
    const b = F.writeBatch(db);
    b.delete(gref('members', uid));
    b.delete(F.doc(db, 'users', uid, 'mygroups', S.gid));
    addAudit(b, 'remove_member', `${m?.name} (${fmtNum(bal)})`);
    await b.commit(); history.back();
  }, true);
};

// =============== accounts ===============
function accountsView() {
  const bals = Object.values(S.balances);
  const credit = bals.filter(b => b.balance > 0).reduce((s, b) => s + b.balance, 0);
  const debt = bals.filter(b => b.balance < 0).reduce((s, b) => s + b.balance, 0);
  const led = [...S.ledger].sort((a, b) => tsMs(b.at) - tsMs(a.at));
  return `<div class="tiles"><div class="tile"><span class="mute small">${t('total_credit')}</span><b class="pos" dir="ltr">${fmtNum(credit)}</b></div>
    <div class="tile"><span class="mute small">${t('total_debt')}</span><b class="neg" dir="ltr">${fmtNum(debt)}</b></div></div>
    <div class="row" style="margin:12px 16px"><button class="btn primary" data-act="payModal">${t('new_entry')}</button></div>
    <h3>${t('ledger')}</h3><div class="card">${led.length ? led.map(l => {
      const who = l.uid ? (S.members[l.uid]?.name || '—') : (l.name || '');
      return `<div class="li"><div><b>${t('lt_' + l.type)}</b> ${l.reversed ? `<span class="tag warn">${t('reversed')}</span>` : ''}
        <div class="mute small">${esc(who)} · ${dt(tsMs(l.at), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${l.note ? ' · ' + esc(l.note) : ''}</div>
        <div class="mute small">${esc(l.byName || '')}</div></div>
        <div style="text-align:end"><div class="amt ${l.amount < 0 ? 'neg' : (l.amount > 0 ? 'pos' : '')}" dir="ltr">${l.amount ? sgn(l.amount) : ''}</div>
        ${l.fund ? `<div class="mute small" dir="ltr">${t('fund')}: ${sgn(l.fund)}</div>` : ''}
        ${!l.reversed && l.type !== 'reversal' ? `<button class="btn sm" data-act="reverse" data-id="${esc(l.id)}">${t('reverse')}</button>` : ''}</div></div>`;
    }).join('') : `<div class="empty">${t('no_history')}</div>`}</div>`;
}

ACTIONS.payModal = el => {
  const pre = el?.dataset?.uid || '';
  openModal(() => `<h2>${t('new_entry')}</h2>
    <label>${t('entry_type')}</label>
    <select id="pm_type" data-chg="pmType"><option value="payment">${t('lt_payment')}</option><option value="expense">${t('lt_expense')}</option><option value="adjust">${t('lt_adjust')}</option></select>
    <div id="pm_uid_wrap"><label>${t('member')}</label>
    <select id="pm_uid">${activeMembers().map(m => `<option value="${esc(m.uid)}" ${m.uid === pre ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
    <label>${t('amount')} (${esc(S.g.currency || '')})</label>${numIn('pm_amt')}
    <div class="mute small" id="pm_hint">${t('pm_hint_payment')}</div>
    <label>${t('note')}</label><input id="pm_note" maxlength="120">
    <div class="row"><button class="btn primary" data-act="savePay">${t('save')}</button><button class="btn" data-act="closeModal">${t('cancel')}</button></div>`);
};
CHANGES.pmType = el => {
  document.getElementById('pm_uid_wrap').style.display = el.value === 'expense' ? 'none' : '';
  document.getElementById('pm_hint').textContent = t('pm_hint_' + el.value);
};
ACTIONS.savePay = async () => {
  const type = val('pm_type'), amt = num(val('pm_amt')), note = val('pm_note').trim(), uid = val('pm_uid');
  if (!amt || (type !== 'adjust' && amt < 0)) { toast(t('bad_amount')); return; }
  const b = F.writeBatch(db); let fund = 0;
  const nm = S.members[uid]?.name || '';
  if (type === 'payment') fund = addLedger(b, { type, uid, amount: amt, fund: amt, note });
  else if (type === 'expense') fund = addLedger(b, { type, fund: -amt, note });
  else fund = addLedger(b, { type, uid, amount: amt, note });
  bumpFund(b, fund);
  addAudit(b, 'ledger_' + type, `${type === 'expense' ? '' : nm + ' '}${fmtNum(amt)}${note ? ' · ' + note : ''}`);
  await b.commit(); closeModal(); toast(t('saved'));
};
ACTIONS.reverse = el => {
  const o = S.ledger.find(x => x.id === el.dataset.id); if (!o) return;
  confirmBox(t('reverse_q'), async () => {
    const b = F.writeBatch(db);
    const f = addLedger(b, { type: 'reversal', uid: o.uid, name: o.name, amount: -(o.amount || 0), fund: -(o.fund || 0), ref: o.id, sid: o.sid, note: o.note });
    b.update(gref('ledger', o.id), { reversed: true });
    bumpFund(b, f);
    addAudit(b, 'reverse', `${t('lt_' + o.type)} ${o.uid ? (S.members[o.uid]?.name || '') : (o.name || '')} ${fmtNum(o.amount || o.fund)}`);
    await b.commit(); toast(t('saved'));
  }, true);
};

function ledgerCsv(entries) {
  const rows = [csvRow([t('date'), t('entry_type'), t('member'), t('amount'), t('fund'), t('note'), t('by')])];
  entries.forEach(l => rows.push(csvRow([new Date(tsMs(l.at)).toISOString().slice(0, 16).replace('T', ' '), t('lt_' + l.type), l.uid ? (S.members[l.uid]?.name || '') : (l.name || ''), l.amount || 0, l.fund || 0, l.note || '', l.byName || ''])));
  return rows.join('\n');
}
ACTIONS.exportMember = el => {
  const uid = el.dataset.uid;
  download(`${S.members[uid]?.name || 'member'}.csv`, ledgerCsv(S.ledger.filter(l => l.uid === uid).sort((a, b) => tsMs(a.at) - tsMs(b.at))));
};

// =============== reports ===============
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function reportsView() {
  const mk = S.report?.month || monthKey(new Date());
  let h = `<div class="card"><label style="margin-top:0">${t('month')}</label>
    <input id="rp_month" type="month" dir="ltr" lang="en" value="${esc(mk)}">
    <div class="row"><button class="btn primary" data-act="runReport">${t('show_report')}</button></div></div>`;
  const r = S.report;
  if (r && r.loading) return h + spinner();
  if (r && r.rows) {
    const eff = r.rows.filter(l => !l.reversed && l.type !== 'reversal');
    const income = eff.filter(l => l.fund > 0).reduce((s, l) => s + l.fund, 0);
    const expense = eff.filter(l => l.fund < 0).reduce((s, l) => s + l.fund, 0);
    const charges = eff.filter(l => l.type === 'charge').reduce((s, l) => s - l.amount, 0);
    const net = r.rows.reduce((s, l) => s + (l.fund || 0), 0);
    const debtors = Object.values(S.balances).filter(b => b.balance < 0).sort((a, b) => a.balance - b.balance);
    h += `<div class="tiles">
      <div class="tile"><span class="mute small">${t('rp_income')}</span><b class="pos" dir="ltr">${fmtNum(income)}</b></div>
      <div class="tile"><span class="mute small">${t('rp_expense')}</span><b class="neg" dir="ltr">${fmtNum(expense)}</b></div>
      <div class="tile"><span class="mute small">${t('rp_net')}</span><b dir="ltr">${sgn(net)}</b></div>
      <div class="tile"><span class="mute small">${t('rp_charges')}</span><b dir="ltr">${fmtNum(charges)}</b></div></div>
      <h3>${t('debtors')}</h3><div class="card">${debtors.length ? debtors.map(b => `<div class="li"><div><b>${esc(S.members[b.uid]?.name || '—')}</b></div><span class="amt neg" dir="ltr">${fmtNum(b.balance)}</span></div>`).join('') : `<div class="empty">${t('no_debtors')}</div>`}</div>
      <button class="btn block" data-act="exportReport">${t('export_csv')}</button>`;
  }
  return h;
}
ACTIONS.runReport = async () => {
  const mk = val('rp_month') || monthKey(new Date());
  const [y, m] = mk.split('-').map(Number);
  S.report = { month: mk, loading: true }; S.render();
  const from = new Date(y, m - 1, 1), to = new Date(y, m, 1);
  const snap = await F.getDocs(F.query(gcol('ledger'), F.orderBy('at', 'desc'), F.limit(1500)));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(l => { const x = tsMs(l.at); return x >= from.getTime() && x < to.getTime(); });
  S.report = { month: mk, rows }; S.render();
};
ACTIONS.exportReport = () => {
  if (!S.report?.rows) return;
  download(`${S.g.name}-${S.report.month}.csv`, ledgerCsv([...S.report.rows].sort((a, b) => tsMs(a.at) - tsMs(b.at))));
};

// =============== audit ===============
export async function loadAudit() {
  S.audit = null; S.render();
  const snap = await F.getDocs(F.query(gcol('audit'), F.orderBy('at', 'desc'), F.limit(150)));
  S.audit = snap.docs.map(d => ({ id: d.id, ...d.data() })); S.render();
}
function auditView() {
  if (!S.audit) return spinner();
  return `<div class="card">${S.audit.length ? S.audit.map(a => `<div class="li"><div><b>${t('au_' + a.action)}</b>
    <div class="mute small">${esc(a.details || '')}</div>
    <div class="mute small">${esc(a.byName || '')} · ${dt(tsMs(a.at), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div></div></div>`).join('') : `<div class="empty">${t('no_history')}</div>`}</div>`;
}

// =============== settings ===============
function settingsView() {
  const g = S.g, sc = g.schedule || {};
  return `<div class="card">
    <label style="margin-top:0">${t('group_name')}</label><input id="st_name" value="${esc(g.name)}" maxlength="60">
    <div class="grid2"><div><label>${t('currency')}</label><input id="st_cur" value="${esc(g.currency || '')}" maxlength="8"></div>
    <div><label>${t('def_fee')}</label>${numIn('st_fee', g.defaultFee ?? 10)}</div></div>
    <div class="grid2"><div><label>${t('hour_cost')}</label>${numIn('st_cost', g.hourCost ?? 70)}</div>
    <div><label>${t('max_players')}</label>${numIn('st_max', g.maxPlayers ?? 18)}</div></div>
    <div class="grid2"><div><label>${t('cancel_hours')}</label>${numIn('st_cancel', g.cancelHours ?? 12)}</div>
    <div><label>${t('team_size')}</label>${numIn('st_team', g.teamSize ?? 6)}</div></div>
    <div class="grid2"><div><label>${t('match_minutes')}</label>${numIn('st_minutes', g.matchMinutes ?? 15)}</div>
    <div><label>${t('tier_count')}</label>${numIn('st_tiers', g.tierCount ?? 3)}</div></div>
    <div class="grid2"><div><label>${t('sched_day')}</label><select id="st_dow">${dowOpts(sc.dow ?? 4)}</select></div>
    <div><label>${t('sched_time')}</label><input id="st_time" type="time" dir="ltr" lang="en" value="${esc(sc.time || '21:00')}"></div></div>
    <div class="chk" style="margin-top:14px"><input type="checkbox" id="st_results" ${feat('results') ? 'checked' : ''}><label for="st_results">${t('feat_results')}</label></div>
    <div class="chk"><input type="checkbox" id="st_scorers" ${feat('scorers') ? 'checked' : ''}><label for="st_scorers">${t('feat_scorers')}</label></div>
    <div class="row"><button class="btn primary" data-act="saveSettings">${t('save')}</button></div></div>`;
}
ACTIONS.saveSettings = async () => {
  const name = val('st_name').trim(); if (!name) { toast(t('name_required')); return; }
  const data = {
    name, currency: val('st_cur').trim(), defaultFee: num(val('st_fee'), 10), hourCost: num(val('st_cost'), 70),
    maxPlayers: Math.max(1, Math.round(num(val('st_max'), 18))), cancelHours: Math.max(0, Math.round(num(val('st_cancel'), 12))),
    teamSize: Math.max(1, Math.round(num(val('st_team'), 6))), matchMinutes: Math.max(1, Math.round(num(val('st_minutes'), 15))), tierCount: Math.min(6, Math.max(2, Math.round(num(val('st_tiers'), 3)))),
    schedule: { dow: +val('st_dow'), time: val('st_time') || '21:00' },
    features: { results: checked('st_results'), scorers: checked('st_scorers') }
  };
  const b = F.writeBatch(db);
  b.update(gref(), data);
  addAudit(b, 'settings', name);
  await b.commit(); toast(t('saved'));
};
