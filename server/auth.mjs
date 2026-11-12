import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { supabaseUrl, supabasePublishableKey } from './config.mjs';

// A new client per HTTP request: never share one user's session with another.
export function authForRequest(req, res, authFetch = fetch) {
  const secure = process.env.VERCEL === '1' || Boolean(req.socket.encrypted);
  const cookies = new Map(parseCookieHeader(req.headers.cookie || '').map(c => [c.name, c.value]));
  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookieOptions: { httpOnly: true, secure, sameSite: 'lax', path: '/' },
    global: {
      fetch: (url, options = {}) => authFetch(url, {
        ...options,
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000)
      })
    },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll(values, cacheHeaders = {}) {
        const outgoing = new Map((res.getHeader('Set-Cookie') || []).map(value => [value.split('=')[0], value]));
        for (const { name, value, options } of values) {
          cookies.set(name, value);
          outgoing.set(name, serializeCookieHeader(name, value, {
            ...options, httpOnly: true, secure, sameSite: 'lax', path: '/'
          }));
        }
        res.setHeader('Set-Cookie', [...outgoing.values()]);
        for (const [name, value] of Object.entries(cacheHeaders)) res.setHeader(name, value);
      }
    }
  });
}

export async function verifiedUser(client) {
  // getSession alone trusts browser-supplied cookie contents; getUser verifies with Auth.
  const { data, error } = await client.auth.getUser();
  if (error && !['AuthSessionMissingError'].includes(error.name) &&
      (!error.status || error.status >= 500)) throw new Error('Auth unavailable');
  const user = data?.user;
  return !error && user?.email_confirmed_at && !user.is_anonymous ? user : null;
}
