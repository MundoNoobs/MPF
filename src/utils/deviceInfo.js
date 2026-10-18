// Identificación del dispositivo para enviarla al servidor (IP local + MAC).
// Limitación: Android/WebView no permite leer la MAC real desde JS. Se envía un
// identificador estable; si el usuario configura una MAC, se envía esa. Si no,
// el servidor la resuelve por ARP cuando está en la misma red local.

const K_ID = 'sync_device_id';
const K_MAC = 'sync_device_mac';
const K_NAME = 'sync_device_name';

const leer = (k) => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const escribir = (k, v) => {
  try { localStorage.setItem(k, v); } catch (e) { console.warn('[deviceInfo] localStorage no disponible', e); }
};

export function getDeviceId() {
  let id = leer(K_ID);
  if (!id) {
    try {
      id = crypto.randomUUID();
    } catch {
      id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
    escribir(K_ID, id);
  }
  return id;
}

export function normalizarMac(mac) {
  const limpio = String(mac || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  return limpio.length === 12 ? limpio.match(/.{2}/g).join(':') : '';
}

export function getConfiguredMac() {
  return normalizarMac(leer(K_MAC));
}

export function setConfiguredMac(mac) {
  const n = normalizarMac(mac);
  if (mac && !n) throw new Error('MAC inválida. Formato: AA:BB:CC:DD:EE:FF');
  escribir(K_MAC, n);
  return n;
}

export function getDeviceName() {
  return leer(K_NAME) || (navigator.userAgent || 'dispositivo').slice(0, 60);
}

/** Obtiene la IP local vía WebRTC (best effort, con timeout). Nunca lanza. */
export function getLocalIp(timeoutMs = 1500) {
  return new Promise((resolve) => {
    let pc;
    let listo = false;
    const fin = (ip) => {
      if (listo) return;
      listo = true;
      clearTimeout(t);
      try { pc?.close(); } catch { /* ignorar */ }
      resolve(ip);
    };
    const t = setTimeout(() => fin(''), timeoutMs);
    try {
      if (typeof RTCPeerConnection === 'undefined') return fin('');
      pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('x');
      pc.onicecandidate = (e) => {
        const m = e?.candidate?.candidate?.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
        if (m && m[1] !== '0.0.0.0') fin(m[1]);
      };
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => fin(''));
    } catch {
      fin('');
    }
  });
}

/** Cabeceras de identificación para cada petición. */
export async function getDeviceHeaders() {
  const headers = { 'X-Device-Id': getDeviceId(), 'X-Device-Name': encodeURIComponent(getDeviceName()) };
  try {
    const mac = getConfiguredMac();
    if (mac) headers['X-Device-Mac'] = mac;
    const ip = await getLocalIp();
    if (ip) headers['X-Device-Local-Ip'] = ip;
  } catch (e) {
    console.warn('[deviceInfo] no se pudieron obtener todos los identificadores', e);
  }
  return headers;
}
