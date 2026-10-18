import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { CONFIG, DATA_DIR } from '../config.js';
import { logger } from '../utils/logger.js';

const MAC_REGEX = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
const IP_REGEX = /^[0-9a-f:.]{3,45}$/i;

export function normalizarIp(ip) {
  if (typeof ip !== 'string') return '';
  let valor = ip.split(',')[0].trim();
  if (valor.startsWith('::ffff:')) valor = valor.slice(7);
  if (valor === '::1') valor = '127.0.0.1';
  return IP_REGEX.test(valor) ? valor : '';
}

export function normalizarMac(mac) {
  if (typeof mac !== 'string') return '';
  const limpio = mac.trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  if (limpio.length !== 12) return '';
  const formato = limpio.match(/.{2}/g).join(':');
  return MAC_REGEX.test(formato) ? formato : '';
}

// ---- Resolución de MAC por tabla ARP (solo funciona en la misma red local) ----
let arpCache = { ts: 0, tabla: new Map() };

function leerArp() {
  return new Promise((resolve) => {
    try {
      execFile('arp', ['-a'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
        const tabla = new Map();
        if (!err && typeof stdout === 'string') {
          for (const linea of stdout.split(/\r?\n/)) {
            const m = linea.match(/(\d{1,3}(?:\.\d{1,3}){3}).*?([0-9a-f]{2}(?:[:-][0-9a-f]{2}){5})/i);
            if (m) {
              const mac = normalizarMac(m[2]);
              if (mac && mac !== 'FF:FF:FF:FF:FF:FF') tabla.set(m[1], mac);
            }
          }
        }
        resolve(tabla);
      });
    } catch {
      resolve(new Map());
    }
  });
}

async function macDesdeArp(ip) {
  if (Date.now() - arpCache.ts > CONFIG.arpCacheMs) {
    arpCache = { ts: Date.now(), tabla: await leerArp() };
  }
  return arpCache.tabla.get(ip) || '';
}

// ---- Persistencia ----
const dispositivos = new Map();
let cargado = false;
let escritura = Promise.resolve();

async function cargar() {
  if (cargado) return;
  cargado = true;
  try {
    const lista = JSON.parse(await fs.readFile(CONFIG.devicesFile, 'utf8'));
    if (Array.isArray(lista)) {
      for (const d of lista) if (d && d.key) dispositivos.set(d.key, d);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn('devices.json ilegible; se inicia vacío', err.message);
  }
}

function persistir() {
  escritura = escritura
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tmp = path.join(DATA_DIR, 'devices.json.tmp');
      await fs.writeFile(tmp, JSON.stringify([...dispositivos.values()], null, 2), 'utf8');
      await fs.rename(tmp, CONFIG.devicesFile);
    })
    .catch((err) => logger.error('No se pudo guardar devices.json', err));
  return escritura;
}

function ipDeSocket(req) {
  const fwd = req.headers['x-forwarded-for'];
  return normalizarIp(typeof fwd === 'string' ? fwd : '') || normalizarIp(req.socket?.remoteAddress || '');
}

export const deviceRegistry = {
  /** Middleware: identifica el dispositivo (IP + MAC) y lo registra. Nunca lanza. */
  async identificar(req) {
    try {
      await cargar();
      const ip = ipDeSocket(req);
      const h = req.headers;
      let mac = normalizarMac(String(h['x-device-mac'] || ''));
      let macOrigen = mac ? 'cliente' : '';
      if (!mac && ip) {
        mac = await macDesdeArp(ip);
        if (mac) macOrigen = 'arp';
      }
      const deviceId = String(h['x-device-id'] || '').slice(0, 64).replace(/[^\w.-]/g, '');
      let nombreRaw = String(h['x-device-name'] || '');
      try {
        nombreRaw = decodeURIComponent(nombreRaw);
      } catch {
        /* se usa tal cual */
      }
      const nombre = nombreRaw.slice(0, 80).replace(/[\r\n]/g, ' ');
      const ipLocal = normalizarIp(String(h['x-device-local-ip'] || ''));

      if (!ip && !mac) return null;
      const key = `${ip || 'sin-ip'}|${mac || 'sin-mac'}`;
      const ahora = new Date().toISOString();
      const previo = dispositivos.get(key);
      const registro = {
        key,
        ip: ip || '—',
        mac: mac || '—',
        macOrigen: macOrigen || 'desconocida',
        ipLocal: ipLocal || previo?.ipLocal || '',
        deviceId: deviceId || previo?.deviceId || '',
        nombre: nombre || previo?.nombre || '',
        userAgent: String(h['user-agent'] || '').slice(0, 200),
        primerContacto: previo?.primerContacto || ahora,
        ultimoContacto: ahora,
        contactos: (previo?.contactos || 0) + 1,
        pendienteActualizacion: previo?.pendienteActualizacion || false,
        ultimaSync: previo?.ultimaSync || null,
      };
      dispositivos.set(key, registro);
      persistir();
      return registro;
    } catch (err) {
      logger.error('Error identificando dispositivo (se continúa sin registro)', err);
      return null;
    }
  },

  marcarSync(key, campo) {
    const d = dispositivos.get(key);
    if (!d) return;
    d.ultimaSync = { tipo: campo, fecha: new Date().toISOString() };
    if (campo === 'descarga') d.pendienteActualizacion = false;
    persistir();
  },

  async listar() {
    await cargar();
    const ahora = Date.now();
    return [...dispositivos.values()]
      .map((d) => ({ ...d, online: ahora - Date.parse(d.ultimoContacto) < CONFIG.onlineWindowMs }))
      .sort((a, b) => Date.parse(b.ultimoContacto) - Date.parse(a.ultimoContacto));
  },

  /** Marca a todos los dispositivos registrados con una actualización pendiente. */
  async difundir() {
    await cargar();
    for (const d of dispositivos.values()) d.pendienteActualizacion = true;
    await persistir();
    return dispositivos.size;
  },

  async eliminar(key) {
    await cargar();
    const ok = dispositivos.delete(key);
    if (ok) await persistir();
    return ok;
  },
};
