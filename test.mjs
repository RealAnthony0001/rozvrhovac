// npm i --no-save @electric-sql/pglite && node test.mjs — smoke test SQL funkcí na Postgres v paměti
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec('create role anon; create role authenticated;'); // v Supabase existují
await db.exec(readFileSync(new URL('./supabase/schema.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('./supabase/schema.sql', import.meta.url), 'utf8')); // idempotence

const call = async (fn, args) => (await db.query(`select ${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).rows[0].r;
const fails = (p, msg) => assert.rejects(p, (e) => e.message.includes(msg));

const { id } = await call('api_create_group', ['Parta']);
const a = await call('api_join', [id, 'Anna']);
const b = await call('api_join', [id, 'Bob']);
await fails(call('api_join', [id, 'Anna']), 'už ve skupině');

await fails(call('api_set_busy', [id, 'zly-token', [1]]), 'Nejsi přihlášen');
await fails(call('api_set_busy', [id, a.token, [9999]]), 'Neplatný rozvrh');
await call('api_set_busy', [id, a.token, [1, 2, 2]]);

const ev = await call('api_create_event', [id, a.token, 'Pivo', '2026-11-05', '18:00', '20:00', '', true]);
await fails(call('api_create_event', [id, a.token, 'x', '2026-11-05', '20:00', '18:00', '', false]), 'Konec');
await call('api_set_going', [id, b.token, ev.id, true]);

const g = await call('api_get_group', [id, b.token]);
assert.deepEqual(g.members.find((m) => m.name === 'Anna').busy, [1, 2]);
assert.equal(g.events[0].going.length, 2);
assert.deepEqual([g.events[0].date, g.events[0].start, g.events[0].stop], ['2026-11-05', '18:00', '20:00']);
assert.equal(g.me, g.members.find((m) => m.name === 'Bob').id);
assert.equal((await call('api_get_group', [id, null])).me, null);

// úprava události
await fails(call('api_update_event', [id, b.token, ev.id, 'Hack', '2026-11-06', '18:00', '20:00', '']), 'jen autor');
await fails(call('api_update_event', [id, a.token, ev.id, 'Pivo', '2026-11-06', '20:00', '18:00', '']), 'Konec');
await call('api_update_event', [id, a.token, ev.id, 'Víno', '2026-11-06', '19:00', '21:30', 'u Anny']);
const u = (await call('api_get_group', [id, null])).events[0];
assert.deepEqual([u.title, u.date, u.start, u.stop, u.note, u.going.length], ['Víno', '2026-11-06', '19:00', '21:30', 'u Anny', 2]);

// přejmenování
await fails(call('api_rename_member', [id, b.token, 'Anna']), 'už ve skupině');
await call('api_rename_member', [id, b.token, 'Bobík']);
await call('api_rename_group', [id, b.token, 'Nová parta']);
const r = await call('api_get_group', [id, null]);
assert.equal(r.group.name, 'Nová parta');
assert.ok(r.members.some((m) => m.name === 'Bobík'));

// odchod: rozvrh a účast zmizí, událost zůstane (bez autora), token přestane platit
await call('api_leave', [id, a.token]);
await fails(call('api_set_busy', [id, a.token, [1]]), 'Nejsi přihlášen');
const l = await call('api_get_group', [id, null]);
assert.equal(l.members.length, 1);
assert.equal(l.events.length, 1);
assert.equal(l.events[0].createdBy, null);
assert.deepEqual(l.events[0].going, [l.members[0].id]);
await fails(call('api_delete_event', [id, b.token, ev.id]), 'jen autor');

console.log('OK');
