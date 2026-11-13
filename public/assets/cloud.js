(() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  class CloudStore {
    constructor(request = window.fetch.bind(window)) { this.request = request; this.baseline = new Map(); this.canWrite = false; }
    async response(url, options = {}) {
      const r = await this.request(url, { cache: 'no-store', ...options, signal: AbortSignal.timeout(20000) });
      let body; try { body = await r.json(); } catch { body = {}; }
      if (!r.ok) throw Object.assign(new Error(body.error || 'cloud_unavailable'), { status: r.status });
      return body;
    }
    async load() {
      const rows = []; const cursors = new Set(); let after = '';
      do {
        const body = await this.response('/data/romaneios' + (after ? '?after=' + encodeURIComponent(after) : ''));
        if (!Array.isArray(body.rows)) throw new Error('invalid_response');
        rows.push(...body.rows); this.canWrite = Boolean(body.canWrite);
        after = body.next;
        if (after && cursors.has(after)) throw new Error('invalid_cursor');
        cursors.add(after);
      } while (after);
      const baseline = new Map();
      for (const row of rows) {
        if (!row?.payload || row.id !== row.payload.id || !Number.isSafeInteger(row.version) || row.version < 1 || baseline.has(row.id)) throw new Error('invalid_response');
        baseline.set(row.id, clone(row));
      }
      this.baseline = baseline;
      return this.snapshot();
    }
    snapshot() { return [...this.baseline.values()].map(row => clone(row.payload)); }
    async save(records) {
      if (!this.canWrite) throw Object.assign(new Error('read_only'), { status: 403 });
      const ids = new Set(); const changes = [];
      for (const payload of clone(records)) {
        if (ids.has(payload.id)) throw new Error('duplicate_id');
        ids.add(payload.id);
        const previous = this.baseline.get(payload.id);
        if (!previous || stable(previous.payload) !== stable(payload)) changes.push({ id: payload.id, payload, expectedVersion: previous?.version || 0 });
      }
      if (!changes.length) return [];
      if (changes.length > 200) throw new Error('batch_too_large');
      const body = await this.response('/data/romaneios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) });
      if (!Array.isArray(body.rows) || body.rows.length !== changes.length) throw new Error('invalid_response');
      for (const row of body.rows) {
        if (!row?.payload || row.id !== row.payload.id || !Number.isSafeInteger(row.version) || row.version < 1 || !changes.some(change => change.id === row.id)) throw new Error('invalid_response');
      }
      for (const row of body.rows) this.baseline.set(row.id, clone(row));
      return body.rows;
    }
  }
  window.RomaneioCloud = CloudStore;
})();
