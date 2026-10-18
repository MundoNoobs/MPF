// Prueba de humo: arranca el servidor con una copia temporal de db.json y ejercita la API.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(os.tmpdir(), 'mpf-smoke-db.json');
fs.copyFileSync(path.join(raiz, 'db.json'), tmp);
const PORT = 3055;
const base = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['server/index.js'], { cwd: raiz, env: { ...process.env, DB_FILE: tmp, SYNC_PORT: String(PORT) }, stdio: 'ignore' });
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'X-Device-Mac': 'aa-bb-cc-dd-ee-ff', 'X-Device-Id': 'smoke', 'Content-Type': 'application/json' };
let fallos = 0;
const check = (nombre, ok, extra = '') => {
  if (!ok) fallos++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nombre} ${extra}`);
};

try {
  await pausa(1500);
  const r1 = await fetch(`${base}/api/db`, { headers: H });
  const texto = await r1.text();
  check('GET /api/db', r1.status === 200 && !!r1.headers.get('x-db-version'));

  const r2 = await fetch(`${base}/api/db`, { method: 'POST', headers: H, body: '{bad' });
  check('JSON inválido -> 400', r2.status === 400, (await r2.json()).code);

  const r3 = await fetch(`${base}/api/db`, { method: 'POST', headers: H, body: '{"caja":1}' });
  check('Esquema inválido -> 422', r3.status === 422, (await r3.json()).code);

  const r4 = await fetch(`${base}/api/db`, { method: 'POST', headers: H, body: texto });
  check('POST db válida -> 200', r4.status === 200);

  const r5 = await fetch(`${base}/api/db?mode=merge`, { method: 'POST', headers: H, body: texto });
  check('POST merge -> 200', r5.status === 200);

  const r6 = await fetch(`${base}/api/broadcast`, { method: 'POST' });
  const b = await r6.json();
  check('broadcast', r6.status === 200 && b.notificados >= 1, JSON.stringify(b));

  const st = await (await fetch(`${base}/api/sync/status`, { headers: H })).json();
  check('estado pendiente', st.pendienteActualizacion === true);

  const dev = await (await fetch(`${base}/api/devices`)).json();
  check('registro IP/MAC', dev.dispositivos.some((d) => d.mac === 'AA:BB:CC:DD:EE:FF'), JSON.stringify(dev.dispositivos[0]?.key));

  const r7 = await fetch(`${base}/`);
  check('dashboard HTML', r7.status === 200);
  const r8 = await fetch(`${base}/nada`);
  check('404 controlado', r8.status === 404);
} catch (e) {
  fallos++;
  console.error('Excepción en la prueba', e);
} finally {
  srv.kill();
  console.log(fallos ? `${fallos} fallo(s)` : 'Todo OK');
  process.exit(fallos ? 1 : 0);
}
