export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

export function loginPage({ next = '/app/inicio', error = '' } = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#08743d">
<title>Entrar · ROMANEIO Hiperideal</title><link rel="stylesheet" href="/assets/auth.css"></head>
<body><main class="login"><section class="intro"><div class="brand">H<span>HIPERIDEAL</span></div>
<div><p class="eyebrow">LOGÍSTICA INTEGRADA</p><h1>Da expedição<br>à conferência.</h1><p>Uma operação conectada começa com um acesso seguro.</p></div>
<div class="steps"><span>01 · CD</span><span>02 · LOJA</span><span>03 · GESTÃO</span></div></section>
<section class="access"><div class="access-inner"><p class="eyebrow">ROMANEIO DIGITAL</p><h2>Acesse sua conta</h2>
<p class="muted">Use seu e-mail e sua senha do aplicativo.</p>
${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ''}
<form method="post" action="/auth/login"><input type="hidden" name="next" value="${escapeHtml(next)}">
<label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="username" placeholder="seu.email@hiperideal.com.br" maxlength="254" required>
<label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="1024" required>
<button type="submit">Entrar no ROMANEIO <span aria-hidden="true">→</span></button></form>
<p class="help">Ainda não possui acesso ou esqueceu sua senha? Solicite ao administrador do ROMANEIO.</p>
<small>Hiperideal · Acesso autenticado pelo Supabase</small></div></section></main></body></html>`;
}

export function unavailablePage() {
  return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acesso indisponível</title><body><h1>Não foi possível validar seu acesso.</h1><p>Verifique a conexão e tente novamente.</p><a href="/login">Voltar ao login</a></body></html>';
}
