import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server/dev.mjs';
import { fixture, userA, userB, jwt } from './auth-fixture.mjs';
import { pages } from '../server/config.mjs';

async function start(t) {
  const f = fixture();
  const server = createAppServer({ authFetch: f.authFetch });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, init = {}) => fetch(origin + path, { redirect: 'manual', ...init });
  const login = (email = userA.email, password = 'test-password', next = '/app/inicio') => request('/auth/login', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password, next })
  });
  return { ...f, origin, request, login };
}
function cookies(response) { return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); }

test('all six routes redirect before sending operational HTML; private source is inaccessible', async t => {
  const { request } = await start(t);
  for (const page of pages) {
    const r = await request('/app/' + page);
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/login?next=' + encodeURIComponent('/app/' + page));
    assert.doesNotMatch(await r.text(), /formCD|LOJAS|localStorage/);
    assert.match(r.headers.get('cache-control'), /no-store/);
  }
  for (const path of ['/private/romaneio.html', '/romaneio.html', '/app/unknown', '/api/index']) assert.equal((await request(path)).status, 404);
  assert.equal((await request('/auth/session')).status, 401);
  assert.equal((await request('/index.html')).headers.get('location'), '/app/inicio');
});

test('password sign-in → server-verified protected page → session → logout', async t => {
  const { login, request, origin, calls } = await start(t);
  assert.equal((await login(userA.email, 'wrong')).status, 401);
  const signedIn = await login(userA.email, 'test-password', '/app/loja');
  assert.equal(signedIn.status, 303);
  assert.equal(signedIn.headers.get('location'), '/app/loja');
  assert.ok(signedIn.headers.getSetCookie().every(c => /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c)));
  const cookie = cookies(signedIn);
  assert.ok(cookie.includes('sb-ddhirpnnuyflxnwszuqp-auth-token'));
  const page = await request('/app/loja', { headers: { cookie } });
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /"initialPage":"loja"/);
  assert.match(html, new RegExp(userA.id));
  assert.doesNotMatch(html, /access_token|refresh_token|test-password/);
  const session = await request('/auth/session', { headers: { cookie } });
  assert.deepEqual(await session.json(), { id: userA.id, email: userA.email });
  assert.ok(calls.filter(c => c.path.endsWith('/user')).length >= 3);
  const logout = await request('/auth/logout', { method: 'POST', headers: { cookie, Origin: origin } });
  assert.equal(logout.status, 303);
  assert.ok(logout.headers.getSetCookie().some(c => /Max-Age=0/i.test(c)));
  assert.equal((await request('/auth/session', { headers: { cookie: cookies(logout) } })).status, 401);
});

test('rejects external redirects, cross-origin mutations and GET logout', async t => {
  const { login, request } = await start(t);
  for (const target of ['https://evil.example', '//evil.example', '/\\evil.example', '/app/cd?next=evil', '/app/%2e%2e']) {
    assert.equal((await login(userA.email, 'test-password', target)).headers.get('location'), '/app/inicio');
  }
  const csrf = await request('/auth/login', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a%40b.com&password=123' });
  assert.equal(csrf.status, 403);
  assert.equal((await request('/auth/logout', { method: 'POST' })).status, 403);
  assert.equal((await request('/auth/logout')).status, 404);
});

test('forged cookie user data cannot grant access; expired valid session is refreshed', async t => {
  const f = await start(t);
  const cookieName = 'sb-ddhirpnnuyflxnwszuqp-auth-token';
  const encode = value => cookieName + '=base64-' + Buffer.from(JSON.stringify(value)).toString('base64url');
  const forged = { ...f.token(userA, 'fake-token'), expires_at: Math.floor(Date.now() / 1000) + 3600 };
  assert.equal((await f.request('/app/painel', { headers: { cookie: encode(forged) } })).status, 303);
  const expired = { ...f.token(userA, jwt(userA, 1)), expires_at: 1 };
  const r = await f.request('/app/painel', { headers: { cookie: encode(expired) } });
  assert.equal(r.status, 200);
  assert.ok(r.headers.getSetCookie().length);
  assert.ok(f.calls.some(c => c.grant === 'refresh_token'));
});

test('concurrent users stay isolated and Auth outage fails closed', async t => {
  const f = await start(t);
  const a = cookies(await f.login(userA.email));
  const b = cookies(await f.login(userB.email));
  const [one, two] = await Promise.all([
    f.request('/auth/session', { headers: { cookie: a } }).then(r => r.json()),
    f.request('/auth/session', { headers: { cookie: b } }).then(r => r.json())
  ]);
  assert.equal(one.id, userA.id);
  assert.equal(two.id, userB.id);
  f.setOutage(true);
  const failed = await f.request('/app/cd', { headers: { cookie: a } });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /formCD|localStorage/);
});
