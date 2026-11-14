import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const wait=()=>new Promise(r=>setTimeout(r,20));
test('network outage blocks protected content without destroying drafts; retry restores the verified session',async t=>{
 const dom=new JSDOM('<div id="auth-email"></div><form id="logout-form"></form><input id="draft" value="Carga em edição">',{url:'https://romaneio.test/app/cd',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;w.ROMANEIO_CONTEXT={userId:'same-user',email:'cd@example.test'};w.AbortSignal=AbortSignal;let offline=true;w.fetch=async()=>offline?new Response('{}',{status:503}):new Response(JSON.stringify({id:'same-user'}));w.eval(readFileSync(new URL('../public/assets/session.js',import.meta.url),'utf8'));w.dispatchEvent(new w.Event('focus'));await wait();assert.ok(w.document.getElementById('session-retry'));assert.equal(w.document.documentElement.style.visibility,'hidden');assert.equal(w.document.getElementById('draft').value,'Carga em edição');offline=false;w.document.querySelector('#session-retry button').click();await wait();assert.equal(w.document.getElementById('session-retry'),null);assert.equal(w.document.documentElement.style.visibility,'');assert.equal(w.document.getElementById('draft').value,'Carga em edição');
});
