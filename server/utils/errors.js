import { logger } from './logger.js';

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, X-Device-Id, X-Device-Mac, X-Device-Name, X-Device-Local-Ip',
  'Access-Control-Expose-Headers': 'X-DB-Version',
  'Access-Control-Max-Age': '600',
};

export function sendJson(res, status, payload, extraHeaders = {}) {
  if (res.headersSent || res.writableEnded) return;
  let cuerpo;
  try {
    cuerpo = JSON.stringify(payload);
  } catch (err) {
    logger.error('sendJson: payload no serializable', err);
    status = 500;
    cuerpo = JSON.stringify({ ok: false, code: 'SERIALIZE_ERROR', message: 'Error al serializar la respuesta' });
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo),
    'Cache-Control': 'no-store',
    ...CORS_HEADERS,
    ...extraHeaders,
  });
  res.end(cuerpo);
}

/** Middleware final de errores: traduce cualquier excepción a una respuesta JSON segura. */
export function handleError(err, req, res) {
  try {
    if (err instanceof AppError) {
      logger.warn(`${req.method} ${req.url} -> ${err.status} ${err.code}: ${err.message}`, err.details);
      sendJson(res, err.status, { ok: false, code: err.code, message: err.message, details: err.details });
      return;
    }
    logger.error(`${req.method} ${req.url} -> excepción no controlada`, err);
    sendJson(res, 500, { ok: false, code: 'INTERNAL_ERROR', message: 'Error interno del servidor' });
  } catch (fatal) {
    logger.error('handleError falló', fatal);
    try {
      res.destroy();
    } catch {
      /* nada más que hacer */
    }
  }
}
