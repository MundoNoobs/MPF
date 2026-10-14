// src/utils/offlineSync.js
import dbInicial from "../../db.json";

const PC_API_URL = "http://192.168.1.119:3001";
const QUEUE_KEY = "mpf_sync_queue";
const originalFetch = window.fetch.bind(window);

// Respuesta fake 100% compatible con Android WebView
function crearRespuestaJSON(data) {
  const texto = JSON.stringify(data);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: async () => JSON.parse(texto),
    text: async () => texto,
    clone: function () {
      return crearRespuestaJSON(data);
    },
  };
}

// 1. Sembrar el db.json garantizando que no queden arrays vacíos por error
export function sembrarDatosIniciales(forzar = false) {
  if (!dbInicial) return;
  Object.keys(dbInicial).forEach((col) => {
    const key = `mpf_cache_${col}`;
    const guardado = localStorage.getItem(key);
    let invalido = false;
    try {
      const parsed = JSON.parse(guardado);
      if (!parsed || (Array.isArray(parsed) && parsed.length === 0 && dbInicial[col]?.length > 0)) {
        invalido = true;
      }
    } catch {
      invalido = true;
    }

    if (forzar || !guardado || invalido) {
      localStorage.setItem(key, JSON.stringify(dbInicial[col]));
    }
  });
}

const getQueue = () => JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
const saveQueue = (q) => {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  actualizarBarraEstado();
};

let ultimoEstadoOnline = false;
let ultimoErrorRed = "";

// 2. Comprobar servidor en PC
export async function checkPCServer() {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1500);
    const res = await originalFetch(`${PC_API_URL}/cuentas?t=${Date.now()}`, {
      method: "GET",
      mode: "cors",
      signal: controller.signal,
    });
    clearTimeout(id);
    ultimoEstadoOnline = res.ok;
    if (res.ok) ultimoErrorRed = "";
    actualizarBarraEstado();
    return res.ok;
  } catch (err) {
    ultimoEstadoOnline = false;
    ultimoErrorRed = err.message || "Sin conexión a PC";
    actualizarBarraEstado();
    return false;
  }
}

// 3. Sincronizar cola pendiente
let sincronizando = false;
export async function sincronizarColaConPC() {
  if (sincronizando) return;
  const cola = getQueue();
  if (cola.length === 0) return;

  const online = await checkPCServer();
  if (!online) return;

  sincronizando = true;
  const restantes = [...cola];

  for (const item of cola) {
    try {
      const res = await originalFetch(`${PC_API_URL}${item.path}`, {
        method: item.method,
        headers: { "Content-Type": "application/json" },
        body: item.body ? JSON.stringify(item.body) : undefined,
      });
      if (res.ok || res.status === 404) {
        restantes.shift();
        saveQueue(restantes);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  sincronizando = false;
  actualizarBarraEstado();
}

// 4. Barra visual superior para saber qué pasa en el celular
function actualizarBarraEstado() {
  let bar = document.getElementById("mpf-status-bar");
  if (!bar && document.body) {
    bar = document.createElement("div");
    bar.id = "mpf-status-bar";
    bar.style.cssText =
      "position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:6px 10px;font-size:11px;font-family:sans-serif;display:flex;justify-content:space-between;align-items:center;color:#fff;box-shadow:0 -2px 6px rgba(0,0,0,0.3);";
    document.body.appendChild(bar);
  }
  if (!bar) return;

  const pendientes = getQueue().length;
  bar.style.background = ultimoEstadoOnline ? "#15803d" : "#b91c1c";
  bar.innerHTML = `
    <span>${
      ultimoEstadoOnline
        ? `🟢 PC Conectada (192.168.1.119:3001) | Cola: ${pendientes}`
        : `🔴 Offline (${pendientes} pend.) | Usa caché local`
    }</span>
    <button id="mpf-btn-sync" style="background:#fff;color:#111;border:none;border-radius:4px;padding:3px 8px;font-weight:bold;font-size:11px;">
      🔄 Sincronizar
    </button>
  `;

  const btn = document.getElementById("mpf-btn-sync");
  if (btn) {
    btn.onclick = async () => {
      btn.innerText = "⏳...";
      const ok = await checkPCServer();
      if (!ok) {
        // Si la PC no conecta, asegura que los datos de db.json estén sembrados
        sembrarDatosIniciales(true);
      }
      window.location.reload();
    };
  }
}

// 5. Activar el interceptor global
export function activarModoOffline() {
  sembrarDatosIniciales(false);

  window.fetch = async (input, options = {}) => {
    const urlStr = typeof input === "string" ? input : input?.url || "";

    if (!urlStr.includes(":3001")) {
      return originalFetch(input, options);
    }

    // Extraer ruta después de :3001
    const partes = urlStr.split(":3001");
    const pathAndQuery = partes[1] || "/";
    const [pathname, queryString] = pathAndQuery.split("?");
    const segmentos = pathname.split("/").filter(Boolean);
    const coleccion = segmentos[0];
    const itemId = segmentos[1];
    const method = (options.method || "GET").toUpperCase();
    const cacheKey = `mpf_cache_${coleccion}`;

    // --- GET ---
    if (method === "GET") {
      const online = await checkPCServer();
      if (online) {
        await sincronizarColaConPC();
        try {
          const res = await originalFetch(`${PC_API_URL}${pathAndQuery}`);
          if (res.ok) {
            const data = await res.json();
            if (!itemId && !queryString) {
              localStorage.setItem(cacheKey, JSON.stringify(data));
            }
            return crearRespuestaJSON(data);
          }
        } catch {
          // Cae al modo offline
        }
      }

      // Leer desde memoria del teléfono o directamente desde dbInicial importado
      let raw = localStorage.getItem(cacheKey);
      let localData = [];
      try {
        localData = raw ? JSON.parse(raw) : dbInicial[coleccion] || [];
        if (Array.isArray(localData) && localData.length === 0 && dbInicial[coleccion]?.length > 0) {
          localData = dbInicial[coleccion];
          localStorage.setItem(cacheKey, JSON.stringify(localData));
        }
      } catch {
        localData = dbInicial[coleccion] || [];
      }

      if (itemId) {
        const encontrado = localData.find((x) => String(x.id) === String(itemId));
        return crearRespuestaJSON(encontrado || {});
      }

      if (queryString) {
        const params = new URLSearchParams(queryString);
        params.forEach((valor, clave) => {
          localData = localData.filter((item) => String(item[clave]) === String(valor));
        });
      }

      return crearRespuestaJSON(localData);
    }

    // --- POST, PUT, PATCH, DELETE ---
    const bodyData = options.body ? JSON.parse(options.body) : null;
    let localData = JSON.parse(
      localStorage.getItem(cacheKey) || JSON.stringify(dbInicial[coleccion] || [])
    );
    let respuestaLocal = bodyData;

    if (method === "POST") {
      respuestaLocal = { ...bodyData, id: bodyData?.id || String(Date.now()) };
      localData.push(respuestaLocal);
    } else if (method === "PUT" || method === "PATCH") {
      localData = localData.map((item) => {
        if (String(item.id) === String(itemId)) {
          respuestaLocal =
            method === "PUT" ? { ...bodyData, id: item.id } : { ...item, ...bodyData };
          return respuestaLocal;
        }
        return item;
      });
    } else if (method === "DELETE") {
      localData = localData.filter((item) => String(item.id) !== String(itemId));
      respuestaLocal = {};
    }
    localStorage.setItem(cacheKey, JSON.stringify(localData));

    const online = await checkPCServer();
    if (online) {
      await sincronizarColaConPC();
      try {
        const res = await originalFetch(`${PC_API_URL}${pathAndQuery}`, {
          ...options,
          method,
          headers: { "Content-Type": "application/json" },
          body: method !== "DELETE" ? JSON.stringify(respuestaLocal) : undefined,
        });
        if (res.ok) return crearRespuestaJSON(respuestaLocal);
      } catch {
        // Pasa a la cola
      }
    }

    const cola = getQueue();
    cola.push({
      path: pathAndQuery,
      method,
      body: method !== "DELETE" ? respuestaLocal : null,
      timestamp: Date.now(),
    });
    saveQueue(cola);

    return crearRespuestaJSON(respuestaLocal);
  };

  window.addEventListener("DOMContentLoaded", actualizarBarraEstado);
  setTimeout(actualizarBarraEstado, 1000);
  setInterval(async () => {
    const online = await checkPCServer();
    if (online && getQueue().length > 0) {
      await sincronizarColaConPC();
    }
  }, 5000);
}

activarModoOffline();