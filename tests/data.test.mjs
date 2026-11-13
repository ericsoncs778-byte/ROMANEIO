import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server/dev.mjs';
import { fixture, userA, userB } from './auth-fixture.mjs';
import { validateChanges } from '../server/data.mjs';

const payload = (id, extra = {}) => ({ id, loja: 'Amazonas', tipo: 'CARGA SECA', paletes: [{ notas: ['123'] }], conferidos: [], ...extra });
async function start(t) {
  const f = fixture(); const server = createAppServer({ authFetch: f.authFetch });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(origin + path, { ...options, redirect: 'manual' });
  async function login(email) {
    const r = await request('/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password: 'test-password' }) });
    return r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  }
  const a = await login(userA.email), b = await login(userB.email);
  const get = (cookie = a, query = '') => request('/data/romaneios' + query, { headers: { Cookie: cookie } });
  const save = (changes, cookie = a) => request('/data/romaneios', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) });
  return { ...f, get, save, a, b, request };
}

test('cloud API requires both a real session and provisioned workspace membership', async t => {
  const f = await start(t);
  assert.equal((await f.get('')).status, 401);
  f.members.delete(userB.id);
  assert.equal((await f.get(f.b)).status, 403);
  assert.equal((await f.save([{ id: 'ROM-1', payload: payload('ROM-1'), expectedVersion: 0 }], f.b)).status, 403);
  assert.equal(f.cloudRows.size, 0);
});

test('CD save is readable by another authorized user/device; stale batch is atomic', async t => {
  const f = await start(t);
  assert.equal((await f.save([{ id: 'ROM-1', payload: payload('ROM-1'), expectedVersion: 0 }])).status, 200);
  const read = await (await f.get(f.b)).json();
  assert.equal(read.rows[0].version, 1);
  assert.equal((await f.save([{ id: 'ROM-1', payload: payload('ROM-1', { status: 'Em trânsito' }), expectedVersion: 1 }])).status, 200);
  const conflict = await f.save([
    { id: 'ROM-2', payload: payload('ROM-2'), expectedVersion: 0 },
    { id: 'ROM-1', payload: payload('ROM-1', { status: 'Na loja' }), expectedVersion: 1 }
  ], f.b);
  assert.equal(conflict.status, 409);
  assert.equal(f.cloudRows.has('ROM-2'), false);
  assert.equal(f.cloudRows.get('ROM-1').version, 2);
  assert.equal(f.cloudRows.get('ROM-1').payload.status, 'Em trânsito');
});

test('invalid imports, duplicate IDs, nonexistent stores and read-only writes are rejected', async t => {
  const f = await start(t);
  for (const value of [payload("ROM-'onclick"), payload('ROM-1', { loja: 'Unknown' }), payload('ROM-1', { conferidos: [2] }), payload('ROM-1', { paletes: [] })]) {
    assert.equal((await f.save([{ id: value.id, payload: value, expectedVersion: 0 }])).status, 400);
  }
  const p = payload('ROM-1');
  assert.equal(validateChanges([{ id: p.id, payload: p, expectedVersion: 0 }, { id: p.id, payload: p, expectedVersion: 0 }]), false);
  f.members.set(userB.id, 'viewer');
  assert.equal((await f.get(f.b)).status, 200);
  assert.equal((await f.save([{ id: p.id, payload: p, expectedVersion: 0 }], f.b)).status, 403);
  f.setWriteFailure(true);
  assert.equal((await f.save([{ id: p.id, payload: p, expectedVersion: 0 }])).status, 503);
  assert.equal(f.cloudRows.size, 0);
});

test('cloud list is paginated, with no silent truncation at the Data API limit', async t => {
  const f = await start(t);
  for (let i = 0; i < 103; i++) { const id = 'ROM-' + String(i).padStart(3, '0'); f.cloudRows.set(id, { id, payload: payload(id), version: 1 }); }
  const first = await (await f.get()).json();
  assert.equal(first.rows.length, 100);
  const second = await (await f.get(f.a, '?after=' + first.next)).json();
  assert.equal(second.rows.length, 3);
  assert.equal(second.next, null);
});
