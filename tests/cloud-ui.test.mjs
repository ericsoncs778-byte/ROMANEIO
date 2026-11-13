import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, CookieJar, VirtualConsole } from 'jsdom';
import { createAppServer } from '../server/dev.mjs';
import { fixture, userA, userB } from './auth-fixture.mjs';

const load = (id, status = 'Aguardando saída') => ({ id, loja: 'Amazonas', tipo: 'CARGA SECA', paletes: [{ notas: ['100'] }], conferidos: [], status, criado: new Date().toLocaleString('pt-BR') });

test('two interfaces share cloud data; conflicts/offline saves preserve drafts and cannot overwrite confirmed loads', async t => {
  const f = fixture(); const server = createAppServer({ authFetch: f.authFetch });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  async function open(user, legacy = false) {
    const jar = new CookieJar();
    const login = await fetch(origin + '/auth/login', { method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: user.email, password: 'test-password' }) });
    for (const cookie of login.headers.getSetCookie()) jar.setCookieSync(cookie, origin);
    const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error.message));
    const dom = await JSDOM.fromURL(origin + '/app/inicio', {
      cookieJar: jar, resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console,
      beforeParse(w) {
        w.fetch = (path, options = {}) => fetch(new URL(path, origin), { ...options, headers: { ...options.headers, Cookie: jar.getCookieStringSync(origin), ...(options.method === 'POST' ? { Origin: origin } : {}) } });
        w.AbortSignal = AbortSignal; w.confirm = () => true; w.alert = () => {};
        if (legacy) w.localStorage.setItem('hiperideal_romaneio:' + user.id, JSON.stringify([load('ROM-OLD')]));
      }
    });
    t.after(() => dom.window.close());
    await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
    await dom.window.romaneioCloudReady;
    assert.equal(dom.window.RomaneioSync.ready, true);
    return dom.window;
  }
  const a = await open(userA, true), b = await open(userB);
  assert.deepEqual(JSON.parse(a.localStorage.getItem('hiperideal_romaneio:' + userA.id + ':pre-cloud-backup'))[0].id, 'ROM-OLD');
  assert.equal(a.RomaneioApp.records().length, 0);
  assert.equal(f.cloudRows.has('ROM-OLD'), false, 'old device data must not be published automatically');
  a.RomaneioApp.replace([load('ROM-ONLINE')]);
  assert.equal(await a.RomaneioSync.save(a.RomaneioApp.records()), true);
  await b.RomaneioSync.refresh(true);
  assert.equal(b.RomaneioApp.records()[0].id, 'ROM-ONLINE');
  b.RomaneioApp.records()[0].status = 'Em trânsito';
  assert.equal(await b.RomaneioSync.save(b.RomaneioApp.records()), true);
  a.RomaneioApp.records()[0].status = 'Na loja';
  assert.equal(await a.RomaneioSync.save(a.RomaneioApp.records()), false);
  assert.equal(f.cloudRows.get('ROM-ONLINE').payload.status, 'Em trânsito');
  assert.ok(a.localStorage.getItem('hiperideal_romaneio:' + userA.id + ':unconfirmed').includes('Na loja'));
  await a.RomaneioSync.refresh(true);
  assert.equal(a.RomaneioApp.records()[0].status, 'Em trânsito');
  f.setWriteFailure(true);
  a.RomaneioApp.replace([...a.RomaneioApp.records(), load('ROM-OFFLINE')]);
  assert.equal(await a.RomaneioSync.save(a.RomaneioApp.records()), false);
  assert.equal(f.cloudRows.has('ROM-OFFLINE'), false);
  assert.equal(a.RomaneioApp.records().some(c => c.id === 'ROM-OFFLINE'), false);
  assert.equal(a.document.getElementById('cloud-draft').hidden, false);
  assert.deepEqual(errors, []);
});
