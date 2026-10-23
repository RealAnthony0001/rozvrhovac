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

await fails(call('api_delete_event', [id, b.token, ev.id]), 'jen autor');
await call('api_delete_event', [id, a.token, ev.id]);
assert.equal((await call('api_get_group', [id, null])).events.length, 0);

console.log('OK');
