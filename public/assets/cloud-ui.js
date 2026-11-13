(() => {
  const app = window.RomaneioApp;
  const cloud = new window.RomaneioCloud();
  const key = app.key;
  let ready = false, busy = false, editing = false, initializing = false;
  let unsent;
  const status = document.getElementById('cloud-status');
  const refreshButton = document.getElementById('cloud-refresh');
  const draftButton = document.getElementById('cloud-draft');
  const legacyButton = document.getElementById('cloud-legacy');
  const say = message => { status.textContent = message; };
  function stored(name) { try { return localStorage.getItem(name); } catch { return null; } }
  function cache() { try { localStorage.setItem(key, JSON.stringify(app.records())); return true; } catch { return false; } }
  function download(json, filename) {
    const uri = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = uri; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(uri), 1000);
  }
  const messages = {
    access_denied: 'Sua conta ainda não foi autorizada para os dados do ROMANEIO.',
    read_only: 'Sua conta tem acesso somente para consulta.',
    version_conflict: 'Outro aparelho alterou o romaneio. Recarregue os dados antes de continuar.',
    batch_too_large: 'Importe no máximo 200 romaneios por vez.',
    payload_too_large: 'Este envio excede 2 MB. Divida o backup em arquivos menores.',
    invalid_data: 'Os dados não passaram na validação. Confira o backup e os campos obrigatórios.',
    unauthenticated: 'Sua sessão expirou. Entre novamente no aplicativo.'
  };
  const message = error => messages[error.message] || 'Não foi possível confirmar a gravação no Supabase. Verifique a conexão.';
  function replace(records) { app.replace(records); cache(); app.refreshView(); }
  function block(value) {
    busy = value;
    document.getElementById('app').inert = value || !ready;
    refreshButton.disabled = value;
    document.body.style.cursor = value ? 'progress' : '';
  }
  async function initialize() {
    if (initializing || busy) return;
    initializing = true; block(true); say('Carregando dados do Supabase…');
    document.getElementById('app').textContent = 'Carregando romaneios…';
    try {
      // Preserve v46 device data once, before replacing its cache with shared data.
      const old = stored(key);
      if (old && old !== '[]' && !stored(key + ':cloud-enabled') && !stored(key + ':pre-cloud-backup')) localStorage.setItem(key + ':pre-cloud-backup', old);
      const rows = await cloud.load();
      ready = true; app.replace(rows); cache(); app.start();
      try { localStorage.setItem(key + ':cloud-enabled', '1'); } catch { /* cloud data remains authoritative */ }
      legacyButton.hidden = !stored(key + ':pre-cloud-backup');
      draftButton.hidden = !stored(key + ':unconfirmed') && !unsent;
      say(cloud.canWrite ? 'Conectado ao Supabase · dados compartilhados' : 'Supabase · somente consulta');
    } catch (error) {
      ready = false; say(message(error));
      document.getElementById('app').textContent = message(error) + ' Use “Atualizar dados” para tentar novamente.';
    } finally { initializing = false; block(false); }
  }
  async function refresh(force = false) {
    if (!ready) return initialize();
    if (busy || initializing) return;
    if (!force && (editing || app.activeWork() || document.hidden)) return;
    if (force && (editing || app.activeWork()) && !confirm('Recarregar os dados da nuvem? Campos ainda não salvos nesta tela serão descartados.')) return;
    block(true);
    try { replace(await cloud.load()); editing = false; say('Atualizado no Supabase · ' + new Date().toLocaleTimeString('pt-BR')); }
    catch (error) { say(message(error)); }
    finally { block(false); }
  }
  async function save(records) {
    if (!ready || busy) return false;
    block(true); say('Salvando no Supabase…');
    try {
      await cloud.save(records);
      const cached = cache(); editing = false;
      say(cached ? 'Salvo no Supabase ✓' : 'Salvo no Supabase ✓ · cópia local indisponível');
      return true;
    } catch (error) {
      unsent = { versao: 1, exportado: new Date().toISOString(), cargas: JSON.parse(JSON.stringify(records)) };
      try { localStorage.setItem(key + ':unconfirmed', JSON.stringify(unsent)); } catch { /* download can still use the in-memory copy */ }
      draftButton.hidden = false;
      // Restore the last confirmed state. Never report success or print an unsaved load.
      replace(cloud.snapshot());
      say(message(error));
      alert(message(error) + ' A tentativa foi preservada em “Baixar alteração não confirmada”.');
      return false;
    } finally { block(false); }
  }
  refreshButton.addEventListener('click', () => void refresh(true));
  draftButton.addEventListener('click', () => download(unsent ? JSON.stringify(unsent, null, 2) : stored(key + ':unconfirmed'), 'romaneio-alteracao-nao-confirmada.json'));
  legacyButton.addEventListener('click', () => download(JSON.stringify({ versao: 1, exportado: new Date().toISOString(), cargas: JSON.parse(stored(key + ':pre-cloud-backup') || '[]') }, null, 2), 'romaneio-dados-anteriores.json'));
  for (const event of ['click', 'submit']) document.addEventListener(event, e => {
    if ((!ready || busy) && e.target.closest?.('main,nav')) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  for (const event of ['input', 'change']) document.addEventListener(event, e => { if (e.target.closest?.('main')) editing = true; });
  // Poll without discarding a form, an active receipt/camera or a pending save.
  setInterval(() => void refresh(), 15000);
  window.addEventListener('focus', () => void refresh());
  window.RomaneioSync = { save, refresh, resetEditing() { editing = false; }, get ready() { return ready; }, get busy() { return busy; } };
  window.romaneioCloudReady = initialize();
})();
