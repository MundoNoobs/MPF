import fs from 'node:fs';
import { CONFIG, DATA_DIR } from '../config.js';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
let archivoDisponible = true;

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  archivoDisponible = false;
  console.error('[logger] No se pudo crear el directorio de datos:', err.message);
}

function rotarSiHaceFalta() {
  try {
    const { size } = fs.statSync(CONFIG.logFile);
    if (size > MAX_LOG_BYTES) fs.renameSync(CONFIG.logFile, `${CONFIG.logFile}.old`);
  } catch {
    /* el archivo aún no existe */
  }
}

function serializarMeta(meta) {
  if (meta === undefined) return '';
  try {
    if (meta instanceof Error) return ` | ${meta.stack || meta.message}`;
    return ` | ${JSON.stringify(meta)}`;
  } catch {
    return ' | [meta no serializable]';
  }
}

function escribir(nivel, mensaje, meta) {
  const linea = `${new Date().toISOString()} [${nivel}] ${mensaje}${serializarMeta(meta)}`;
  try {
    (nivel === 'ERROR' ? console.error : nivel === 'WARN' ? console.warn : console.log)(linea);
  } catch {
    /* nunca romper por el logger */
  }
  if (!archivoDisponible) return;
  try {
    rotarSiHaceFalta();
    fs.appendFileSync(CONFIG.logFile, linea + '\n');
  } catch {
    archivoDisponible = false;
  }
}

export const logger = {
  info: (m, meta) => escribir('INFO', m, meta),
  warn: (m, meta) => escribir('WARN', m, meta),
  error: (m, meta) => escribir('ERROR', m, meta),
};
