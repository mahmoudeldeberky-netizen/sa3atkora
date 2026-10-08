import { S, F, ACTIONS, t, esc, av, money, sgn, fmtNum, dt, dShort, tsMs, bar, spinner, icon, isAdmin, gcol, openModal, closeModal, balanceOf, feat } from './core.js';
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

function blank() { return { apps: 0, goals: 0, assists: 0, saves: 0, pens: 0, wins: 0, draws: 0, losses: 0, hat: 0, yellow: 0, red: 0, log: [] }; }

export function compute(matches) {
  const per = {};
  const P = id => (per[id] ||= blank());
  for (const m of matches) {
    const inA = new Set(m.teamA?.players || []), inB = new Set(m.teamB?.players || []);
    for (const id of m.players || []) {
      const p = P(id); p.apps++;
      const mine = inA.has(id) ? m.scoreA - m.scoreB : (inB.has(id) ? m.scoreB - m.scoreA : 0);
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

export function ranking(per, key) {
  return Object.entries(per).filter(([, v]) => v[key] > 0).sort((a, b) => b[1][key] - a[1][key] || b[1].apps - a[1].apps);
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
  top('goals', 'top3goals', 'award'); top('assists', 'top3assists', 'award'); top('saves', 'top3saves', 'award');
  return list;
}

// ---------- match detail (read-only) ----------
function findMatch(id) {
  return S.smatches.find(m => m.id === id) || S.stats?.matches.find(m => m.id === id);
}
export function matchModal(id) {
  const m = findMatch(id); if (!m) return;
  const nm = x => esc(m.names?.[x] || S.members[x]?.name || '—');
  const team = (tm) => `<div class="tile"><b>${t('team')} ${esc(tm.name)}</b>${(tm.players || []).map(x => `<div class="small">${nm(x)}</div>`).join('') || '<span class="mute small">—</span>'}</div>`;
  openModal(() => `
    <h2>${t('match')} ${m.no || ''} · ${dShort(m.date)}</h2>
    <div class="card" style="margin:8px 0;text-align:center">
      <div class="big" dir="ltr">${m.scoreA} - ${m.scoreB}</div>
      <div class="mute small">${t('team')} ${esc(m.teamA?.name)} · ${t('team')} ${esc(m.teamB?.name)}</div>
      ${m.pens ? `<div class="tag gold" dir="ltr">${t('pens')}: ${m.pens.a} - ${m.pens.b}</div>` : ''}
    </div>
    <div class="grid2">${team(m.teamA || {})}${team(m.teamB || {})}</div>
    ${(m.events || []).length ? `<h3 style="margin:14px 0 4px">${t('events')}</h3>` + [...m.events].sort((a, b) => (a.t || 0) - (b.t || 0)).map(e => eventLine(m, e)).join('') : ''}
    ${!(m.events || []).length && (m.goals || []).length ? `<h3 style="margin:14px 0 4px">${t('goals')}</h3>` + m.goals.map(g => `
      <div class="li"><div><b>${nm(g.uid)}</b>${g.og ? ` <span class="tag warn">${t('own_goal')}</span>` : ''}${g.penalty ? ` <span class="tag gold">${t('penalty')}</span>` : ''}
      ${g.assist ? `<div class="mute small">${t('assist_by')}: ${nm(g.assist)}</div>` : ''}</div><span class="tag">${t('team')} ${esc(g.team === 'A' ? m.teamA?.name : m.teamB?.name)}</span></div>`).join('') : ''}
    ${!(m.events || []).length && Object.keys(m.saves || {}).length ? `<h3 style="margin:14px 0 4px">${t('saves')}</h3>` + Object.entries(m.saves).map(([id, n]) => `<div class="li"><div>${nm(id)}</div><b>${n}</b></div>`).join('') : ''}
    <div class="row">${isAdmin() ? `<button class="btn primary" data-act="editMatch" data-id="${esc(m.id)}">${t('edit')}</button>` : ''}<button class="btn" data-act="closeModal">${t('close')}</button></div>`);
}
ACTIONS.openMatch = el => {
  const m = findMatch(el.dataset.id);
  if (m && m.status === 'live') S.go({ view: 'referee', gid: S.gid, sid: m.sid, mid: m.id });
  else matchModal(el.dataset.id);
};
export function eventLine(m, e, del = false) {
  const nm = id => esc(m.names?.[id] || S.members[id]?.name || '-');
  const tn = e.team === 'A' ? m.teamA?.name : m.teamB?.name;
  let body = '';
  if (e.type === 'goal') body = `<b>${nm(e.uid)}</b>${e.og ? ` <span class="tag warn">${t('own_goal')}</span>` : ''}${e.penalty ? ` <span class="tag gold">${t('penalty')}</span>` : ''}${e.assist ? `<div class="mute small">${t('assist_by')}: ${nm(e.assist)}</div>` : ''}`;
  else if (e.type === 'yellow') body = `<span class="cd cy"></span> <b>${nm(e.uid)}</b>`;
  else if (e.type === 'red') body = `<span class="cd cr"></span> <b>${nm(e.uid)}</b>${e.second ? ` <span class="tag">${t('second_yellow')}</span>` : ''}`;
  else body = `<b>${nm(e.uid)}</b> <span class="tag">${t('save_word')}</span>`;
  return `<div class="li"><b dir="ltr" style="width:40px">${Math.floor((e.t || 0) / 60) + 1}'</b><div>${body}</div><span class="tag">${t('team')} ${esc(tn)}</span>${del ? `<button class="btn sm danger" data-act="refDelEv" data-id="${esc(e.id)}">${icon('x')}</button>` : ''}</div>`;
}

// ---------- rank tab ----------
export function statsTab() {
  if (!S.stats) { loadStats(); return spinner(); }
  const keys = ['goals', 'assists', 'saves', 'apps'];
  const per = S.stats.per;
  const r = ranking(per, S.rtab);
  return `<div class="seg">${keys.map(k => `<button class="${S.rtab === k ? 'on' : ''}" data-act="rtab" data-k="${k}">${t('rk_' + k)}</button>`).join('')}</div>
  <div class="card">${r.length ? r.map(([id, v], i) => `
    <div class="li" data-act="openMember" data-uid="${esc(id)}" style="cursor:pointer">
      <span class="rk r${i + 1}">${i + 1}</span>${av(nameFor(id), S.members[id]?.photo)}
      <div><b>${esc(nameFor(id))}</b></div><span class="amt">${fmtNum(v[S.rtab])}</span></div>`).join('') : `<div class="empty">${t('no_stats')}</div>`}</div>`;
}
function nameFor(id) {
  if (S.members[id]) return S.members[id].name;
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
  const m = S.members[uid]; if (!m) return `<div class="empty">—</div>`;
  const p = S.stats.per[uid] || blank();
  const priv = uid === S.user.uid || isAdmin();
  const ach = achievements(uid, S.stats.per);
  const hist = priv ? S.ledger.filter(l => l.uid === uid).sort((a, b) => tsMs(b.at) - tsMs(a.at)).slice(0, 40) : [];
  const bal = balanceOf(uid);
  return `
  <div class="card" style="text-align:center">${av(m.name, m.photo, 'lg')}
    <h2 style="margin-top:8px">${esc(m.name)}</h2>
    <span class="tag">${t('role_' + m.role)}</span>
    ${infoChips(uid, m)}</div>
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
  ${memberAdmin(uid)}`;
}

export function memberView(uid) {
  const m = S.members[uid];
  return bar(m?.name || '', true) + `<div style="padding-bottom:12px">${memberBody(uid)}</div>`;
}
