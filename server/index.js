import http from 'node:http';
import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { AppError, handleError, CORS_HEADERS } from './utils/errors.js';
import { deviceRegistry } from './services/deviceRegistry.js';
import { controladores as c } from './controllers.js';

// ---------- Enrutador: [controlador, registrarDispositivo, parámetro] ----------
function resolverRuta(method, pathname) {
  if (method === 'GET' && pathname === '/') return [c.dashboard];
  if (method === 'GET' && pathname === '/dashboard.js') return [c.dashboardJs];
  if (method === 'GET' && pathname === '/api/health') return [c.health];
  if (method === 'GET' && pathname === '/api/db') return [c.descargarDb, true];
  if ((method === 'POST' || method === 'PUT') && pathname === '/api/db') return [c.recibirDb, true];
  if (method === 'POST' && pathname === '/api/db/validate') return [c.validarDb];
  if (method === 'GET' && pathname === '/api/sync/status') return [c.estadoSync, true];
  if (method === 'POST' && pathname === '/api/devices/register') return [c.estadoSync, true];
  if (method === 'GET' && pathname === '/api/devices') return [c.listarDispositivos];
  if (method === 'POST' && pathname === '/api/broadcast') return [c.difundir];
  const m = pathname.match(/^\/api\/devices\/([^/]+)$/);
  if (method === 'DELETE' && m) return [c.eliminarDispositivo, false, m[1]];
  return null;
}

const servidor = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const ruta = resolverRuta(req.method, url.pathname);
    if (!ruta) {
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      throw new AppError(404, 'NOT_FOUND', `Ruta no encontrada: ${req.method} ${url.pathname}`);
    }
    const [controlador, registrar, param] = ruta;
    const ctx = { url, device: null };
    // Middleware de identificación IP/MAC (solo rutas que usa la app)
    if (registrar) ctx.device = await deviceRegistry.identificar(req);
    await controlador(req, res, ctx, param);
  } catch (err) {
    handleError(err, req, res);
  }
});

servidor.requestTimeout = 60_000;
servidor.headersTimeout = 20_000;
servidor.keepAliveTimeout = 5_000;

servidor.on('clientError', (err, socket) => {
  logger.warn('clientError', err.message);
  try {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  } catch {
    /* ignorar */
  }
});

servidor.on('error', (err) => {
  logger.error('Error del servidor HTTP', err);
  if (err.code === 'EADDRINUSE') process.exit(1);
});

// Zero-crash: ninguna excepción global tumba el proceso
process.on('uncaughtException', (err) => logger.error('uncaughtException', err));
process.on('unhandledRejection', (err) =>
  logger.error('unhandledRejection', err instanceof Error ? err : new Error(String(err))),
);

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    logger.info(`${senal} recibido, cerrando servidor`);
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

servidor.listen(CONFIG.port, CONFIG.host, () => {
  logger.info(`Servidor de sincronización en http://localhost:${CONFIG.port} (db: ${CONFIG.dbFile})`);
});
