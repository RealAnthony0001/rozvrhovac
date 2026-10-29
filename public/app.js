import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const DAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
const S = 96; // slotů za den (15 min)
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = (n) => String(n).padStart(2, '0');
const tm = (s) => `${p2(s >> 2)}:${p2((s % 4) * 15)}`;
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const fmtDate = (s) => new Date(s + 'T00:00').toLocaleDateString('cs', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });

const touch = matchMedia('(hover: none)'), narrow = matchMedia('(max-width: 720px)');
const state = { day: iso(new Date()), gid: '', token: '', data: null, tab: 'week', edit: false, mine: new Set(), selected: new Set(), known: new Set(), drag: null, month: new Date(), cells: [] };
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
const setTheme = (t) => { document.documentElement.dataset.theme = localStorage.theme = t; $('#theme').innerHTML = (t === 'dark' ? '☀' : '☾') + `<span class="lg"> ${t === 'dark' ? 'Světlý' : 'Tmavý'}</span>`; };
setTheme(document.documentElement.dataset.theme);

// ---------- tooltip ----------
const tip = $('#tip');
const names = (ms) => ms.map((m) => `<span style="--c:${m.color}"><i></i>${esc(m.name)}</span>`).join('') || '–';
function cellTip(i) {
  const head = `${DAYS[(i / S) | 0]} ${tm(i % S)}–${tm((i % S) + 1)}`;
  if (state.edit) return `<div class="th">${head}</div>${state.mine.has(i) ? 'Obsazeno' : 'Volno'}`;
  const sel = state.data.members.filter((m) => state.selected.has(m.id));
  const busy = sel.filter((m) => m.busy.includes(i)), free = sel.filter((m) => !m.busy.includes(i));
  const w = touch.matches && state.data.me && winAt(i);
  return `<div class="th">${head}</div>${w ? `<button class="add" data-act="win" data-d="${w.d}" data-s0="${w.s0}" data-s1="${w.s1}">+ Událost ${tm(w.s0)}–${tm(w.s1)}</button>` : ''}<div class="tr"><span class="lb">Volní (${free.length}/${sel.length})</span>${names(free)}</div><div class="tr"><span class="lb">Obsazení (${busy.length})</span>${names(busy)}</div>`;
}
function evTip(id) {
  const e = state.data.events.find((x) => x.id === id);
  return `<div class="th">${esc(e.title)}</div>${fmtDate(e.date)}, ${e.start}–${e.stop}${e.note ? `<div class="tr">${esc(e.note)}</div>` : ''}<div class="tr"><span class="lb">Jdou (${e.going.length})</span>${names(e.going.map(byId).filter(Boolean))}</div>`;
}
let tipKey = '';
function showTip(el, e) {
  const key = el.dataset.i ? 'c' + el.dataset.i : 'e' + el.dataset.id;
  if (key !== tipKey) { tipKey = key; tip.innerHTML = el.dataset.i ? cellTip(+el.dataset.i) : evTip(+el.dataset.id); tip.style.display = 'block'; }
  if (touch.matches) return; // na dotyku je panel ukotvený dole (CSS)
  tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
  tip.style.top = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8) + 'px';
}
const hideTip = () => { tip.style.display = tipKey = ''; };
document.addEventListener('mousemove', (e) => {
  if (touch.matches) return;
  const el = e.target.closest?.('.c, .chip');
  el && state.data ? showTip(el, e) : hideTip();
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
  $('#nav').hidden = false;
  $('#hright').innerHTML = '<button data-act="copy" aria-label="Kopírovat odkaz pro ostatní"><span class="sm">🔗</span><span class="lg">Kopírovat odkaz</span></button><span id="who"></span>';
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
    <div id="agenda"></div>
  </section>`;
  let h = '<div></div>' + DAYS.map((d) => `<div class="dh">${d}</div>`).join('');
  for (let s = 0; s < S; s++) {
    h += `<div class="tl">${s % 4 ? '' : tm(s)}</div>`;
    for (let d = 0; d < 7; d++) h += `<div class="c${s % 4 ? '' : ' hr'}" data-i="${d * S + s}" data-act="cell"></div>`;
  }
  $('#grid').innerHTML = h;
  state.cells = [...document.querySelectorAll('.c')];
  $('.gridwrap').scrollTop = 28 * state.cells[0].offsetHeight; // začni v 7:00
  bindGrid();
}

const renderInfo = () => { $('#info').textContent = touch.matches
    ? (state.edit ? 'Klepnutí = jedno políčko, přidrž a táhni = víc. Ukládá se hned.' : `Zeleně = volno všech vybraných (${state.selected.size}/${state.data.members.length}). Klepni pro detail.`)
    : (state.edit ? 'Klikej nebo táhni a označuj, kdy jsi obsazený/á (ukládá se hned).' : 'Zeleně: volno všech vybraných (klik = nová událost). Najeď na políčko pro detail.'); };

function renderAll() {
  const me = meMember();
  document.title = state.data.group.name;
  $('#gname').innerHTML = `<a href="./">${esc(state.data.group.name)}</a>`;
  $('#who').innerHTML = me
    ? `<button class="chip2" data-act="settings" aria-label="Nastavení, přihlášen jako ${esc(me.name)}" style="--c:${me.color}"><i></i>${esc(me.name)}<span class="sm" aria-hidden="true"> ⚙</span></button> <button data-act="copyMine" title="Pro přihlášení na jiném zařízení">Osobní odkaz</button><button data-act="settings">Nastavení</button>`
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
  renderInfo();
  const cur = state.tab === 'events' && !narrow.matches ? 'week' : state.tab;
  document.querySelectorAll('nav button').forEach((b) => { b.classList.toggle('on', b.dataset.tab === cur); b.dataset.tab === cur ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  document.body.dataset.tab = state.tab; // na mobilu "events" skryje mřížku (CSS)
  $('#week').hidden = state.tab === 'cal';
  $('#cal').hidden = state.tab !== 'cal';
  renderSide(); paintGrid(); renderEvents(); renderCal();
  if (tip.style.display === 'block' && tipKey[0] === 'c') tip.innerHTML = cellTip(+tipKey.slice(1)); // panel po dotyku nezestarne při obnově
}

function freeWindows(min) {
  const sel = state.data.members.filter((m) => state.selected.has(m.id));
  if (!sel.length) return [];
  const busy = new Set(sel.flatMap((m) => m.busy)), out = [];
  for (let d = 0; d < 7; d++) {
    let s0 = null;
    for (let s = 0; s <= S; s++) {
      const free = s < S && !busy.has(d * S + s);
      if (free && s0 === null) s0 = s;
      if (!free && s0 !== null) { out.push({ d, s0, s1: s, len: s - s0 }); s0 = null; }
    }
  }
  return out.filter((w) => w.len >= min); // pořadí Po→Ne a podle času, jak vznikla ve smyčce
}

const winAt = (i) => { const d = (i / S) | 0, s = i % S; return !state.edit && freeWindows(1).find((x) => x.d === d && x.s0 <= s && s < x.s1); };

function openWin(d, s0, s1, date) { // nejbližší výskyt dne v týdnu (nebo daný den), čas podle okna
  const t = new Date(), delta = (d - ((t.getDay() + 6) % 7) + 7) % 7;
  openAdd(date ?? iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + delta)), tm(Math.min(s0, S - 2)), s1 >= S ? '23:45' : tm(s1));
}

function renderWins() {
  const wins = freeWindows(2);
  $('#wins').innerHTML = wins.length
    ? wins.map((w) => `<button class="win" data-act="win" data-d="${w.d}" data-s0="${w.s0}" data-s1="${w.s1}"><b>${DAYS[w.d]}</b> ${tm(w.s0)}–${tm(w.s1)} <small>${String(w.len / 4).replace('.', ',')} h</small></button>`).join('')
    : '<p class="muted pad">Žádné společné volno.</p>';
}

function renderSide() {
  $('#side').innerHTML = `<h3>Lidé</h3><div class="people"><div class="sel"><button data-act="all">Všichni</button><button data-act="none">Nikdo</button></div>` +
    state.data.members.map((m) => `<label style="--c:${m.color}"><input type="checkbox" data-act="pick" data-id="${m.id}" ${state.selected.has(m.id) ? 'checked' : ''}><i></i>${esc(m.name)}</label>`).join('') +
    `</div><h3 class="sub">Společné volno</h3><div class="wins" id="wins"></div>`;
  renderWins();
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
  const wrap = $('.gridwrap');
  let pend = null, tick = 0, py = 0; // pend: dotyk čeká, jestli bude tap, podržení (malování) nebo rolování
  const begin = (i, pid) => {
    state.drag = { d0: (i / S) | 0, s0: i % S, val: !state.mine.has(i), base: new Set(state.mine), last: -1 };
    try { grid.setPointerCapture(pid); } catch {}
    drag(i);
  };
  const stop = () => { clearInterval(tick); tick = 0; };
  grid.addEventListener('pointerdown', (e) => {
    const c = state.edit && cellAt(e);
    if (!c) return;
    const i = +c.dataset.i;
    if (e.pointerType !== 'touch') { e.preventDefault(); return begin(i, e.pointerId); }
    pend = { i, x: e.clientX, y: e.clientY, id: e.pointerId, t: setTimeout(() => { navigator.vibrate?.(8); begin(i, e.pointerId); pend = null; }, 250) };
  });
  grid.addEventListener('touchmove', (e) => { if (state.drag) e.preventDefault(); }, { passive: false }); // malování, ne rolování
  grid.addEventListener('pointermove', (e) => {
    if (pend && Math.hypot(e.clientX - pend.x, e.clientY - pend.y) > 8) { clearTimeout(pend.t); pend = null; } // prst se hýbe = rolování
    if (!state.drag) return;
    py = e.clientY;
    const c = cellAt(e);
    if (c && +c.dataset.i !== state.drag.last) drag(+c.dataset.i);
    if (!tick) tick = setInterval(() => { // posun při tažení k okraji mřížky
      const r = wrap.getBoundingClientRect(), dy = py < r.top + 50 ? -10 : py > r.bottom - 50 ? 10 : 0;
      if (dy) wrap.scrollTop += dy;
    }, 16);
  });
  const end = guard(async () => {
    stop();
    if (!state.drag) return;
    state.drag = null;
    try { await rpc('api_set_busy', { ...auth(), p_busy: [...state.mine] }); }
    finally { await load(); paintGrid(); }
  });
  grid.addEventListener('pointerup', () => {
    if (pend) { clearTimeout(pend.t); begin(pend.i, pend.id); pend = null; } // krátké klepnutí = jedno políčko
    end();
  });
  grid.addEventListener('pointercancel', () => { if (pend) { clearTimeout(pend.t); pend = null; } else end(); });
}

const goingChips = (e) => e.going.map(byId).filter(Boolean).map((m) => `<span class="chip2" style="--c:${m.color}"><i></i>${esc(m.name)}</span>`).join('');
const goBtn = (e) => {
  const me = state.data.me;
  return me ? `<button data-act="going" data-id="${e.id}">${e.going.includes(me) ? 'Nejdu' : 'Jdu'}</button>` : '';
};

const evCard = (e, short) => `<div class="ev">
      <div class="when">${short ? '' : `<span>${fmtDate(e.date)}</span> `}<span class="tm">${e.start}–${e.stop}</span></div>
      <div class="what"><a data-act="open" data-id="${e.id}">${esc(e.title)}</a><div>${goingChips(e) || '<small>Zatím nikdo</small>'}</div></div>
      ${goBtn(e)}</div>`;

function renderEvents() {
  const today = iso(new Date());
  const up = state.data.events.filter((e) => e.date >= today);
  $('#events').innerHTML = up.length ? up.map((e) => evCard(e)).join('') : '<p class="muted">Zatím žádné nadcházející události.</p>';
}

function renderCal() {
  const y = state.month.getFullYear(), mo = state.month.getMonth();
  $('#month').textContent = state.month.toLocaleDateString('cs', { month: 'long', year: 'numeric' });
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
  const today = iso(new Date());
  let h = DAYS.map((d) => `<div class="dh">${d}</div>`).join('');
  for (let k = 0; k < 42; k++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + k), key = iso(d);
    const dayEvs = state.data.events.filter((e) => e.date === key);
    const evs = dayEvs.map((e) =>
      `<div class="chip" data-act="open" data-id="${e.id}">${e.start} ${esc(e.title)} <small>(${e.going.length})</small></div>`).join('');
    h += `<div class="day${d.getMonth() !== mo ? ' off' : ''}${key === today ? ' today' : ''}${key === state.day ? ' pick' : ''}" role="button" tabindex="0" aria-label="${fmtDate(key)}, událostí: ${dayEvs.length}" data-date="${key}" data-act="addEvent"><b>${d.getDate()}</b>${evs}</div>`;
  }
  $('#calgrid').innerHTML = h;
  const day = state.data.events.filter((e) => e.date === state.day);
  const wd = (new Date(state.day + 'T00:00').getDay() + 6) % 7, fw = freeWindows(2).filter((w) => w.d === wd);
  $('#agenda').innerHTML = `<div class="evhead"><h2>${fmtDate(state.day)}</h2><button data-act="addEvent" data-date="${state.day}">+ Přidat událost</button></div>` +
    (day.map((e) => evCard(e, 1)).join('') || '<p class="muted">Tento den nic není.</p>') + (fw.length ? `<h3 class="sub">Společné volno</h3><div class="fw">${fw.map((w) => `<button data-act="dwin" data-d="${w.d}" data-s0="${w.s0}" data-s1="${w.s1}"><b>${tm(w.s0)}–${tm(w.s1)}</b> <small>${String(w.len / 4).replace('.', ',')} h</small></button>`).join('')}</div>` : '');
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
    <div class="row">${goBtn(e)}<button data-act="ics" data-id="${e.id}">Do kalendáře</button>${mine ? `<button data-act="edit-ev" data-id="${e.id}">Upravit</button><button class="danger" data-act="del" data-id="${e.id}">Smazat</button>` : ''}<button data-act="close">Zavřít</button></div>`;
  delete dlg().dataset.edit;
  dlg().dataset.open = id;
  if (!dlg().open) dlg().showModal();
}

function renderDp(month) {
  const dp = $('.dp'), cur = $('#evform').date.value, today = iso(new Date());
  const y = month.getFullYear(), mo = month.getMonth(), start = new Date(y, mo, 1 - ((new Date(y, mo, 1).getDay() + 6) % 7));
  dp.dataset.m = iso(month);
  let h = `<div class="dpbar"><button type="button" data-act="dpmove" data-d="-1">‹</button><b>${month.toLocaleDateString('cs', { month: 'long', year: 'numeric' })}</b><button type="button" data-act="dpmove" data-d="1">›</button></div><div class="dpg">` + DAYS.map((d) => `<i>${d}</i>`).join('');
  for (let k = 0; k < 42; k++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + k), key = iso(d);
    h += `<button type="button" data-act="dppick" data-date="${key}" class="${d.getMonth() !== mo ? 'off ' : ''}${key === cur ? 'sel ' : ''}${key === today ? 'today' : ''}">${d.getDate()}</button>`;
  }
  dp.innerHTML = h + '</div>';
}

const timeOpts = (sel) => {
  const t = Array.from({ length: S }, (_, k) => tm(k));
  if (!t.includes(sel)) t.push(sel); // starší události mohou mít čas mimo 15min mřížku
  return t.map((x) => `<option${x === sel ? ' selected' : ''}>${x}</option>`).join('');
};

function downloadIcs(e) {
  const dt = (t) => e.date.replace(/-/g, '') + 'T' + t.replace(':', '') + '00'; // čas bez zóny = lokální v kalendáři
  const txt = (v) => v.replace(/[\\;,]/g, '\\$&').replace(/\r?\n/g, '\\n');
  // shortcut: řádky se neskládají po 75 B, klienti to běžně snesou; upgrade při problémech s dlouhými popisy
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rozvrhovac//CS', 'BEGIN:VEVENT', `UID:${state.gid}-${e.id}@rozvrhovac`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}`, `DTSTART:${dt(e.start)}`, `DTEND:${dt(e.stop)}`, `SUMMARY:${txt(e.title)}`,
    ...(e.note ? [`DESCRIPTION:${txt(e.note)}`] : []), 'END:VEVENT', 'END:VCALENDAR'];
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar' })), download: `${e.title.replace(/[^\p{L}\p{N}-]+/gu, '_')}.ics` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function openAdd(date, start = '18:00', stop = '20:00', ev) {
  if (!state.data.me) return alert('Nejdřív zadej své jméno (vpravo nahoře).');
  delete dlg().dataset.open;
  ev ? (dlg().dataset.edit = ev.id) : delete dlg().dataset.edit;
  const day = date || iso(new Date());
  dlg().innerHTML = `<form id="evform"><h2>${ev ? 'Upravit událost' : 'Nová událost'}</h2>
    <label>Název<input name="title" required maxlength="80" value="${esc(ev?.title ?? '')}"></label>
    <div class="field dpw">Datum<input type="hidden" name="date" value="${day}"><button type="button" class="dpbtn" data-act="dpopen">${fmtDate(day)}</button><div class="dp" hidden></div></div>
    <div class="row"><label>Od<select name="start">${timeOpts(start)}</select></label><label>Do<select name="stop">${timeOpts(stop)}</select></label></div>
    <label>Popis<textarea name="note" maxlength="500">${esc(ev?.note ?? '')}</textarea></label>
    ${ev ? '' : '<label class="chk"><input type="checkbox" name="going" checked> Plánuji jít</label>'}
    <div class="row"><button type="button" data-act="close">Zrušit</button><button>${ev ? 'Uložit' : 'Přidat'}</button></div></form>`;
  dlg().showModal();
}

function openSettings() {
  delete dlg().dataset.open; delete dlg().dataset.edit;
  dlg().innerHTML = `<form id="setform"><h2>Nastavení</h2>
    <label>Moje jméno<input name="name" required maxlength="30" value="${esc(meMember().name)}"></label>
    <label>Název skupiny<input name="group" required maxlength="60" value="${esc(state.data.group.name)}"></label>
    <p class="mo"><button type="button" data-act="copyMine">Zkopírovat můj osobní odkaz</button><small>Pro přihlášení na jiném zařízení.</small></p>
    <div class="row"><button type="button" class="danger" data-act="leave">Opustit skupinu</button><button type="button" data-act="close">Zrušit</button><button>Uložit</button></div></form>`;
  dlg().showModal();
}

dlg().addEventListener('click', (e) => { const r = dlg().getBoundingClientRect(); if (e.target === dlg() && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dlg().close(); }); // jen klik na pozadí, ne Enter v poli
dlg().addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  if (e.target.id === 'setform') {
    if (f.get('name') !== meMember().name) await rpc('api_rename_member', { ...auth(), p_name: f.get('name') });
    if (f.get('group') !== state.data.group.name) await rpc('api_rename_group', { ...auth(), p_name: f.get('group') });
  } else {
    const p = { ...auth(), p_title: f.get('title'), p_date: f.get('date'), p_start: f.get('start'), p_stop: f.get('stop'), p_note: f.get('note') };
    const edit = dlg().dataset.edit;
    if (edit) await rpc('api_update_event', { ...p, p_event: +edit });
    else await rpc('api_create_event', { ...p, p_going: f.has('going') });
  }
  dlg().close(); await load(); renderAll();
}));

// ---------- akce ----------
const flash = (el, t) => { const o = el.innerHTML; el.textContent = t; setTimeout(() => (el.innerHTML = o), 1500); };
document.addEventListener('click', guard(async (e) => {
  const el = e.target.closest('[data-act]');
  if (!e.target.closest('.dpw')) $('.dp')?.setAttribute('hidden', ''); // klik mimo popup ho zavře
  const c = e.target.closest('.c');
  if (touch.matches && c && !state.edit) {
    if (tipKey === 'c' + c.dataset.i && tip.style.display) hideTip();
    else { // panel nesmí zakrýt klepnuté políčko
      showTip(c, e);
      const over = c.getBoundingClientRect().bottom - tip.getBoundingClientRect().top;
      if (over > -8) $('.gridwrap').scrollTop += over + 48;
    }
  }
  else if (!e.target.closest('#tip')) hideTip();
  if (!el) return;
  const { act, id, date, tab } = el.dataset;
  const findEv = () => state.data.events.find((x) => x.id === +id);
  const refresh = async () => { await load(); renderAll(); if (dlg().open && dlg().dataset.open) openDetail(+dlg().dataset.open); };
  if (act === 'dpopen') {
    const dp = $('.dp'), cur = $('#evform').date.value;
    dp.hidden = !dp.hidden;
    if (!dp.hidden) renderDp(new Date(+cur.slice(0, 4), +cur.slice(5, 7) - 1, 1));
  } else if (act === 'dpmove') {
    const m = new Date($('.dp').dataset.m + 'T00:00');
    renderDp(new Date(m.getFullYear(), m.getMonth() + +el.dataset.d, 1));
  } else if (act === 'dppick') {
    $('#evform').date.value = date;
    $('.dpbtn').textContent = fmtDate(date);
    $('.dp').hidden = true;
  } else if (act === 'theme') setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  else if (act === 'tab') { state.tab = tab; renderAll(); }
  else if (act === 'copy') { await navigator.clipboard.writeText(location.origin + location.pathname + '#/g/' + state.gid); flash(el, 'Zkopírováno'); }
  else if (act === 'copyMine') { await navigator.clipboard.writeText(`${location.origin}${location.pathname}#/g/${state.gid}?t=${state.token}`); flash(el, 'Zkopírováno'); }
  else if (act === 'edit') { state.edit = !state.edit; if (!state.edit) await load(); renderAll(); }
  else if (act === 'all' || act === 'none') { state.selected = new Set(act === 'all' ? state.data.members.map((m) => m.id) : []); renderSide(); renderInfo(); paintGrid(); }
  else if (act === 'pick') { el.checked ? state.selected.add(+id) : state.selected.delete(+id); renderWins(); renderInfo(); paintGrid(); }
  else if (act === 'addEvent') { if (narrow.matches && el.matches('.day')) { state.day = date; renderCal(); } else openAdd(date); }
  else if (act === 'dwin') openWin(+el.dataset.d, +el.dataset.s0, +el.dataset.s1, state.day);
  else if (act === 'win') { hideTip(); openWin(+el.dataset.d, +el.dataset.s0, +el.dataset.s1); }
  else if (act === 'cell') {
    const w = !touch.matches && el.classList.contains('free') && winAt(+el.dataset.i);
    if (w) openWin(w.d, w.s0, w.s1);
  }
  else if (act === 'edit-ev') { const ev = findEv(); openAdd(ev.date, ev.start, ev.stop, ev); }
  else if (act === 'ics') downloadIcs(findEv());
  else if (act === 'settings') openSettings();
  else if (act === 'leave') {
    if (!confirm('Opravdu opustit skupinu? Smaže se tvůj rozvrh a účasti na událostech, tvé události zůstanou.')) return;
    await rpc('api_leave', auth());
    localStorage.removeItem('tok:' + state.gid); state.token = ''; state.edit = false;
    dlg().close(); await load(); renderAll();
  }
  else if (act === 'open') openDetail(+id);
  else if (act === 'close') dlg().close();
  else if (act === 'going') {
    const ev = findEv();
    await rpc('api_set_going', { ...auth(), p_event: +id, p_going: !ev.going.includes(state.data.me) });
    await refresh();
  } else if (act === 'del') {
    if (!confirm('Opravdu smazat událost?')) return;
    await rpc('api_delete_event', { ...auth(), p_event: +id });
    dlg().close(); await refresh();
  } else if (act === 'prev' || act === 'next') { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + (act === 'next' ? 1 : -1), 1); renderCal(); }
  else if (act === 'today') { state.month = new Date(); renderCal(); }
}));

document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role=button]')) { e.preventDefault(); e.target.click(); } });

const m = location.hash.match(/^#\/g\/([\w-]+)(?:\?t=([\w-]+))?$/);
addEventListener('hashchange', () => location.reload());
m ? group(m[1], m[2]) : home();
