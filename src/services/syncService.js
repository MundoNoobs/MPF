import axios from 'axios';
import { getDeviceHeaders } from '../utils/deviceInfo';
import { validateDb } from '../../shared/dbSchema.js';

const K_DB = 'sync_local_db';
const K_META = 'sync_local_meta';
const K_URL = 'sync_server_url';
const TIMEOUT_MS = 15000;
const MAX_REINTENTOS = 3;

export class SyncError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.details = details;
  }
}

export function getServerUrl() {
  try {
    const guardada = localStorage.getItem(K_URL);
    if (guardada) return guardada.replace(/\/+$/, '');
  } catch { /* ignorar */ }
  return `http://${window.location.hostname}:3002`;
}

export function setServerUrl(url) {
  const limpia = String(url || '').trim().replace(/\/+$/, '');
  if (limpia && !/^https?:\/\/[^\s/]+/i.test(limpia)) throw new SyncError('URL inválida (ej: http://192.168.1.10:3002)', 'BAD_URL');
  try {
    if (limpia) localStorage.setItem(K_URL, limpia);
    else localStorage.removeItem(K_URL);
  } catch (e) {
    throw new SyncError(`No se pudo guardar la URL: ${e.message}`, 'STORAGE_ERROR');
  }
}

export function getLocalMeta() {
  try {
    return JSON.parse(localStorage.getItem(K_META)) || null;
  } catch {
    return null;
  }
}

/** Lee y valida la BD local. Si está corrupta lanza SyncError. */
export function readLocalDb() {
  let texto;
  try {
    texto = localStorage.getItem(K_DB);
  } catch (e) {
    throw new SyncError(`No se pudo acceder al almacenamiento: ${e.message}`, 'STORAGE_ERROR');
  }
  if (!texto) throw new SyncError('No hay base de datos local. Descarga la BD primero.', 'NO_LOCAL_DB');
  let data;
  try {
    data = JSON.parse(texto);
  } catch {
    throw new SyncError('La base de datos local está corrupta (JSON inválido). Vuelve a descargarla.', 'LOCAL_CORRUPT');
  }
  const { valid, errors } = validateDb(data);
  if (!valid) throw new SyncError('La base de datos local no cumple el esquema.', 'LOCAL_INVALID', errors);
  return data;
}

/** Guarda una BD modificada localmente (tras validarla). */
export function saveLocalDb(data) {
  const { valid, errors } = validateDb(data);
  if (!valid) throw new SyncError('No se guardó: la BD no cumple el esquema.', 'LOCAL_INVALID', errors);
  try {
    localStorage.setItem(K_DB, JSON.stringify(data));
    const prev = getLocalMeta() || {};
    localStorage.setItem(K_META, JSON.stringify({ ...prev, modificadoLocal: new Date().toISOString() }));
  } catch (e) {
    throw new SyncError(`No hay espacio o acceso al almacenamiento: ${e.message}`, 'STORAGE_ERROR');
  }
}

function traducirError(err) {
  if (err instanceof SyncError) return err;
  if (axios.isAxiosError(err)) {
    if (err.code === 'ECONNABORTED') return new SyncError('Tiempo de espera agotado. Revisa tu conexión.', 'TIMEOUT');
    if (!err.response) return new SyncError(`Sin conexión con el servidor (${getServerUrl()}).`, 'NETWORK');
    const d = err.response.data;
    return new SyncError(d?.message || `Error del servidor (${err.response.status})`, d?.code || `HTTP_${err.response.status}`, d?.details);
  }
  return new SyncError(err?.message || 'Error desconocido', 'UNKNOWN');
}

const esReintentable = (e) => e.code === 'TIMEOUT' || e.code === 'NETWORK' || /^HTTP_5/.test(e.code) || e.code === 'INTERNAL_ERROR';

/** Petición con cabeceras de dispositivo, timeout y reintentos con backoff exponencial. */
async function solicitar(config) {
  let ultimo;
  for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
    try {
      const headers = { ...(await getDeviceHeaders()), ...(config.headers || {}) };
      return await axios({ timeout: TIMEOUT_MS, ...config, headers, baseURL: getServerUrl() });
    } catch (err) {
      ultimo = traducirError(err);
      console.error(`[sync] intento ${intento}/${MAX_REINTENTOS} falló:`, ultimo.code, ultimo.message);
      if (!esReintentable(ultimo) || intento === MAX_REINTENTOS) break;
      await new Promise((r) => setTimeout(r, 800 * 2 ** (intento - 1)));
    }
  }
  throw ultimo;
}

export async function descargarDb() {
  const res = await solicitar({ method: 'GET', url: '/api/db', responseType: 'text', transformResponse: (r) => r });
  let data;
  try {
    data = JSON.parse(res.data);
  } catch {
    throw new SyncError('El servidor envió un db.json con sintaxis inválida. No se sobrescribió la copia local.', 'REMOTE_CORRUPT');
  }
  const { valid, errors } = validateDb(data);
  if (!valid) throw new SyncError('El db.json recibido no cumple el esquema. No se sobrescribió la copia local.', 'REMOTE_INVALID', errors);
  const version = res.headers?.['x-db-version'] || null;
  try {
    localStorage.setItem(K_DB, JSON.stringify(data));
    localStorage.setItem(K_META, JSON.stringify({ version, descargadoEn: new Date().toISOString() }));
  } catch (e) {
    throw new SyncError(`No se pudo guardar en el dispositivo: ${e.message}`, 'STORAGE_ERROR');
  }
  return { version, data };
}

export async function subirDb({ modo = 'replace', forzar = false } = {}) {
  const db = readLocalDb();
  const meta = getLocalMeta();
  const params = {};
  if (modo === 'merge') params.mode = 'merge';
  if (forzar) params.force = '1';
  const res = await solicitar({
    method: 'POST',
    url: '/api/db',
    params,
    data: { db, baseVersion: meta?.version || undefined },
    headers: { 'Content-Type': 'application/json' },
    maxBodyLength: Infinity,
  });
  try {
    localStorage.setItem(K_META, JSON.stringify({ ...(meta || {}), version: res.data?.version, subidoEn: new Date().toISOString() }));
  } catch { /* la subida ya fue exitosa */ }
  return res.data;
}

/** Consulta si el servidor pidió una actualización (broadcast). Nunca lanza. */
export async function consultarPendiente() {
  try {
    const res = await solicitar({ method: 'GET', url: '/api/sync/status', timeout: 5000 });
    return Boolean(res.data?.pendienteActualizacion);
  } catch {
    return false;
  }
}
