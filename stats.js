import { S, F, ACTIONS, CHANGES, POS, tierCount, t, esc, av, tl, nameOf, db, gref, addAudit, val, toast, money, sgn, fmtNum, dt, dShort, tsMs, bar, spinner, icon, isAdmin, gcol, openModal, closeModal, balanceOf, feat } from './core.js';
import { memberAdmin } from './admin.js';

// ---------- loading & computing ----------
export async function loadStats(force = false) {
  if (S.statsLoading) return;
  if (S.stats && !force && Date.now() - S.stats.at < 60000) return;
  S.statsLoading = true;
  try {
    const q = F.query(gcol('matches'), F.orderBy('date', 'desc'), F.limit(500));
    const snap = await F.getDocs(q);
    const matches = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.status !== 'live');
    S.stats = { at: Date.now(), matches, per: compute(matches) };
  } finally { S.statsLoading = false; S.render(); }
}

function blank() { return { cs: 0, conc: 0, apps: 0, goals: 0, assists: 0, saves: 0, pens: 0, wins: 0, draws: 0, losses: 0, hat: 0, yellow: 0, red: 0, log: [] }; }

// فترات تواجد كل لاعب في الملعب (للأهداف المستقبلة لما يكون فيه تغييرات)
function pitchIntervals(m, subs) {
  const L = { A: [...(m.teamA?.players || [])], B: [...(m.teamB?.players || [])] };
  for (const e of [...subs].reverse()) {
    L[e.team] = L[e.team].map(x => (x === e.in ? e.out : x));
    if (e.from) L[e.from] = [...L[e.from], e.in];
  }
  const iv = {}, open = {};
  const start = (id, team, tm) => { const o = { team, from: tm, to: Infinity }; (iv[id] ||= []).push(o); open[id] = o; };
  const stop = (id, tm) => { if (open[id]) { open[id].to = tm; delete open[id]; } };
  ['A', 'B'].forEach(k => L[k].forEach(id => start(id, k, 0)));
  for (const e of subs) { const tm = e.t || 0; stop(e.out, tm); if (e.from) stop(e.in, tm); start(e.in, e.team, tm); }
  return iv;
}
export function compute(matches) {
  const per = {};
  const P = id => (per[id] ||= blank());
  for (const m of matches) {
    const inA = new Set(m.teamA?.all || m.teamA?.players || []), inB = new Set(m.teamB?.all || m.teamB?.players || []);
    const curA = new Set(m.teamA?.players || []), curB = new Set(m.teamB?.players || []);
    let ivCache = null;
    for (const id of m.players || []) {
      const p = P(id); p.apps++;
      const both = inA.has(id) && inB.has(id), a = both ? curA.has(id) : inA.has(id), b = both ? curB.has(id) : inB.has(id);
      const side = a ? 'A' : (b ? 'B' : '');
      if (side) {
        const against = side === 'A' ? m.scoreB : m.scoreA;
        if (against === 0) p.cs++;
        const subs = (m.events || []).filter(e => e.type === 'sub').sort((x, y) => (x.t || 0) - (y.t || 0));
        if (!subs.length || !(m.events || []).some(e => e.type === 'goal')) p.conc += against;
        else {
          const iv = (ivCache ||= pitchIntervals(m, subs))[id] || [];
          p.conc += (m.events || []).filter(e => e.type === 'goal' && iv.some(x => x.team !== e.team && (e.t || 0) >= x.from && (e.t || 0) < x.to)).length;
        }
      }
      const mine = a ? m.scoreA - m.scoreB : (b ? m.scoreB - m.scoreA : 0);
      if (mine > 0) p.wins++; else if (mine < 0) p.losses++; else p.draws++;
    }
    const inMatch = {};
    for (const g of m.goals || []) {
      if (g.uid && !g.og) {
        const p = P(g.uid); p.goals++; if (g.penalty) p.pens++;
        inMatch[g.uid] = (inMatch[g.uid] || 0) + 1;
        p.log.push({ m, g, kind: 'goal' });
      }
      if (g.assist) { const p = P(g.assist); p.assists++; p.log.push({ m, g, kind: 'assist' }); }
    }
    for (const e of m.events || []) { if (e.type === 'yellow' && e.uid) P(e.uid).yellow++; if (e.type === 'red' && e.uid) P(e.uid).red++; }
    for (const id in inMatch) if (inMatch[id] >= 3) P(id).hat++;
    for (const id in (m.saves || {})) P(id).saves += m.saves[id] || 0;
  }
  return per;
}

export const isDef = id => ['gk', 'def'].includes(S.pos[id]);
export function ranking(per, key) {
  return Object.entries(per).filter(([id, v]) => v[key] > 0 && (key !== 'cs' || isDef(id))).sort((a, b) => b[1][key] - a[1][key] || b[1].apps - a[1].apps);
}

const ACH = [
  ['firstGoal', 'target', p => p.goals >= 1],
  ['goals10', 'target', p => p.goals >= 10],
  ['goals25', 'flame', p => p.goals >= 25],
  ['goals50', 'crown', p => p.goals >= 50],
  ['hat', 'star', p => p.hat >= 1],
  ['pen', 'target', p => p.pens >= 1],
  ['firstAssist', 'arrow', p => p.assists >= 1],
  ['assists10', 'arrow', p => p.assists >= 10],
  ['assists25', 'star', p => p.assists >= 25],
  ['saves10', 'shield', p => p.saves >= 10],
  ['saves25', 'shield', p => p.saves >= 25],
  ['apps10', 'calendar', p => p.apps >= 10],
  ['apps25', 'calendar', p => p.apps >= 25],
  ['apps50', 'trophy', p => p.apps >= 50]
];
export function achievements(uid, per) {
  const p = per[uid] || blank();
  const list = ACH.map(([id, ic, f]) => ({ id, ic, on: f(p) }));
  const top = (key, id, ic) => {
    const r = ranking(per, key).slice(0, 3).map(x => x[0]);
    list.push({ id, ic, on: r.includes(uid) });
  };
  if (isDef(uid)) { list.push({ id: 'cs1', ic: 'shield', on: p.cs >= 1 }, { id: 'cs5', ic: 'shield', on: p.cs >= 5 }, { id: 'cs10', ic: 'trophy', on: p.cs >= 10 }); top('cs', 'top3cs', 'award'); }
  top('goals', 'top3goals', 'award'); top('assists', 'top3assists', 'award'); top('saves', 'top3saves', 'award');
  return list;
}

// ---------- match detail (read-only) ----------
function findMatch(id) {
  return S.smatches.find(m => m.id === id) || S.stats?.matches.find(m => m.id === id);
}
export function matchModal(id) {
  const m = findMatch(id); if (!m) return;
  const nm = x => esc(S.members[x]?.name || S.guests[x]?.name || m.names?.[x] || '—');
  const team = (tm) => `<div class="tile"><b>${t('team')} ${tl(tm)}</b>${(tm.all || tm.players || []).map(x => `<div class="small">${nm(x)}</div>`).join('') || '<span class="mute small">—</span>'}</div>`;
  openModal(() => `
    <h2>${t('match')} ${m.no || ''} · ${dShort(m.date)}</h2>
    <div class="card" style="margin:8px 0;text-align:center">
      <div class="big" dir="ltr">${m.scoreA} - ${m.scoreB}</div>
      <div class="mute small">${t('team')} ${tl(m.teamA)} · ${t('team')} ${tl(m.teamB)}</div>
      ${m.pens ? `<div class="tag gold" dir="ltr">${t('pens')}: ${m.pens.a} - ${m.pens.b}</div>` : ''}
    </div>
    <div class="grid2">${team(m.teamA || {})}${team(m.teamB || {})}</div>
    ${(m.events || []).length ? `<h3 style="margin:14px 0 4px">${t('events')}</h3>` + [...m.events].sort((a, b) => (a.t || 0) - (b.t || 0)).map(e => eventLine(m, e)).join('') : ''}
    ${!(m.events || []).length && (m.goals || []).length ? `<h3 style="margin:14px 0 4px">${t('goals')}</h3>` + m.goals.map(g => `
      <div class="li"><div><b>${nm(g.uid)}</b>${g.og ? ` <span class="tag warn">${t('own_goal')}</span>` : ''}${g.penalty ? ` <span class="tag gold">${t('penalty')}</span>` : ''}
      ${g.assist ? `<div class="mute small">${t('assist_by')}: ${nm(g.assist)}</div>` : ''}</div><span class="tag">${t('team')} ${tl(g.team === 'A' ? m.teamA : m.teamB)}</span></div>`).join('') : ''}
    ${!(m.events || []).length && Object.keys(m.saves || {}).length ? `<h3 style="margin:14px 0 4px">${t('saves')}</h3>` + Object.entries(m.saves).map(([id, n]) => `<div class="li"><div>${nm(id)}</div><b>${n}</b></div>`).join('') : ''}
    <div class="row">${isAdmin() ? `<button class="btn primary" data-act="editMatch" data-id="${esc(m.id)}">${t('edit')}</button>` : ''}<button class="btn" data-act="closeModal">${t('close')}</button></div>`);
}
ACTIONS.openMatch = el => {
  const m = findMatch(el.dataset.id);
  if (m && m.status === 'live') S.go({ view: 'referee', gid: S.gid, sid: m.sid, mid: m.id });
  else matchModal(el.dataset.id);
};
export function eventLine(m, e, del = false) {
  const nm = id => esc(S.members[id]?.name || S.guests[id]?.name || m.names?.[id] || '-');
  const tn = tl(e.team === 'A' ? m.teamA : m.teamB);
  let body = '';
  if (e.type === 'goal') body = `<b>${nm(e.uid)}</b>${e.og ? ` <span class="tag warn">${t('own_goal')}</span>` : ''}${e.penalty ? ` <span class="tag gold">${t('penalty')}</span>` : ''}${e.assist ? `<div class="mute small">${t('assist_by')}: ${nm(e.assist)}</div>` : ''}`;
  else if (e.type === 'yellow') body = `<span class="cd cy"></span> <b>${nm(e.uid)}</b>`;
  else if (e.type === 'red') body = `<span class="cd cr"></span> <b>${nm(e.uid)}</b>${e.second ? ` <span class="tag">${t('second_yellow')}</span>` : ''}`;
  else if (e.type === 'sub') body = `${icon('swap')} <b>${nm(e.in)}</b><div class="mute small">${t('sub_out')}: ${nm(e.out)}</div>`;
  else body = `<b>${nm(e.uid)}</b> <span class="tag">${t('save_word')}</span>`;
  return `<div class="li"><b dir="ltr" style="width:40px">${Math.floor((e.t || 0) / 60) + 1}'</b><div>${body}</div><span class="tag">${t('team')} ${tn}</span>${del && e.type !== 'sub' ? `<button class="btn sm danger" data-act="refDelEv" data-id="${esc(e.id)}">${icon('x')}</button>` : ''}</div>`;
}

// ---------- rank tab ----------
export function statsTab() {
  if (!S.stats) { loadStats(); return spinner(); }
  const keys = ['goals', 'assists', 'saves', 'cs', 'apps'];
  const per = S.stats.per;
  const r = ranking(per, S.rtab);
  return `<div class="seg">${keys.map(k => `<button class="${S.rtab === k ? 'on' : ''}" data-act="rtab" data-k="${k}">${t('rk_' + k)}</button>`).join('')}</div>
  <div class="card">${r.length ? r.map(([id, v], i) => `
    <div class="li" data-act="openMember" data-uid="${esc(id)}" style="cursor:pointer">
      <span class="rk r${i + 1}">${i + 1}</span>${av(nameFor(id), S.members[id]?.photo)}
      <div><b>${esc(nameFor(id))}</b></div><span class="amt">${fmtNum(v[S.rtab])}</span></div>`).join('') : `<div class="empty">${t('no_stats')}</div>`}</div>`;
}
function nameFor(id) {
  const n = nameOf(id); if (n !== '—') return n;
  for (const m of S.stats?.matches || []) if (m.names?.[id]) return m.names[id];
  return '—';
}
ACTIONS.rtab = el => { S.rtab = el.dataset.k; S.render(); };
ACTIONS.openMember = el => S.go({ view: 'member', gid: S.gid, uid: el.dataset.uid });

// ---------- member profile body ----------
function infoChips(uid, m) {
  const mine = uid === S.user.uid, src = mine ? S.profile : (m.pub || {});
  const parts = [];
  if (src.birthYear) parts.push(`${t('age')}: ${new Date().getFullYear() - src.birthYear}`);
  if (src.height) parts.push(`${t('height_cm')}: ${fmtNum(src.height)}`);
  if (src.weight) parts.push(`${t('weight_kg')}: ${fmtNum(src.weight)}`);
  if (!parts.length) return mine ? `<div class="mute small" style="margin-top:8px">${t('no_info_shared')}</div>` : '';
  return `<div style="margin-top:10px">${parts.map(p => `<span class="tag" style="margin:2px">${esc(p)}</span>`).join('')}</div>`;
}
export function memberBody(uid) {
  if (!S.stats) { loadStats(); return spinner(); }
  const real = S.members[uid], isGuest = !real;
  const m = real || { name: nameFor(uid), photo: '', role: 'guest' };
  if (isGuest && m.name === '—' && !S.guests[uid] && !S.stats.per[uid]) return `<div class="empty">—</div>`;
  const p = S.stats.per[uid] || blank();
  const priv = !isGuest && (uid === S.user.uid || isAdmin());
  const gHist = isGuest && isAdmin() ? S.ledger.filter(l => l.guest === uid && l.type === 'guest').sort((a, b) => tsMs(b.at) - tsMs(a.at)).slice(0, 40) : [];
  const ach = achievements(uid, S.stats.per);
  const hist = priv ? S.ledger.filter(l => l.uid === uid).sort((a, b) => tsMs(b.at) - tsMs(a.at)).slice(0, 40) : [];
  const bal = balanceOf(uid);
  const gHtml = gHist.length ? `<div class="card"><h3 style="margin:0 0 4px">${t('history')}</h3>${gHist.map(l => `
      <div class="li"><div><b>${t('lt_guest')}</b><div class="mute small">${dt(tsMs(l.at), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${l.reversed ? ' · ' + t('reversed') : ''}</div></div>
      <span class="amt pos" dir="ltr">${sgn(l.fund)}</span></div>`).join('')}</div>` : '';
  return `
  <div class="card" style="text-align:center">${av(m.name, m.photo, 'lg')}
    <h2 style="margin-top:8px">${esc(m.name)}</h2>
    <span class="tag ${isGuest ? 'gold' : ''}">${t('role_' + m.role)}</span>${S.pos[uid] ? ` <span class="tag">${t('pos_' + S.pos[uid])}</span>` : ''}
    ${isGuest ? '' : infoChips(uid, m)}</div>
  ${gHtml}
  ${priv ? `<div class="card"><div class="mute small">${t('balance')}</div>
    <div class="big ${bal < 0 ? 'neg' : 'pos'}" dir="ltr">${fmtNum(bal)} <span class="small">${esc(S.g?.currency || '')}</span></div>
    ${hist.length ? `<h3 style="margin:14px 0 4px">${t('history')}</h3>` + hist.map(l => `
      <div class="li"><div><b>${t('lt_' + l.type)}</b><div class="mute small">${dt(tsMs(l.at), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${l.note ? ' · ' + esc(l.note) : ''}${l.reversed ? ' · ' + t('reversed') : ''}</div></div>
      <span class="amt ${l.amount < 0 ? 'neg' : 'pos'}" dir="ltr">${sgn(l.amount)}</span></div>`).join('') : `<div class="mute small" style="margin-top:8px">${t('no_history')}</div>`}</div>` : ''}
  <div class="tiles">
    <div class="tile"><span class="mute small">${t('rk_apps')}</span><b>${p.apps}</b></div>
    <div class="tile"><span class="mute small">${t('rk_goals')}</span><b>${p.goals}</b></div>
    <div class="tile"><span class="mute small">${t('rk_assists')}</span><b>${p.assists}</b></div>
    <div class="tile"><span class="mute small">${t('rk_saves')}</span><b>${p.saves}</b></div>
    <div class="tile"><span class="mute small">${t('wins')}</span><b>${p.wins}</b></div>
    <div class="tile"><span class="mute small">${t('hat_tricks')}</span><b>${p.hat}</b></div>
    <div class="tile"><span class="mute small">${t('yellow_cards')}</span><b>${p.yellow}</b></div>
    <div class="tile"><span class="mute small">${t('red_cards')}</span><b>${p.red}</b></div>
    ${isDef(uid) ? `<div class="tile"><span class="mute small">${t('clean_sheets')}</span><b>${p.cs}</b></div>` : ''}
    ${S.pos[uid] === 'gk' ? `<div class="tile"><span class="mute small">${t('conceded')}</span><b>${p.conc}</b></div>` : ''}
  </div>
  <h3>${t('achievements')}</h3>
  <div class="card"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px">
    ${ach.map(a => `<div style="text-align:center;opacity:${a.on ? 1 : .55}">
      <div class="badge ${a.on ? 'on' : ''}">${icon(a.ic)}</div><b class="small">${t('ach_' + a.id)}</b><div class="mute small">${t('ach_' + a.id + '_d')}</div></div>`).join('')}
  </div></div>
  ${feat('scorers') ? `<h3>${t('goal_log')}</h3><div class="card">${p.log.length ? p.log.slice(0, 60).map(x => `
    <div class="li" data-act="openMatch" data-id="${esc(x.m.id)}" style="cursor:pointer">
      <div><span class="tag">${x.kind === 'goal' ? t('tag_goal') : t('tag_assist')}</span> <b>${dShort(x.m.date)}</b>
      ${x.g.penalty ? `<span class="tag gold">${t('penalty')}</span>` : ''}
      <div class="mute small" dir="ltr">${x.m.scoreA} - ${x.m.scoreB}</div></div><span class="mute">›</span></div>`).join('') : `<div class="empty">${t('no_goals')}</div>`}</div>` : ''}
  ${rosterAdmin(uid)}
  ${isGuest ? guestAdmin(uid) : memberAdmin(uid)}`;
}

function rosterAdmin(uid) {
  if (!isAdmin()) return '';
  const n = tierCount();
  return `<h3>${t('roster_admin')}</h3><div class="card"><div class="grid2">
    <div><label style="margin-top:0">${t('position')}</label><select data-chg="setPos" data-uid="${esc(uid)}"><option value="">${t('pos_none')}</option>${POS.map(p => `<option value="${p}" ${S.pos[uid] === p ? 'selected' : ''}>${t('pos_' + p)}</option>`).join('')}</select></div>
    <div><label style="margin-top:0">${t('tier_label')}</label><select data-chg="setTier" data-uid="${esc(uid)}"><option value="">${t('tier_none')}</option>${Array.from({ length: n }, (_, i) => `<option value="${i + 1}" ${S.tiers[uid] === i + 1 ? 'selected' : ''}>${t('tier_n', { n: i + 1 })}</option>`).join('')}</select></div></div>
    <div class="mute small" style="margin-top:8px">${t('pos_hint')} ${t('tier_hint')}</div></div>`;
}
CHANGES.setPos = async el => {
  const id = el.dataset.uid, v = el.value;
  if (v) await F.setDoc(gref('pos', id), { pos: v }); else await F.deleteDoc(gref('pos', id));
  toast(t('saved'));
};
CHANGES.setTier = async el => {
  const id = el.dataset.uid, v = +el.value;
  if (v) await F.setDoc(gref('tiers', id), { tier: v }); else await F.deleteDoc(gref('tiers', id));
  toast(t('saved'));
};
function guestAdmin(uid) {
  if (!isAdmin()) return '';
  return `<h3>${t('admin_actions')}</h3><div class="card"><div class="row" style="margin-top:0"><button class="btn" data-act="renameGuest" data-uid="${esc(uid)}">${t('rename_guest')}</button></div></div>`;
}
ACTIONS.renameGuest = el => {
  const uid = el.dataset.uid;
  openModal(() => `<h2>${t('rename_guest')}</h2><label>${t('guest_name')}</label><input id="rg_name" maxlength="40" value="${esc(nameFor(uid))}">
    <div class="row"><button class="btn primary" data-act="renameGuestSave" data-uid="${esc(uid)}">${t('save')}</button><button class="btn" data-act="closeModal">${t('cancel')}</button></div>`);
};
ACTIONS.renameGuestSave = async el => {
  const uid = el.dataset.uid, name = val('rg_name').trim(); if (!name) { toast(t('name_required')); return; }
  const b = F.writeBatch(db);
  b.set(gref('guests', uid), { name, createdAt: F.serverTimestamp() }, { merge: true });
  addAudit(b, 'guest_rename', `${nameFor(uid)} > ${name}`);
  await b.commit(); closeModal(); toast(t('saved'));
};

export function memberView(uid) {
  const m = S.members[uid];
  return bar(m?.name || nameFor(uid), true) + `<div style="padding-bottom:12px">${memberBody(uid)}</div>`;
}
