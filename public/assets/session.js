(() => {
  'use strict';
  const { userId, email } = window.ROMANEIO_CONTEXT;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('romaneio-auth') : null;
  let checking;
  let leaving = false;
  const hide = () => { document.documentElement.style.visibility = 'hidden'; };
  const login = () => {
    leaving = true;
    hide();
    location.replace('/login?next=' + encodeURIComponent(location.pathname));
  };
  async function validate() {
    if (leaving) return;
    if (checking) return checking;
    checking = (async () => {
      try {
        const response = await fetch('/auth/session', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) return login();
        const user = await response.json();
        if (user.id !== userId) return login();
        document.documentElement.style.visibility = '';
      } catch { login(); }
      finally { checking = undefined; }
    })();
    return checking;
  }
  document.getElementById('auth-email').textContent = email;
  document.getElementById('logout-form').addEventListener('submit', async event => {
    event.preventDefault();
    leaving = true;
    hide();
    try {
      const response = await fetch('/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '', redirect: 'manual' });
      // A same-origin manual redirect can be exposed as an opaque redirect in browsers.
      if (response.status !== 303 && response.type !== 'opaqueredirect') throw new Error('Logout unavailable');
      channel?.postMessage('logout');
      location.replace('/login');
    } catch {
      leaving = false;
      document.documentElement.style.visibility = '';
      alert('Não foi possível encerrar a sessão. Verifique a conexão e tente novamente.');
    }
  });
  channel?.addEventListener('message', event => { if (event.data === 'logout') login(); });
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', () => { hide(); void validate(); });
  window.addEventListener('focus', () => { hide(); void validate(); });
  window.addEventListener('popstate', () => { hide(); void validate(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hide();
    else void validate();
  });
  // Server revalidation also renews expiring sessions without exposing tokens to JavaScript.
  setInterval(() => { if (!document.hidden) void validate(); }, 60000);
})();
