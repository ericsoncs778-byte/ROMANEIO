export const userA = { id: '11111111-1111-4111-8111-111111111111', email: 'operador@example.test', email_confirmed_at: '2026-11-12T00:00:00Z', is_anonymous: false, aud: 'authenticated', role: 'authenticated' };
export const userB = { ...userA, id: '22222222-2222-4222-8222-222222222222', email: 'outro@example.test' };
export function jwt(user, expiry = Math.floor(Date.now() / 1000) + 3600) {
  return [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, exp: expiry })).toString('base64url'), 'fixture-signature'].join('.');
}
export function fixture() {
  const accessA = jwt(userA), accessB = jwt(userB);
  const calls = [];
  let revoked = false;
  let outage = false;
  let failWrites = false;
  const cloudRows = new Map();
  const members = new Map([[userA.id, 'admin'], [userB.id, 'operator']]);
  const workspace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const token = (user, access) => ({ access_token: access, token_type: 'bearer', expires_in: 3600, refresh_token: user.id === userA.id ? 'refresh-a' : 'refresh-b', user });
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  async function authFetch(input, init = {}) {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    calls.push({ path: url.pathname, grant: url.searchParams.get('grant_type') });
    if (outage) return json({ message: 'unavailable' }, 503);
    if (url.pathname.startsWith('/rest/v1/')) {
      const access = headers.get('Authorization')?.replace('Bearer ', '');
      const user = access === accessA ? userA : access === accessB ? userB : null;
      if (!user) return json({ message: 'Invalid JWT', code: 'bad_jwt' }, 401);
      const role = members.get(user.id);
      if (url.pathname.endsWith('/romaneio_members')) return json(role ? [{ workspace_id: workspace, access_role: role }] : []);
      if (url.pathname.endsWith('/romaneios')) {
        if (!role) return json([]);
        const after = (url.searchParams.get('id') || '').replace(/^gt\./, '');
        return json([...cloudRows.values()].filter(row => row.id > after).sort((a, b) => a.id < b.id ? -1 : 1).slice(0, Number(url.searchParams.get('limit') || 101)));
      }
      if (url.pathname.endsWith('/rpc/save_romaneios')) {
        if (!role || role === 'viewer') return json({ code: '42501', message: 'ROMANEIO_ACCESS_DENIED' }, 403);
        if (failWrites) return json({ message: 'unavailable' }, 503);
        const changes = JSON.parse(init.body).p_changes;
        if (changes.some(c => (cloudRows.get(c.id)?.version || 0) !== c.expectedVersion)) return json({ code: '40001', message: 'ROMANEIO_CONFLICT' }, 409);
        const saved = changes.map(c => ({ id: c.id, payload: c.payload, version: c.expectedVersion + 1, updated_at: new Date().toISOString() }));
        for (const row of saved) cloudRows.set(row.id, structuredClone(row));
        return json(saved);
      }
    }
    if (url.pathname.endsWith('/token')) {
      const body = JSON.parse(init.body);
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        return !revoked && body.refresh_token === 'refresh-a' ? json(token(userA, accessA)) : json({ code: 'refresh_token_not_found', message: 'Invalid refresh token' }, 400);
      }
      if (body.password !== 'test-password') return json({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 400);
      revoked = false;
      return body.email === userA.email ? json(token(userA, accessA)) : body.email === userB.email ? json(token(userB, accessB)) : json({ message: 'Invalid credentials' }, 400);
    }
    if (url.pathname.endsWith('/user')) {
      const access = headers.get('Authorization')?.replace('Bearer ', '');
      if (access === accessA) return json(userA);
      if (access === accessB) return json(userB);
      return json({ message: 'Invalid JWT', code: 'bad_jwt' }, 401);
    }
    if (url.pathname.endsWith('/logout')) { revoked = true; return new Response(null, { status: 204 }); }
    throw new Error('Unexpected Auth endpoint: ' + url.pathname);
  }
  return { authFetch, calls, token, accessA, cloudRows, members,
    setOutage(value) { outage = value; }, setWriteFailure(value) { failWrites = value; } };
}
