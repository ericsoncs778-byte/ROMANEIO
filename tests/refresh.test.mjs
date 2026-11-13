import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { JSDOM, CookieJar, VirtualConsole } from 'jsdom';
import { createAppServer } from '../server/dev.mjs';
import { fixture, userA, userB } from './auth-fixture.mjs';

const record = id => ({ id, loja: 'Amazonas', tipo: 'CARGA SECA', paletes: [{ notas: ['100'] }], conferidos: [] });
async function until(condition) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (condition()) return;
    await wait(10);
  }
  assert.fail('A interface não terminou de atualizar');
}
async function open(t, user = userA, provisioned = true) {
  const f = fixture();
  if (!provisioned) f.members.delete(user.id);
  const server = createAppServer({ authFetch: f.authFetch });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const jar = new CookieJar();
  const login = await fetch(origin + '/auth/login', {
    method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: user.email, password: 'test-password' })
  });
  for (const cookie of login.headers.getSetCookie()) jar.setCookieSync(cookie, origin);
  const intervals = [], errors = [];
  const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error.message));
  const dom = await JSDOM.fromURL(origin + '/app/inicio', {
    cookieJar: jar, resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console,
    beforeParse(w) {
      // Capture browser intervals so thirty minutes can be advanced deterministically.
      w.setInterval = (run, delay) => { intervals.push({ run, delay }); return intervals.length; };
      w.fetch = (path, options = {}) => fetch(new URL(path, origin), { ...options, headers: { ...options.headers, Cookie: jar.getCookieStringSync(origin) } });
      w.AbortSignal = AbortSignal; w.confirm = () => true; w.alert = () => {};
    }
  });
  t.after(() => dom.window.close());
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  await dom.window.romaneioCloudReady;
  return { f, w: dom.window, intervals, errors };
}

test('automatic refresh runs on the 30-minute timer and preserves unsaved forms and active receipts', async t => {
  const { f, w, intervals, errors } = await open(t);
  const automatic = intervals.find(timer => timer.delay === 30 * 60 * 1000);
  assert.ok(automatic, 'Deve haver atualização automática a cada 30 minutos');
  assert.equal(intervals.some(timer => timer.delay === 15000), false);
  assert.ok(intervals.some(timer => timer.delay === 60000), 'A verificação de sessão não deve ser desativada');
  f.cloudRows.set('ROM-NEW', { id: 'ROM-NEW', payload: record('ROM-NEW'), version: 1 });
  assert.equal(w.RomaneioApp.records().length, 0, 'Não atualiza antes do disparo do timer');
  automatic.run();
  await until(() => w.RomaneioApp.records().length === 1 && !w.RomaneioSync.busy);

  w.nav('cd');
  const input = w.document.getElementById('motorista');
  input.value = 'Rascunho do motorista'; input.dispatchEvent(new w.Event('input', { bubbles: true }));
  f.cloudRows.set('ROM-NEXT', { id: 'ROM-NEXT', payload: record('ROM-NEXT'), version: 1 });
  const calls = f.calls.length;
  automatic.run(); await wait(20);
  assert.equal(input.value, 'Rascunho do motorista');
  assert.equal(f.calls.length, calls, 'Timer não busca dados enquanto há edição');
  assert.equal(w.RomaneioApp.records().length, 1);

  w.nav('inicio');
  const activeWork = w.RomaneioApp.activeWork;
  w.RomaneioApp.activeWork = () => true;
  automatic.run(); await wait(20);
  assert.equal(f.calls.length, calls, 'Conferência/câmera em andamento não é substituída');
  w.RomaneioApp.activeWork = activeWork;
  automatic.run();
  await until(() => w.RomaneioApp.records().length === 2 && !w.RomaneioSync.busy);
  assert.deepEqual(errors, []);
});

test('an Auth account needs workspace access; retry opens the app immediately after authorization', async t => {
  const { f, w, errors } = await open(t, userB, false);
  assert.equal(w.RomaneioSync.ready, false);
  assert.match(w.document.getElementById('cloud-status').textContent, /ainda não foi autorizada/);
  assert.equal(w.document.getElementById('app').inert, true);
  f.members.set(userB.id, 'operator');
  w.document.getElementById('cloud-refresh').click();
  await until(() => w.RomaneioSync.ready && !w.RomaneioSync.busy);
  assert.equal(w.document.getElementById('app').inert, false);
  assert.ok(w.document.querySelector('.logistics-tiles'));
  assert.deepEqual(errors, []);
});
