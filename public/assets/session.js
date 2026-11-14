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
  function connectionIssue() {
    hide();
    let notice = document.getElementById('session-retry');
    if (!notice) {
      notice = document.createElement('section'); notice.id = 'session-retry';
      notice.setAttribute('role', 'alert');
      notice.style.cssText = 'visibility:visible;position:fixed;inset:0;z-index:99999;background:#f2f6f3;display:grid;place-content:center;padding:24px;text-align:center;gap:16px';
      const message = document.createElement('p'); message.textContent = 'Não foi possível verificar a conexão. Seus dados em edição continuam preservados.';
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Tentar novamente'; retry.addEventListener('click', () => void validate());
      notice.append(message, retry); document.body.append(notice);
    }
  }
  async function validate() {
    if (leaving) return;
    if (checking) return checking;
    checking = (async () => {
      try {
        const response = await fetch('/auth/session', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (response.status === 401 || response.status === 403) return login();
        if (!response.ok) return connectionIssue();
        const user = await response.json();
        if (user.id !== userId) return login();
        document.getElementById('session-retry')?.remove();
        document.documentElement.style.visibility = '';
      } catch { connectionIssue(); }
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
