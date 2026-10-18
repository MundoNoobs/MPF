import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { AppError, sendJson, CORS_HEADERS } from './utils/errors.js';
import { readJsonBody } from './utils/body.js';
import { dbStore } from './services/dbStore.js';
import { deviceRegistry } from './services/deviceRegistry.js';
import { validateDb } from '../shared/dbSchema.js';

const PUBLIC_DIR = path.dirname(CONFIG.dashboardFile);

async function servirEstatico(res, archivo, tipo) {
  let contenido;
  try {
    contenido = await fs.readFile(path.join(PUBLIC_DIR, archivo), 'utf8');
  } catch (err) {
    throw new AppError(500, 'STATIC_MISSING', `No se pudo cargar ${archivo}: ${err.message}`);
  }
  res.writeHead(200, { 'Content-Type': `${tipo}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(contenido);
}

export const controladores = {
  async health(req, res) {
    sendJson(res, 200, { ok: true, time: new Date().toISOString() });
  },

  async dashboard(req, res) {
    await servirEstatico(res, 'index.html', 'text/html');
  },

  async dashboardJs(req, res) {
    await servirEstatico(res, 'dashboard.js', 'application/javascript');
  },

  async descargarDb(req, res, ctx) {
    const { texto, version } = await dbStore.leer();
    if (ctx.device) deviceRegistry.marcarSync(ctx.device.key, 'descarga');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(texto),
      'Content-Disposition': 'attachment; filename="db.json"',
      'Cache-Control': 'no-store',
      'X-DB-Version': version,
      ...CORS_HEADERS,
    });
    res.end(texto);
  },

  async recibirDb(req, res, ctx) {
    const cuerpo = await readJsonBody(req);
    // Acepta { db, baseVersion } o directamente el contenido de db.json
    const envuelto = Boolean(cuerpo && typeof cuerpo === 'object' && cuerpo.db && !Array.isArray(cuerpo.db));
    const entrante = envuelto ? cuerpo.db : cuerpo;
    const modo = ctx.url.searchParams.get('mode') === 'merge' ? 'merge' : 'replace';

    if (envuelto && typeof cuerpo.baseVersion === 'string' && modo === 'replace') {
      const actual = await dbStore.version().catch(() => null);
      if (actual && actual !== cuerpo.baseVersion && ctx.url.searchParams.get('force') !== '1') {
        throw new AppError(
          409,
          'VERSION_CONFLICT',
          'El servidor tiene una versión más nueva. Descarga la BD o envía en modo fusión.',
          { actual },
        );
      }
    }

    const resultado = await dbStore.guardar(entrante, modo);
    if (ctx.device) deviceRegistry.marcarSync(ctx.device.key, 'subida');
    sendJson(res, 200, { ok: true, ...resultado }, { 'X-DB-Version': resultado.version });
  },

  async estadoSync(req, res, ctx) {
    const version = await dbStore.version();
    const lista = await deviceRegistry.listar();
    const yo = ctx.device ? lista.find((d) => d.key === ctx.device.key) : null;
    sendJson(res, 200, {
      ok: true,
      version,
      pendienteActualizacion: Boolean(yo?.pendienteActualizacion),
      device: yo ? { ip: yo.ip, mac: yo.mac } : null,
    });
  },

  async listarDispositivos(req, res) {
    const dispositivos = await deviceRegistry.listar();
    let version = null;
    try {
      version = await dbStore.version();
    } catch (err) {
      logger.warn('No se pudo calcular la versión de la BD para el dashboard', err.message);
    }
    sendJson(res, 200, { ok: true, total: dispositivos.length, version, dispositivos });
  },

  async difundir(req, res) {
    await dbStore.leer(); // falla si la BD central no es legible
    const notificados = await deviceRegistry.difundir();
    const version = await dbStore.version();
    logger.info(`Difusión masiva: ${notificados} dispositivo(s) notificados`);
    sendJson(res, 200, { ok: true, notificados, version });
  },

  async eliminarDispositivo(req, res, ctx, key) {
    const ok = await deviceRegistry.eliminar(decodeURIComponent(key));
    if (!ok) throw new AppError(404, 'DEVICE_NOT_FOUND', 'Dispositivo no encontrado');
    sendJson(res, 200, { ok: true });
  },

  async validarDb(req, res) {
    const cuerpo = await readJsonBody(req);
    sendJson(res, 200, { ok: true, ...validateDb(cuerpo) });
  },
};
