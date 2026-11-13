import lojas from './lojas.json' with { type: 'json' };

export const recordId = /^[A-Za-z0-9_-]{1,100}$/;
const storeNames = new Set(lojas.map(loja => loja.nome));
export function validateChanges(changes) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 200) return false;
  const ids = new Set();
  return changes.every(change => {
    const p = change?.payload;
    if (!recordId.test(change?.id || '') || ids.has(change.id) || !Number.isSafeInteger(change.expectedVersion) || change.expectedVersion < 0 || change.expectedVersion > 999999999999999) return false;
    ids.add(change.id);
    if (!p || typeof p !== 'object' || Array.isArray(p) || p.id !== change.id || !storeNames.has(p.loja)) return false;
    if (!['CARGA SECA', 'HORTI', 'FRIOS', 'CONGELADOS'].includes(p.tipo) || (p.grupoConjugado != null && !recordId.test(p.grupoConjugado))) return false;
    if (!Array.isArray(p.paletes) || p.paletes.length < 1 || p.paletes.length > 200 || !Array.isArray(p.conferidos)) return false;
    if (!p.paletes.every(palete => Array.isArray(palete?.notas) && palete.notas.length > 0 && palete.notas.length <= 1000 && palete.notas.every(n => typeof n === 'string' && n.trim() && n.length <= 120))) return false;
    if (new Set(p.conferidos).size !== p.conferidos.length || !p.conferidos.every(n => Number.isInteger(n) && n >= 1 && n <= p.paletes.length)) return false;
    return Buffer.byteLength(JSON.stringify(p)) <= 250000;
  });
}

export async function membership(client, userId) {
  const { data, error } = await client.from('romaneio_members').select('workspace_id,access_role').eq('user_id', userId).eq('active', true).maybeSingle();
  if (error) throw new Error('Membership unavailable');
  return data;
}

export async function listRomaneios(client, member, after = '') {
  let query = client.from('romaneios').select('id,payload,version,updated_at').eq('workspace_id', member.workspace_id).order('id').limit(101);
  if (after) query = query.gt('id', after);
  const { data, error } = await query;
  if (error) throw new Error('Data unavailable');
  const rows = []; let bytes = 0;
  for (const row of data.slice(0, 100)) {
    const size = Buffer.byteLength(JSON.stringify(row));
    if (rows.length && bytes + size > 3 * 1024 * 1024) break;
    rows.push(row); bytes += size;
  }
  return { rows, next: data.length > rows.length ? rows.at(-1).id : null, canWrite: member.access_role !== 'viewer' };
}
