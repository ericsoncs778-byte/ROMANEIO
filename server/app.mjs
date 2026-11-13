import { readFile } from 'node:fs/promises';
import { authForRequest, verifiedUser } from './auth.mjs';
import { pages, safeNext } from './config.mjs';
import { loginPage, unavailablePage } from './templates.mjs';
import { membership, listRomaneios, validateChanges, recordId } from './data.mjs';

const appFile = new URL('../private/romaneio.html', import.meta.url);

function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.end(body);
}
function redirect(res, location) {
  res.setHeader('Location', location);
  send(res, 303, '');
}
function sameOrigin(req) {
  const protocol = process.env.VERCEL === '1' || req.socket.encrypted ? 'https' : 'http';
  try { return req.headers.origin === new URL(`${protocol}://${req.headers.host}`).origin; }
  catch { return false; }
}
async function formData(req) {
  if (!String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')) {
    throw Object.assign(new Error('Unsupported form'), { status: 415 });
  }
  // Vercel can parse req.body before invoking the Node handler.
  if (req.body !== undefined) {
    const value = typeof req.body === 'object' ? new URLSearchParams(req.body).toString() : String(req.body);
    if (Buffer.byteLength(value) > 8192) throw Object.assign(new Error('Body too large'), { status: 413 });
    return new URLSearchParams(value);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString());
}

async function jsonBody(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) throw Object.assign(new Error('Invalid content type'), { status: 415 });
  let text;
  if (req.body !== undefined) text = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  else {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) throw Object.assign(new Error('Body too large'), { status: 413 });
      chunks.push(chunk);
    }
    text = Buffer.concat(chunks).toString();
  }
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw Object.assign(new Error('Body too large'), { status: 413 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

// authFetch is dependency injection for tests, never selected by a URL or environment flag.
export function createHandler({ authFetch } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Vary', 'Cookie');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    // Inline handlers/styles belong to the original v45 app. Auth cookies remain HttpOnly.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname.replace(/\/$/, '') || '/';
      if (!['GET', 'POST'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST');
        return send(res, 405, 'Método não permitido.');
      }
      if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, 'Origem não autorizada.');
      const client = authForRequest(req, res, authFetch);

      if (path === '/data/romaneios') {
        const json = (status, value) => send(res, status, JSON.stringify(value), 'application/json; charset=utf-8');
        const user = await verifiedUser(client);
        if (!user) return json(401, { error: 'unauthenticated' });
        const member = await membership(client, user.id);
        if (!member) return json(403, { error: 'access_denied' });
        if (req.method === 'GET') {
          const after = url.searchParams.get('after') || '';
          if (after && !recordId.test(after)) return json(400, { error: 'invalid_cursor' });
          return json(200, await listRomaneios(client, member, after));
        }
        if (member.access_role === 'viewer') return json(403, { error: 'read_only' });
        const body = await jsonBody(req);
        if (!validateChanges(body?.changes)) return json(400, { error: 'invalid_data' });
        const { data, error } = await client.rpc('save_romaneios', { p_changes: body.changes });
        if (error?.code === '40001') return json(409, { error: 'version_conflict' });
        if (error?.code === '42501') return json(403, { error: 'access_denied' });
        if (error && ['23514','23503','22023','22P02','23502'].includes(error.code)) return json(400, { error: 'invalid_data' });
        if (error) throw new Error('Cloud save unavailable');
        return json(200, { rows: data });
      }

      if (path === '/auth/login' && req.method === 'POST') {
        const form = await formData(req);
        const email = (form.get('email') || '').trim();
        const password = form.get('password') || '';
        const next = safeNext(form.get('next'));
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !password || password.length > 1024) {
          return send(res, 400, loginPage({ next, error: 'Informe seu e-mail e sua senha.' }));
        }
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          if (!error.status || error.status >= 500) throw new Error('Auth unavailable');
          return send(res, error.status === 429 ? 429 : 401, loginPage({ next, error: error.status === 429
            ? 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
            : 'Não foi possível entrar. Confira suas credenciais e a confirmação do e-mail.' }));
        }
        if (!await verifiedUser(client)) {
          await client.auth.signOut({ scope: 'local' });
          return send(res, 403, loginPage({ next, error: 'Use uma conta com e-mail confirmado.' }));
        }
        return redirect(res, next);
      }

      if (path === '/auth/logout' && req.method === 'POST') {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw new Error('Logout unavailable');
        res.setHeader('Clear-Site-Data', '"cache"');
        return redirect(res, '/login');
      }
      if (req.method !== 'GET') return send(res, 404, 'Página não encontrada.');
      if (path === '/login') {
        const next = safeNext(url.searchParams.get('next'));
        return await verifiedUser(client) ? redirect(res, next) : send(res, 200, loginPage({ next }));
      }
      if (path === '/' || path === '/index.html' || path === '/app') return redirect(res, '/app/inicio');
      if (path === '/auth/session') {
        const user = await verifiedUser(client);
        return send(res, user ? 200 : 401, JSON.stringify(user ? { id: user.id, email: user.email } : { error: 'unauthenticated' }), 'application/json; charset=utf-8');
      }
      if (pages.some(page => path === `/app/${page}`)) {
        const user = await verifiedUser(client);
        if (!user) return redirect(res, `/login?next=${encodeURIComponent(path)}`);
        const config = JSON.stringify({ userId: user.id, email: user.email, initialPage: path.split('/')[2] }).replace(/</g, '\\u003c');
        const html = (await readFile(appFile, 'utf8')).replace('/*__ROMANEIO_CONTEXT__*/', `window.ROMANEIO_CONTEXT = ${config};`);
        return send(res, 200, html);
      }
      // Never serve private/romaneio.html as a public static file.
      return send(res, 404, 'Página não encontrada.');
    } catch (error) {
      if (req.url?.startsWith('/data/')) return send(res, [400, 413, 415].includes(error.status) ? error.status : 503, JSON.stringify({ error: error.status === 413 ? 'payload_too_large' : 'cloud_unavailable' }), 'application/json; charset=utf-8');
      if (error.status === 413 || error.status === 415) return send(res, error.status, 'Formulário inválido.');
      console.error('ROMANEIO: falha ao validar acesso.'); // no passwords, cookies or tokens in logs
      return send(res, 503, unavailablePage());
    }
  };
}
