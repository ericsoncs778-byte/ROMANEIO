import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, CookieJar, VirtualConsole } from 'jsdom';
import { createAppServer } from '../server/dev.mjs';
import { fixture, userA } from './auth-fixture.mjs';

test('complete HTML loads its auth/QR scripts and opens the requested area without exposing cookies', async t => {
  const f = fixture();
  const server = createAppServer({ authFetch: f.authFetch });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const jar = new CookieJar();
  const response = await fetch(origin + '/auth/login', {
    method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: userA.email, password: 'test-password' })
  });
  for (const cookie of response.headers.getSetCookie()) jar.setCookieSync(cookie, origin);
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = await JSDOM.fromURL(origin + '/app/cd', {
    cookieJar: jar, resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console,
    beforeParse(window) {
      window.fetch = (path, options = {}) => fetch(new URL(path, origin), { ...options, headers: { ...options.headers, Cookie: jar.getCookieStringSync(origin) } });
      window.AbortSignal = AbortSignal;
      window.alert = message => { throw new Error(message); };
    }
  });
  t.after(() => dom.window.close());
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  // Finish the pageshow-triggered verification request before inspecting the page.
  await dom.window.fetch('/auth/session');
  await dom.window.romaneioCloudReady;
  const { window } = dom;
  assert.ok(window.document.getElementById('formCD'));
  assert.equal(window.document.getElementById('auth-email').textContent, userA.email);
  assert.equal(window.document.cookie, '');
  assert.equal(typeof window.qrcode, 'function');
  assert.equal(typeof window.jsQR, 'function');
  assert.equal(typeof window.qrPalete, 'function');
  window.nav('painel');
  assert.equal(window.location.pathname, '/app/painel');
  assert.equal(window.document.getElementById('heading').textContent, 'Painel • Rastreabilidade logística');
  assert.equal(window.document.querySelector('meta[http-equiv="Content-Security-Policy"]'), null);
  assert.deepEqual(errors, []);
});
