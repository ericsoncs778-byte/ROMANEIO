import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from './app.mjs';

export function createAppServer(options) {
  const handler = createHandler(options);
  const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
  return createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/assets/') && req.method === 'GET') {
      const file = resolve(publicRoot, '.' + pathname);
      if (!file.startsWith(resolve(publicRoot) + sep)) { res.writeHead(404).end(); return; }
      try {
        const data = await readFile(file);
        const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/plain';
        res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
        res.end(data);
      } catch { res.writeHead(404).end(); }
      return;
    }
    await handler(req, res);
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createAppServer().listen(port, '127.0.0.1', () => console.log(`ROMANEIO disponível em http://localhost:${port}/login`));
}
