import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const DAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'], DAYS_L = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle'];
const S = 96; // slotů za den (15 min)
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = (n) => String(n).padStart(2, '0');
const tm = (s) => `${p2(s >> 2)}:${p2((s % 4) * 15)}`;
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const fmtLong = (s) => new Date(s + 'T00:00').toLocaleDateString('cs', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDate = (s) => new Date(s + 'T00:00').toLocaleDateString('cs', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });

const touch = matchMedia('(hover: none)'), narrow = matchMedia('(max-width: 720px), (hover: none) and (pointer: coarse) and (max-width: 1024px)');
const state = { day: iso(new Date()), gid: '', token: '', data: null, tab: 'week', edit: false, mine: new Set(), selected: new Set(), known: new Set(), drag: null, month: new Date(), cells: [] };
const byId = (id) => state.data.members.find((m) => m.id === id);
const meMember = () => state.data.me && byId(state.data.me);

// všechna logika a ověření je v SQL funkcích api_* (supabase/schema.sql)
async function rpc(fn, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) })
    .catch(() => { throw new Error('Spojení se serverem selhalo, zkus to znovu.'); });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || r.statusText);
  return j;
}
const auth = () => ({ p_id: state.gid, p_token: state.token });
const guard = (fn, lock) => { let busy = false; return async (...a) => { if (lock && busy) return; busy = true; try { await fn(...a); } catch (e) { alert(e.message); } finally { busy = false; } }; };
const confirmSheet = (msg, label) => !narrow.matches ? Promise.resolve(confirm(msg)) : new Promise((res) => { // iOS action sheet; na desktopu nativní confirm
  const d = document.createElement('dialog'); d.className = 'act'; d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-describedby', 'actmsg');
  d.innerHTML = `<div class="box"><p id="actmsg">${esc(msg)}</p><button value="1" class="danger">${esc(label)}</button></div><button value="0" class="cancel">Zrušit</button>`;
  d.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b || e.target === d) d.close(b?.value ?? '0'); });
  d.addEventListener('close', () => { res(d.returnValue === '1'); d.remove(); });
  document.body.append(d); d.showModal();
});
const slot = (t) => +t.slice(0, 2) * 4 + +t.slice(3) / 15; // 'HH:MM' → index 15min slotu
const toast = (t) => { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1800); };

// ---------- téma ----------
const setTheme = (t) => { document.documentElement.dataset.theme = localStorage.theme = t; $('meta[name=theme-color]').content = t === 'dark' ? '#000000' : '#f2f2f7'; document.querySelectorAll('[data-act=themeSet]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === t)); $('#theme').innerHTML = (t === 'dark' ? '☀' : '☾') + `<span class="lg"> ${t === 'dark' ? 'Světlý' : 'Tmavý'}</span>`; };
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
  return `<div class="th">${head}${touch.matches ? '<button class="x" data-act="tipx" aria-label="Zavřít">×</button>' : ''}</div>${w ? `<button class="add" data-act="win" data-d="${w.d}" data-s0="${w.s0}" data-s1="${w.s1}">Nová událost<small>ve volném okně ${tm(w.s0)}–${tm(w.s1)}</small></button>` : ''}<div class="tr"><span class="lb">Volní (${free.length}/${sel.length})</span>${names(free)}</div><div class="tr"><span class="lb">Obsazení (${busy.length})</span>${names(busy)}</div>`;
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
  }, true);
}

// ---------- skupina ----------
const PALETTE = ['#5e5ce6', '#ff9500', '#30b0c7', '#af52de', '#ffcc00', '#a2845e', '#ff6bb5', '#32ade6', '#8e8e93']; // červená a zelená patří stavům obsazeno/volno
async function load() {
  const d = await rpc('api_get_group', { p_id: state.gid, p_token: state.token || null });
  d.members.forEach((m, i) => (m.color = PALETTE[i % PALETTE.length]));
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
  $('.gridwrap').scrollTop = 28 * state.cells[0].offsetHeight; // začni v 7:00 (až po rozložení)
  setInterval(async () => { if (state.edit || document.hidden) return; try { await load(); renderAll(); } catch {} }, 10000); // offline = tiše, bez alertu
}

function build() {
  $('#nav').hidden = false;
  $('#hright').innerHTML = '<button data-act="copy" aria-label="Kopírovat odkaz pro ostatní"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3.5M8 7l4-4 4 4"/><path d="M7 10.5H6a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2h-1"/></svg><span class="lg">Kopírovat odkaz</span></button><span id="who"></span>';
  $('#app').innerHTML = `
  <section id="week">
    <aside id="side"></aside>
    <div class="main">
      <div class="bar"><button id="editBtn" data-act="edit"></button><button id="blockBtn" data-act="block" hidden>Zadat čas číslem</button><span id="info"></span></div>
      <div class="gridwrap"><div id="grid"></div></div>
      <div class="evhead"><h2>Události</h2><button data-act="addEvent">+ Přidat událost</button></div>
      <div id="events"></div>
    </div>
  </section>
  <section id="cal" hidden>
    <div class="calbar"><button data-act="prev" aria-label="Předchozí měsíc"><span class="lg">‹</span><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><h2 id="month" class="cap"></h2><button data-act="next" aria-label="Další měsíc"><span class="lg">›</span><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button><button data-act="today">Dnes</button></div>
    <div id="calgrid"></div>
    <div id="agenda"></div>
  </section>`;
  let h = '<div></div>' + DAYS.map((d, i) => `<div class="dh${i === (new Date().getDay() + 6) % 7 ? ' today' : ''}">${d}</div>`).join('');
  for (let s = 0; s < S; s++) {
    h += `<div class="tl">${s % 4 ? '' : tm(s)}</div>`;
    for (let d = 0; d < 7; d++) h += `<div class="c${s % 4 ? '' : ' hr'}" data-i="${d * S + s}" data-act="cell"></div>`;
  }
  $('#grid').innerHTML = h;
  state.cells = [...document.querySelectorAll('.c')];
  bindGrid();
}

const renderInfo = () => { $('#info').textContent = touch.matches
    ? (state.edit ? 'Klepni = 1 políčko · podrž a táhni = oblast' : `Pruhy = obsazení lidí, zelený rámeček = volno všech (${state.selected.size}/${state.data.members.length}).`)
    : (state.edit ? 'Klikej nebo táhni a označuj, kdy jsi obsazený/á (ukládá se hned).' : 'Barevné pruhy = kdy je kdo obsazený, zelený rámeček = volno všech vybraných (klik = nová událost). Najeď na políčko pro detail.'); };

function renderAll() {
  const me = meMember();
  document.title = state.data.group.name;
  $('#gname').innerHTML = `<a href="./">${esc(state.data.group.name)}</a>`;
  $('#who').innerHTML = me
    ? `<button class="chip2" data-act="settings" aria-label="Nastavení, přihlášen jako ${esc(me.name)}" style="--c:${me.color}"><i></i><span class="nm">${esc(me.name)}</span><span class="av" aria-hidden="true">${esc([...me.name][0].toUpperCase())}</span></button> <button data-act="copyMine" title="Pro přihlášení na jiném zařízení">Osobní odkaz</button><button data-act="settings">Nastavení</button>`
    : `<form id="join"><input name="name" placeholder="Tvoje jméno" required maxlength="30"><button>Vstoupit</button></form>`;
  if (!me) $('#join').onsubmit = guard(async (e) => {
    e.preventDefault();
    const { token } = await rpc('api_join', { p_id: state.gid, p_name: new FormData(e.target).get('name') });
    state.token = localStorage['tok:' + state.gid] = token;
    await load(); renderAll();
  }, true);
  $('#editBtn').hidden = !me;
  $('#blockBtn').hidden = !me || !state.edit;
  $('#editBtn').textContent = state.edit ? 'Hotovo' : 'Upravit můj rozvrh';
  $('#grid').classList.toggle('editing', state.edit);
  $('#grid').style.setProperty('--mine', me?.color ?? '#000');
  renderInfo();
  const cur = state.tab === 'events' && !narrow.matches ? 'week' : state.tab;
  document.querySelectorAll('nav button').forEach((b) => { b.classList.toggle('on', b.dataset.tab === cur); b.dataset.tab === cur ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  document.body.classList.toggle('editing', state.edit);
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
  const sl = $('#wins').scrollLeft;
  const wins = freeWindows(2);
  $('#wins').innerHTML = wins.length
    ? wins.map((w) => `<button class="win" data-act="win" data-d="${w.d}" data-s0="${w.s0}" data-s1="${w.s1}"><b>${DAYS[w.d]}</b> ${tm(w.s0)}–${tm(w.s1)} <small>${String(w.len / 4).replace('.', ',')} h</small></button>`).join('')
    : '<p class="muted pad">Žádné společné volno.</p>';
  $('#wins').scrollLeft = sl;
}

function renderSide() {
  const sl = [...document.querySelectorAll('#side .people, #side .wins')].map((el) => el.scrollLeft), foc = document.activeElement?.closest?.('#side') && document.activeElement.dataset.id;
  $('#side').innerHTML = `<h3>Lidé</h3><div class="people"><div class="sel"><button data-act="all">Všichni</button><button data-act="none">Nikdo</button></div>` +
    state.data.members.map((m) => `<label style="--c:${m.color}"><input type="checkbox" data-act="pick" data-id="${m.id}" ${state.selected.has(m.id) ? 'checked' : ''}><i></i>${esc(m.name)}</label>`).join('') +
    `</div><h3 class="sub">Společné volno</h3><div class="wins" id="wins"></div>`;
  renderWins();
  document.querySelectorAll('#side .people, #side .wins').forEach((el, i) => (el.scrollLeft = sl[i] ?? 0));
  if (foc) $(`#side [data-id="${foc}"]`)?.focus();
}

function paintGrid() {
  const sel = state.data.members.filter((m) => state.selected.has(m.id)), n = sel.length;
  const sets = sel.map((m) => new Set(m.busy)), w = 100 / (n || 1);
  const free = (i) => !state.edit && n > 0 && sets.every((x) => !x.has(i));
  for (const c of state.cells) {
    const i = +c.dataset.i, d = (i / S) | 0, t = i % S, f = free(i);
    c.classList.toggle('mine', state.edit && state.mine.has(i));
    c.classList.toggle('free', f);
    // obsazení = svislý pruh v barvě každého člověka; volno všech = zelený rámeček kolem celého souvislého bloku
    const stripes = state.edit || f ? '' : sets.map((x, k) => `${x.has(i) ? sel[k].color : 'transparent'} ${k * w}% ${(k + 1) * w}%`).join(',');
    c.style.background = stripes && `linear-gradient(90deg,${stripes})`;
    c.style.boxShadow = f ? [t === 0 || !free(i - 1) ? 'inset 0 2px 0 var(--free)' : '', t === S - 1 || !free(i + 1) ? 'inset 0 -2px 0 var(--free)' : '', d === 0 || !free(i - S) ? 'inset 2px 0 0 var(--free)' : '', d === 6 || !free(i + S) ? 'inset -2px 0 0 var(--free)' : ''].filter(Boolean).join(',') : '';
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
  let pend = null, tick = 0, px = 0, py = 0; // pend: dotyk čeká, jestli bude tap, podržení (malování) nebo rolování
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
    px = e.clientX; py = e.clientY;
    const c = cellAt(e);
    if (c && +c.dataset.i !== state.drag.last) drag(+c.dataset.i);
    if (!tick) tick = setInterval(() => { // posun při tažení k okraji mřížky
      const r = wrap.getBoundingClientRect(), bot = Math.min(r.bottom, $('#nav').getBoundingClientRect().top || r.bottom), dy = py < r.top + 50 ? -10 : py > bot - 50 ? 10 : 0;
      if (!dy) return;
      wrap.scrollTop += dy;
      const c = document.elementFromPoint(px, py)?.closest('.c');
      if (c && state.drag && +c.dataset.i !== state.drag.last) drag(+c.dataset.i);
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
      <div class="what"><a role="button" tabindex="0" data-act="open" data-id="${e.id}">${esc(e.title)}</a><div>${goingChips(e) || '<small>Zatím nikdo</small>'}</div></div>
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
      `<div class="chip" style="--c:${byId(e.createdBy)?.color ?? ''}" data-act="open" data-id="${e.id}">${e.start} ${esc(e.title)} <small>(${e.going.length})</small></div>`).join('');
    h += `<div class="day${d.getMonth() !== mo ? ' off' : ''}${key === today ? ' today' : ''}${key === state.day ? ' pick' : ''}" role="button" tabindex="0" aria-label="${fmtDate(key)}, událostí: ${dayEvs.length}" data-date="${key}" data-act="addEvent"><b>${d.getDate()}</b>${evs}</div>`;
  }
  $('#calgrid').innerHTML = h;
  const day = state.data.events.filter((e) => e.date === state.day);
  const wd = (new Date(state.day + 'T00:00').getDay() + 6) % 7, fw = freeWindows(2).filter((w) => w.d === wd);
  $('#agenda').innerHTML = `<div class="evhead"><h2 class="cap">${fmtLong(state.day)}</h2><button data-act="addEvent" data-date="${state.day}">+ Přidat událost</button></div>` +
    (day.map((e) => evCard(e, 1)).join('') || '<p class="muted">Tento den nic není.</p>') + (fw.length ? `<h3 class="sub">Společné volno</h3><div class="fw">${fw.map((w) => `<button data-act="dwin" data-d="${w.d}" data-s0="${w.s0}" data-s1="${w.s1}"><b>${tm(w.s0)}–${tm(w.s1)}</b> <small>${String(w.len / 4).replace('.', ',')} h</small></button>`).join('')}</div>` : '');
}

// ---------- dialogy ----------
const dlg = () => $('#dlg');
const sheet = (inner) => { delete dlg().dataset.dirty; dlg().innerHTML = '<div class="grab"></div>' + inner; };

function openDetail(id) {
  const e = state.data.events.find((x) => x.id === id);
  if (!e) return dlg().close();
  const mine = e.createdBy === state.data.me;
  sheet(`<div class="sheethead"><span class="mo"></span><h2 class="dt">${esc(e.title)}</h2><h2 class="mo">Událost</h2><button class="mo strong" data-act="close">Hotovo</button></div>
    <div class="sbody"><h2 class="big mo">${esc(e.title)}</h2><p>${fmtDate(e.date)}, ${e.start}–${e.stop}</p>
    ${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}
    <h3 class="plain">Kdo jde (${e.going.length})</h3><div class="going">${goingChips(e) || '<small>Zatím nikdo</small>'}</div>
    <div class="row actions">${goBtn(e)}<button data-act="ics" data-id="${e.id}">Do kalendáře</button>${mine ? `<button data-act="edit-ev" data-id="${e.id}">Upravit</button><button class="danger" data-act="del" data-id="${e.id}">Smazat</button>` : ''}<button class="dt" data-act="close">Zavřít</button></div></div>`);
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
    h += `<button type="button" data-act="dppick" data-date="${key}" aria-label="${fmtDate(key)}" class="${d.getMonth() !== mo ? 'off ' : ''}${key === cur ? 'sel ' : ''}${key === today ? 'today' : ''}">${d.getDate()}</button>`;
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
  if (!state.data.me) return alert('Nejdřív zadej své jméno.');
  delete dlg().dataset.open;
  ev ? (dlg().dataset.edit = ev.id) : delete dlg().dataset.edit;
  const day = date || iso(new Date());
  sheet(`<form id="evform"><div class="sheethead"><button type="button" class="mo" data-act="close">Zrušit</button><h2>${ev ? 'Upravit událost' : 'Nová událost'}</h2><button class="mo strong">${ev ? 'Uložit' : 'Přidat'}</button></div>
    <div class="sbody"><div class="grp"><label>Název<input name="title" required maxlength="80" placeholder="Povinné" value="${esc(ev?.title ?? '')}"></label>
    <label class="ta">Popis<textarea name="note" maxlength="500" aria-label="Popis" placeholder="Popis (nepovinné)">${esc(ev?.note ?? '')}</textarea></label></div>
    <div class="grp"><div class="field dpw">Datum<input type="hidden" name="date" value="${day}"><button type="button" class="dpbtn" data-act="dpopen">${fmtDate(day)}</button><div class="dp" hidden></div></div>
    <label>Od<select name="start">${timeOpts(start)}</select></label><label>Do<select name="stop">${timeOpts(stop)}</select></label></div>
    ${ev ? '' : '<div class="grp"><label class="chk">Plánuji jít<input type="checkbox" name="going" role="switch" checked></label></div>'}
    <p class="err" role="alert" id="formerr"></p>
    <div class="row dt"><button type="button" data-act="close">Zrušit</button><button>${ev ? 'Uložit' : 'Přidat'}</button></div></div></form>`);
  dlg().showModal();
}

function openBlock() { // alternativa k tažení po mřížce: den(y) + od–do
  const opt = (v, t) => `<option value="${v}">${t}</option>`;
  sheet(`<form id="blockform"><div class="sheethead"><button type="button" class="mo" data-act="close">Zrušit</button><h2>Zadat čas</h2><button class="mo strong">Použít</button></div>
    <div class="sbody"><div class="grp"><label>Dny<select name="days">${DAYS_L.map((d, i) => opt(i, d)).join('')}${opt('w', 'Pondělí–pátek')}${opt('a', 'Každý den')}</select></label>
    <label>Od<select name="start">${timeOpts('08:00')}</select></label><label>Do<select name="stop">${timeOpts('16:00')}<option>24:00</option></select></label>
    <label class="chk">Obsazeno<input type="checkbox" name="busy" role="switch" checked></label></div>
    <p class="foot">Vypnuto = vybraný čas se označí jako volný.</p><p class="err" role="alert" id="formerr"></p>
    <div class="row dt"><button type="button" data-act="close">Zrušit</button><button>Použít</button></div></div></form>`);
  dlg().showModal();
}

function openSettings() {
  delete dlg().dataset.open; delete dlg().dataset.edit;
  const t = document.documentElement.dataset.theme;
  sheet(`<form id="setform"><div class="sheethead"><button type="button" class="mo" data-act="close">Zrušit</button><h2>Nastavení</h2><button class="mo strong">Uložit</button></div>
    <div class="sbody"><div class="grp"><label>Moje jméno<input name="name" required maxlength="30" value="${esc(meMember().name)}"></label>
    <label>Název skupiny<input name="group" required maxlength="60" value="${esc(state.data.group.name)}"></label></div>
    <h3 class="mo">Vzhled</h3><div class="grp mo"><div class="seg" role="group" aria-label="Vzhled"><button type="button" data-act="themeSet" data-v="light" aria-pressed="${t === 'light'}">Světlý</button><button type="button" data-act="themeSet" data-v="dark" aria-pressed="${t === 'dark'}">Tmavý</button></div></div>
    <h3 class="mo">Sdílení</h3><div class="grp mo"><button type="button" data-act="copy" data-clip="1">Zkopírovat odkaz pro skupinu</button><button type="button" data-act="copyMine">Zkopírovat můj osobní odkaz</button></div>
    <p class="foot mo">Osobní odkaz slouží k přihlášení na jiném zařízení.</p>
    <div class="grp mo"><button type="button" class="danger" data-act="leave">Opustit skupinu</button></div><p class="err" role="alert" id="formerr"></p>
    <div class="row dt"><button type="button" class="danger" data-act="leave">Opustit skupinu</button><button type="button" data-act="close">Zrušit</button><button>Uložit</button></div></div></form>`);
  dlg().showModal();
}

const tryClose = async () => { if (dlg().dataset.dirty && !(await confirmSheet('Zahodit rozepsané změny?', 'Zahodit změny'))) return; dlg().close(); };
dlg().addEventListener('input', () => (dlg().dataset.dirty = 1));
dlg().addEventListener('change', (e) => { // po změně „Od“ posuň „Do“ o hodinu dopředu, když by bylo před ním (jako iOS Kalendář)
  const f = e.target.form;
  if (e.target.name === 'start' && f?.stop && slot(f.stop.value) <= slot(e.target.value)) f.stop.value = tm(Math.min(slot(e.target.value) + 4, S - 1));
  $('#formerr')?.replaceChildren();
});
dlg().addEventListener('cancel', (e) => { if (dlg().dataset.dirty) { e.preventDefault(); tryClose(); } });
dlg().addEventListener('click', (e) => { const r = dlg().getBoundingClientRect(); if (e.target === dlg() && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) tryClose(); }); // jen klik na pozadí, ne Enter v poli
let sw = null;
dlg().addEventListener('pointerdown', (e) => {
  if (!narrow.matches || e.target.closest('button') || !e.target.closest('.grab, .sheethead')) return;
  sw = { y: e.clientY }; dlg().setPointerCapture(e.pointerId); dlg().style.transition = 'none';
});
dlg().addEventListener('pointermove', (e) => { if (sw) dlg().style.transform = `translateY(${Math.max(0, e.clientY - sw.y)}px)`; });
const swEnd = (e) => { if (!sw) return; const dy = e.clientY - sw.y; sw = null; dlg().style.transition = dlg().style.transform = ''; if (dy > 90) tryClose(); };
dlg().addEventListener('pointerup', swEnd); dlg().addEventListener('pointercancel', swEnd);
dlg().addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const f = new FormData(e.target), fail = (t) => { const el = $('#formerr'); el.textContent = t; el.scrollIntoView({ block: 'nearest' }); }; // chyba přímo ve sheetu, ne alert
  try {
    if (e.target.id === 'setform') {
      if (f.get('name') !== meMember().name) await rpc('api_rename_member', { ...auth(), p_name: f.get('name') });
      if (f.get('group') !== state.data.group.name) await rpc('api_rename_group', { ...auth(), p_name: f.get('group') });
    } else if (e.target.id === 'blockform') {
      const a = slot(f.get('start')), b = slot(f.get('stop')), dv = f.get('days'), m = new Set(state.mine);
      if (b <= a) return fail('Konec musí být po začátku.');
      for (const d of dv === 'w' ? [0, 1, 2, 3, 4] : dv === 'a' ? [0, 1, 2, 3, 4, 5, 6] : [+dv]) for (let k = a; k < b; k++) f.has('busy') ? m.add(d * S + k) : m.delete(d * S + k);
      await rpc('api_set_busy', { ...auth(), p_busy: [...m] });
    } else {
      if (slot(f.get('stop')) <= slot(f.get('start'))) return fail('Konec musí být po začátku.');
      const p = { ...auth(), p_title: f.get('title'), p_date: f.get('date'), p_start: f.get('start'), p_stop: f.get('stop'), p_note: f.get('note') };
      const edit = dlg().dataset.edit;
      if (edit) await rpc('api_update_event', { ...p, p_event: +edit });
      else await rpc('api_create_event', { ...p, p_going: f.has('going') });
    }
  } catch (err) { return fail(err.message); }
  dlg().close(); await load(); renderAll();
}, true));

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
    $('#evform').date.value = date; dlg().dataset.dirty = 1;
    $('.dpbtn').textContent = fmtDate(date);
    $('.dp').hidden = true;
  } else if (act === 'themeSet') setTheme(el.dataset.v);
  else if (act === 'theme') setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  else if (act === 'tab') { state.tab = tab; renderAll(); }
  else if (act === 'copy') {
    const url = location.origin + location.pathname + '#/g/' + state.gid;
    if (touch.matches && navigator.share && !el.dataset.clip) { try { await navigator.share({ title: state.data.group.name, url }); } catch {} }
    else { await navigator.clipboard.writeText(url); narrow.matches ? toast('Odkaz zkopírován') : flash(el, 'Zkopírováno'); }
  }
  else if (act === 'copyMine') { await navigator.clipboard.writeText(`${location.origin}${location.pathname}#/g/${state.gid}?t=${state.token}`); narrow.matches ? toast('Osobní odkaz zkopírován') : flash(el, 'Zkopírováno'); }
  else if (act === 'edit') { state.edit = !state.edit; if (!state.edit) await load(); renderAll(); }
  else if (act === 'all' || act === 'none') { state.selected = new Set(act === 'all' ? state.data.members.map((m) => m.id) : []); renderSide(); renderInfo(); paintGrid(); }
  else if (act === 'pick') { el.checked ? state.selected.add(+id) : state.selected.delete(+id); renderWins(); renderInfo(); paintGrid(); }
  else if (act === 'addEvent') { if (narrow.matches && el.matches('.day')) { state.day = date; renderCal(); } else openAdd(date); }
  else if (act === 'dwin') openWin(+el.dataset.d, +el.dataset.s0, +el.dataset.s1, state.day);
  else if (act === 'tipx') hideTip();
  else if (act === 'block') openBlock();
  else if (act === 'win') { hideTip(); openWin(+el.dataset.d, +el.dataset.s0, +el.dataset.s1); }
  else if (act === 'cell') {
    const w = !touch.matches && el.classList.contains('free') && winAt(+el.dataset.i);
    if (w) openWin(w.d, w.s0, w.s1);
  }
  else if (act === 'edit-ev') { const ev = findEv(); openAdd(ev.date, ev.start, ev.stop, ev); }
  else if (act === 'ics') downloadIcs(findEv());
  else if (act === 'settings') openSettings();
  else if (act === 'leave') {
    if (!(await confirmSheet('Opravdu opustit skupinu? Smaže se tvůj rozvrh a účasti na událostech, tvé události zůstanou.', 'Opustit skupinu'))) return;
    await rpc('api_leave', auth());
    localStorage.removeItem('tok:' + state.gid); state.token = ''; state.edit = false;
    dlg().close(); await load(); renderAll();
  }
  else if (act === 'open') openDetail(+id);
  else if (act === 'close') tryClose();
  else if (act === 'going') {
    const ev = findEv();
    await rpc('api_set_going', { ...auth(), p_event: +id, p_going: !ev.going.includes(state.data.me) });
    await refresh();
  } else if (act === 'del') {
    if (!(await confirmSheet('Opravdu smazat událost?', 'Smazat událost'))) return;
    await rpc('api_delete_event', { ...auth(), p_event: +id });
    dlg().close(); await refresh();
  } else if (act === 'prev' || act === 'next') { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + (act === 'next' ? 1 : -1), 1); renderCal(); }
  else if (act === 'today') { state.month = new Date(); state.day = iso(new Date()); renderCal(); }
}));

document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role=button]')) { e.preventDefault(); e.target.click(); } });

const m = location.hash.match(/^#\/g\/([\w-]+)(?:\?t=([\w-]+))?$/);
addEventListener('hashchange', () => location.reload());
m ? group(m[1], m[2]) : home();
