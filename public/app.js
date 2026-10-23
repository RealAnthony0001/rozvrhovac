import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const DAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
const S = 96; // slotů za den (15 min)
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = (n) => String(n).padStart(2, '0');
const tm = (s) => `${p2(s >> 2)}:${p2((s % 4) * 15)}`;
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const fmtDate = (s) => new Date(s + 'T00:00').toLocaleDateString('cs', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });

const state = { gid: '', token: '', data: null, tab: 'week', edit: false, mine: new Set(), selected: new Set(), known: new Set(), drag: null, month: new Date(), cells: [] };
const byId = (id) => state.data.members.find((m) => m.id === id);
const meMember = () => state.data.me && byId(state.data.me);

// všechna logika a ověření je v SQL funkcích api_* (supabase/schema.sql)
async function rpc(fn, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY }, body: JSON.stringify(args) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || r.statusText);
  return j;
}
const auth = () => ({ p_id: state.gid, p_token: state.token });
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { alert(e.message); } };

// ---------- téma ----------
const setTheme = (t) => { document.documentElement.dataset.theme = localStorage.theme = t; $('#theme').textContent = t === 'dark' ? '☀ Světlý' : '☾ Tmavý'; };
setTheme(document.documentElement.dataset.theme);

// ---------- tooltip ----------
const tip = $('#tip');
const names = (ms) => ms.map((m) => `<span style="--c:${m.color}"><i></i>${esc(m.name)}</span>`).join('') || '–';
function cellTip(i) {
  const head = `${DAYS[(i / S) | 0]} ${tm(i % S)}–${tm((i % S) + 1)}`;
  if (state.edit) return `<div class="th">${head}</div>${state.mine.has(i) ? 'Obsazeno' : 'Volno'}`;
  const sel = state.data.members.filter((m) => state.selected.has(m.id));
  const busy = sel.filter((m) => m.busy.includes(i)), free = sel.filter((m) => !m.busy.includes(i));
  return `<div class="th">${head}</div><div class="tr"><span class="lb">Volní (${free.length}/${sel.length})</span>${names(free)}</div><div class="tr"><span class="lb">Obsazení (${busy.length})</span>${names(busy)}</div>`;
}
function evTip(id) {
  const e = state.data.events.find((x) => x.id === id);
  return `<div class="th">${esc(e.title)}</div>${fmtDate(e.date)}, ${e.start}–${e.stop}${e.note ? `<div class="tr">${esc(e.note)}</div>` : ''}<div class="tr"><span class="lb">Jdou (${e.going.length})</span>${names(e.going.map(byId).filter(Boolean))}</div>`;
}
let tipKey = '';
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest?.('.c, .chip');
  if (!el || !state.data) { tip.style.display = tipKey = ''; return; }
  const key = el.dataset.i ? 'c' + el.dataset.i : 'e' + el.dataset.id;
  if (key !== tipKey) { tipKey = key; tip.innerHTML = el.dataset.i ? cellTip(+el.dataset.i) : evTip(+el.dataset.id); tip.style.display = 'block'; }
  tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
  tip.style.top = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8) + 'px';
});

// ---------- úvod ----------
function home() {
  $('#app').innerHTML = `<div class="home"><h1>Rozvrhovač</h1>
    <p>Vytvoř společný rozvrh, pošli odkaz ostatním a uvidíte, kdy máte všichni volno.</p>
    <form id="newg"><input name="name" placeholder="Název skupiny" required maxlength="60" autofocus><button>Vytvořit společný rozvrh</button></form></div>`;
  $('#newg').onsubmit = guard(async (e) => {
    e.preventDefault();
    const { id } = await rpc('api_create_group', { p_name: new FormData(e.target).get('name') });
    location.hash = '/g/' + id;
  });
}

// ---------- skupina ----------
async function load() {
  const d = await rpc('api_get_group', { p_id: state.gid, p_token: state.token || null });
  state.data = d;
  for (const m of d.members) if (!state.known.has(m.id)) { state.known.add(m.id); state.selected.add(m.id); }
  state.mine = new Set(meMember()?.busy);
}

async function group(gid, token) {
  state.gid = gid;
  if (token) { localStorage['tok:' + gid] = token; history.replaceState(null, '', '#/g/' + gid); } // osobní odkaz pro přihlášení na jiném zařízení
  state.token = localStorage['tok:' + gid] ?? '';
  try { await load(); } catch (e) { $('#app').innerHTML = `<div class="home"><h1>${esc(e.message)}</h1><a href="./">Zpět</a></div>`; return; }
  build();
  renderAll();
  setInterval(() => { if (!state.edit && !document.hidden) guard(async () => { await load(); renderAll(); })(); }, 10000);
}

function build() {
  document.title = state.data.group.name;
  $('#gname').textContent = '/ ' + state.data.group.name;
  $('#nav').hidden = false;
  $('#hright').innerHTML = '<button data-act="copy">Zkopírovat odkaz pro ostatní</button><span id="who"></span>';
  $('#app').innerHTML = `
  <section id="week">
    <aside id="side"></aside>
    <div class="main">
      <div class="bar"><button id="editBtn" data-act="edit"></button><span id="info"></span></div>
      <div class="gridwrap"><div id="grid"></div></div>
      <div class="evhead"><h2>Události</h2><button data-act="addEvent">+ Přidat událost</button></div>
      <div id="events"></div>
    </div>
  </section>
  <section id="cal" hidden>
    <div class="calbar"><button data-act="prev">‹</button><h2 id="month"></h2><button data-act="next">›</button><button data-act="today">Dnes</button></div>
    <div id="calgrid"></div>
  </section>`;
  let h = '<div></div>' + DAYS.map((d) => `<div class="dh">${d}</div>`).join('');
  for (let s = 0; s < S; s++) {
    h += `<div class="tl">${s % 4 ? '' : tm(s)}</div>`;
    for (let d = 0; d < 7; d++) h += `<div class="c${s % 4 ? '' : ' hr'}" data-i="${d * S + s}"></div>`;
  }
  $('#grid').innerHTML = h;
  state.cells = [...document.querySelectorAll('.c')];
  $('.gridwrap').scrollTop = 28 * 12; // začni v 7:00
  bindGrid();
}

function renderAll() {
  const me = meMember();
  $('#who').innerHTML = me
    ? `<b class="chip2" style="--c:${me.color}"><i></i>${esc(me.name)}</b> <button data-act="copyMine" title="Pro přihlášení na jiném zařízení">Můj osobní odkaz</button>`
    : `<form id="join"><input name="name" placeholder="Tvoje jméno" required maxlength="30"><button>Vstoupit</button></form>`;
  if (!me) $('#join').onsubmit = guard(async (e) => {
    e.preventDefault();
    const { token } = await rpc('api_join', { p_id: state.gid, p_name: new FormData(e.target).get('name') });
    state.token = localStorage['tok:' + state.gid] = token;
    await load(); renderAll();
  });
  $('#editBtn').hidden = !me;
  $('#editBtn').textContent = state.edit ? 'Hotovo' : 'Upravit můj rozvrh';
  $('#grid').classList.toggle('editing', state.edit);
  $('#grid').style.setProperty('--mine', me?.color ?? '#000');
  $('#info').textContent = state.edit ? 'Klikej nebo táhni a označuj, kdy jsi obsazený/á (ukládá se hned).' : 'Zeleně: volno všech vybraných. Najeď na políčko pro detail.';
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  $('#week').hidden = state.tab !== 'week';
  $('#cal').hidden = state.tab !== 'cal';
  renderSide(); paintGrid(); renderEvents(); renderCal();
}

function renderSide() {
  $('#side').innerHTML = `<h3>Lidé</h3><div class="sel"><button data-act="all">Všichni</button><button data-act="none">Nikdo</button></div>` +
    state.data.members.map((m) => `<label style="--c:${m.color}"><input type="checkbox" data-act="pick" data-id="${m.id}" ${state.selected.has(m.id) ? 'checked' : ''}><i></i>${esc(m.name)}</label>`).join('');
}

function paintGrid() {
  const sel = state.data.members.filter((m) => state.selected.has(m.id));
  const sets = sel.map((m) => new Set(m.busy));
  for (const c of state.cells) {
    const i = +c.dataset.i;
    const busy = state.edit ? 0 : sets.filter((s) => s.has(i)).length;
    c.classList.toggle('mine', state.edit && state.mine.has(i));
    c.classList.toggle('free', !state.edit && sel.length > 0 && busy === 0);
    c.style.setProperty('--b', sel.length ? busy / sel.length : 0);
  }
}

function bindGrid() {
  const grid = $('#grid');
  const cellAt = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest('.c');
  const drag = (i) => { // obdélník od místa kliknutí po aktuální buňku
    const D = state.drag, d1 = (i / S) | 0, s1 = i % S, m = new Set(D.base);
    D.last = i;
    for (let d = Math.min(D.d0, d1); d <= Math.max(D.d0, d1); d++)
      for (let s = Math.min(D.s0, s1); s <= Math.max(D.s0, s1); s++) D.val ? m.add(d * S + s) : m.delete(d * S + s);
    state.mine = m; paintGrid();
  };
  grid.addEventListener('pointerdown', (e) => {
    const c = state.edit && cellAt(e);
    if (!c) return;
    e.preventDefault();
    const i = +c.dataset.i;
    state.drag = { d0: (i / S) | 0, s0: i % S, val: !state.mine.has(i), base: new Set(state.mine), last: -1 };
    grid.setPointerCapture(e.pointerId);
    drag(i);
  });
  grid.addEventListener('pointermove', (e) => {
    const c = state.drag && cellAt(e);
    if (c && +c.dataset.i !== state.drag.last) drag(+c.dataset.i);
  });
  const end = guard(async () => {
    if (!state.drag) return;
    state.drag = null;
    try { await rpc('api_set_busy', { ...auth(), p_busy: [...state.mine] }); }
    finally { await load(); paintGrid(); }
  });
  grid.addEventListener('pointerup', end);
  grid.addEventListener('pointercancel', end);
}

const goingChips = (e) => e.going.map(byId).filter(Boolean).map((m) => `<span class="chip2" style="--c:${m.color}"><i></i>${esc(m.name)}</span>`).join('');
const goBtn = (e) => {
  const me = state.data.me;
  return me ? `<button data-act="going" data-id="${e.id}">${e.going.includes(me) ? 'Nejdu' : 'Jdu'}</button>` : '';
};

function renderEvents() {
  const today = iso(new Date());
  const up = state.data.events.filter((e) => e.date >= today);
  $('#events').innerHTML = up.length ? up.map((e) => `<div class="ev">
      <div class="when">${fmtDate(e.date)}<br>${e.start}–${e.stop}</div>
      <div class="what"><a data-act="open" data-id="${e.id}">${esc(e.title)}</a><div>${goingChips(e) || '<small>Zatím nikdo</small>'}</div></div>
      ${goBtn(e)}</div>`).join('') : '<p class="muted">Zatím žádné nadcházející události.</p>';
}

function renderCal() {
  const y = state.month.getFullYear(), mo = state.month.getMonth();
  $('#month').textContent = state.month.toLocaleDateString('cs', { month: 'long', year: 'numeric' });
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
  const today = iso(new Date());
  let h = DAYS.map((d) => `<div class="dh">${d}</div>`).join('');
  for (let k = 0; k < 42; k++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + k), key = iso(d);
    const evs = state.data.events.filter((e) => e.date === key).map((e) =>
      `<div class="chip" data-act="open" data-id="${e.id}">${e.start} ${esc(e.title)} <small>(${e.going.length})</small></div>`).join('');
    h += `<div class="day${d.getMonth() !== mo ? ' off' : ''}${key === today ? ' today' : ''}" data-act="addEvent" data-date="${key}"><b>${d.getDate()}</b>${evs}</div>`;
  }
  $('#calgrid').innerHTML = h;
}

// ---------- dialogy ----------
const dlg = () => $('#dlg');
function openDetail(id) {
  const e = state.data.events.find((x) => x.id === id);
  if (!e) return dlg().close();
  const mine = e.createdBy === state.data.me;
  dlg().innerHTML = `<h2>${esc(e.title)}</h2><p>${fmtDate(e.date)}, ${e.start}–${e.stop}</p>
    ${e.note ? `<p>${esc(e.note)}</p>` : ''}
    <h3>Kdo jde (${e.going.length})</h3><div>${goingChips(e) || '<small>Zatím nikdo</small>'}</div>
    <div class="row">${goBtn(e)}${mine ? `<button data-act="del" data-id="${e.id}">Smazat</button>` : ''}<button data-act="close">Zavřít</button></div>`;
  dlg().dataset.open = id;
  if (!dlg().open) dlg().showModal();
}

const timeOpts = (sel) => Array.from({ length: S }, (_, k) => `<option${tm(k) === sel ? ' selected' : ''}>${tm(k)}</option>`).join('');

function openAdd(date) {
  if (!state.data.me) return alert('Nejdřív zadej své jméno (vpravo nahoře).');
  delete dlg().dataset.open;
  dlg().innerHTML = `<form id="evform"><h2>Nová událost</h2>
    <label>Název<input name="title" required maxlength="80"></label>
    <label>Datum<input type="date" name="date" required value="${date || iso(new Date())}"></label>
    <div class="row"><label>Od<select name="start">${timeOpts('18:00')}</select></label><label>Do<select name="stop">${timeOpts('20:00')}</select></label></div>
    <label>Popis<textarea name="note" maxlength="500"></textarea></label>
    <label class="chk"><input type="checkbox" name="going" checked> Plánuji jít</label>
    <div class="row"><button type="button" data-act="close">Zrušit</button><button>Přidat</button></div></form>`;
  dlg().showModal();
}

dlg().addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  await rpc('api_create_event', { ...auth(), p_title: f.get('title'), p_date: f.get('date'), p_start: f.get('start'), p_stop: f.get('stop'), p_note: f.get('note'), p_going: f.has('going') });
  dlg().close(); await load(); renderAll();
}));

// ---------- akce ----------
const flash = (el, t) => { const o = el.textContent; el.textContent = t; setTimeout(() => (el.textContent = o), 1500); };
document.addEventListener('click', guard(async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id, date, tab } = el.dataset;
  const refresh = async () => { await load(); renderAll(); if (dlg().open && dlg().dataset.open) openDetail(+dlg().dataset.open); };
  if (act === 'theme') setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  else if (act === 'tab') { state.tab = tab; renderAll(); }
  else if (act === 'copy') { await navigator.clipboard.writeText(location.origin + location.pathname + '#/g/' + state.gid); flash(el, 'Zkopírováno'); }
  else if (act === 'copyMine') { await navigator.clipboard.writeText(`${location.origin}${location.pathname}#/g/${state.gid}?t=${state.token}`); flash(el, 'Zkopírováno'); }
  else if (act === 'edit') { state.edit = !state.edit; if (!state.edit) await load(); renderAll(); }
  else if (act === 'all' || act === 'none') { state.selected = new Set(act === 'all' ? state.data.members.map((m) => m.id) : []); renderSide(); paintGrid(); }
  else if (act === 'pick') { el.checked ? state.selected.add(+id) : state.selected.delete(+id); paintGrid(); }
  else if (act === 'addEvent') openAdd(date);
  else if (act === 'open') openDetail(+id);
  else if (act === 'close') dlg().close();
  else if (act === 'going') {
    const ev = state.data.events.find((x) => x.id === +id);
    await rpc('api_set_going', { ...auth(), p_event: +id, p_going: !ev.going.includes(state.data.me) });
    await refresh();
  } else if (act === 'del') {
    if (!confirm('Opravdu smazat událost?')) return;
    await rpc('api_delete_event', { ...auth(), p_event: +id });
    dlg().close(); await refresh();
  } else if (act === 'prev' || act === 'next') { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + (act === 'next' ? 1 : -1), 1); renderCal(); }
  else if (act === 'today') { state.month = new Date(); renderCal(); }
}));

const m = location.hash.match(/^#\/g\/([\w-]+)(?:\?t=([\w-]+))?$/);
addEventListener('hashchange', () => location.reload());
m ? group(m[1], m[2]) : home();
