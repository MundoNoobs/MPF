import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { CONFIG, BACKUP_DIR } from '../config.js';
import { validateDb, mergeDb } from '../../shared/dbSchema.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// Cola de exclusión mutua: serializa lecturas/escrituras para evitar corrupción.
let cola = Promise.resolve();
function exclusivo(tarea) {
  const siguiente = cola.then(tarea, tarea);
  cola = siguiente.catch(() => {});
  return siguiente;
}

const hash = (texto) => crypto.createHash('sha256').update(texto).digest('hex');

async function leerTexto() {
  try {
    return await fs.readFile(CONFIG.dbFile, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new AppError(404, 'DB_NOT_FOUND', 'No existe db.json en el servidor');
    throw new AppError(500, 'DB_READ_ERROR', `No se pudo leer db.json: ${err.message}`);
  }
}

async function leerValidada() {
  const texto = await leerTexto();
  let data;
  try {
    data = JSON.parse(texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto);
  } catch (err) {
    throw new AppError(500, 'DB_CORRUPT', `db.json del servidor tiene sintaxis inválida: ${err.message}`);
  }
  return { data, texto };
}

async function respaldar(texto) {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const nombre = `db-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await fs.writeFile(path.join(BACKUP_DIR, nombre), texto, 'utf8');
    const archivos = (await fs.readdir(BACKUP_DIR)).filter((f) => f.startsWith('db-')).sort();
    const sobrantes = archivos.slice(0, Math.max(0, archivos.length - CONFIG.maxBackups));
    await Promise.all(sobrantes.map((f) => fs.unlink(path.join(BACKUP_DIR, f)).catch(() => {})));
  } catch (err) {
    logger.warn('No se pudo crear el respaldo de db.json (se continúa)', err.message);
  }
}

async function escribirAtomico(texto) {
  const tmp = `${CONFIG.dbFile}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, texto, 'utf8');
    // Verificación de relectura antes de reemplazar
    JSON.parse(await fs.readFile(tmp, 'utf8'));
    await fs.rename(tmp, CONFIG.dbFile);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw new AppError(500, 'DB_WRITE_ERROR', `No se pudo guardar db.json: ${err.message}`);
  }
}

export const dbStore = {
  /** Devuelve { data, version } de la BD central. */
  leer() {
    return exclusivo(async () => {
      const { data, texto } = await leerValidada();
      const { valid, errors } = validateDb(data);
      if (!valid) logger.warn('db.json central no cumple el esquema', errors);
      return { data, version: hash(texto), texto };
    });
  },

  async version() {
    const { version } = await this.leer();
    return version;
  },

  /**
   * Recibe una BD entrante. mode: 'replace' | 'merge'.
   */
  guardar(entrante, mode = 'replace') {
    return exclusivo(async () => {
      const { valid, errors } = validateDb(entrante);
      if (!valid) throw new AppError(422, 'SCHEMA_INVALID', 'db.json no cumple el esquema esperado', errors);

      let final = entrante;
      let textoActual = null;
      try {
        const actual = await leerValidada();
        textoActual = actual.texto;
        if (mode === 'merge') final = mergeDb(actual.data, entrante);
      } catch (err) {
        if (!(err instanceof AppError) || err.code === 'DB_READ_ERROR') throw err;
        logger.warn(`BD central no disponible (${err.code}); se usará la entrante`);
      }

      const validacionFinal = validateDb(final);
      if (!validacionFinal.valid) {
        throw new AppError(422, 'MERGE_INVALID', 'El resultado de la fusión no es válido', validacionFinal.errors);
      }

      if (textoActual) await respaldar(textoActual);
      const texto = JSON.stringify(final, null, 2);
      await escribirAtomico(texto);
      const version = hash(texto);
      logger.info(`db.json actualizado (modo=${mode}, versión=${version.slice(0, 8)})`);
      return { version, mode };
    });
  },
};
