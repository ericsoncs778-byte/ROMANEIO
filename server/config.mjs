// Publishable key: public by design. Never add a service_role/secret key here.
export const supabaseUrl = 'https://ddhirpnnuyflxnwszuqp.supabase.co';
export const supabasePublishableKey = 'sb_publishable_-Dd9mvvirA5i00WNxaVxqg_0LISrR6Y';
export const pages = ['inicio', 'cd', 'loja', 'painel', 'documentos', 'backup'];
export function safeNext(value) {
  return pages.some(page => value === `/app/${page}`) ? value : '/app/inicio';
}
