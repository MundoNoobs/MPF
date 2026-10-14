// src/utils/offlineSync.js
import dbInicial from "../../db.json";

// Puedes cambiar la IP desde la misma barra de la App si tu router cambia la IP de tu PC
const DEFAULT_IP = "192.168.1.119";
const PORT = "3001";
const QUEUE_KEY = "mpf_sync_queue";
const originalFetch = window.fetch.bind(window);

function getServerUrl() {
  const ipGuardada = localStorage.getItem("mpf_server_ip") || DEFAULT_IP;
  return `http://${ipGuardada}:${PORT}`;
}

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

// 1. Sembrar todas las colecciones de db.json en localStorage
export function sembrarDatosIniciales(forzar = false) {
  if (!dbInicial) return;
  Object.keys(dbInicial).forEach((col) => {
    const key = `mpf_cache_${col}`;
    const guardado = localStorage.getItem(key);
    if (forzar || !guardado || guardado === "[]" || guardado === "null") {
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
let detalleEstado = "Verificando...";

// 2. Comprobar servidor en PC y descargar colecciones si conecta
export async function checkPCServer() {
  const urlBase = getServerUrl();
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2500);
    // Probamos la raíz de json-server
    const res = await originalFetch(`${urlBase}/db`, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(id);

    if (res.ok) {
      ultimoEstadoOnline = true;
      detalleEstado = `Conectado (${urlBase})`;
      actualizarBarraEstado();
      return true;
    } else {
      ultimoEstadoOnline = false;
      detalleEstado = `HTTP ${res.status}`;
      actualizarBarraEstado();
      return false;
    }
  } catch (err) {
    ultimoEstadoOnline = false;
    detalleEstado = err.name === "AbortError" ? "Timeout (PC no responde)" : "Bloqueo HTTP o Red";
    actualizarBarraEstado();
    return false;
  }
}

// 3. Descargar toda la base de datos fresca desde la PC al celular
async function descargarTodoDesdePC() {
  const urlBase = getServerUrl();
  try {
    const res = await originalFetch(`${urlBase}/db`, { cache: "no-store" });
    if (res.ok) {
      const dbRemota = await res.json();
      Object.keys(dbRemota).forEach((col) => {
        localStorage.setItem(`mpf_cache_${col}`, JSON.stringify(dbRemota[col]));
      });
      return true;
    }
  } catch {
    // Ignorar
  }
  return false;
}

// 4. Sincronizar cola pendiente hacia la PC
let sincronizando = false;
export async function sincronizarColaConPC() {
  if (sincronizando) return;
  const cola = getQueue();
  if (cola.length === 0) return;

  const online = await checkPCServer();
  if (!online) return;

  sincronizando = true;
  const urlBase = getServerUrl();
  const restantes = [...cola];

  for (const item of cola) {
    try {
      const res = await originalFetch(`${urlBase}${item.path}`, {
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

// 5. Barra inferior con diagnóstico y botón de carga local
function actualizarBarraEstado() {
  let bar = document.getElementById("mpf-status-bar");
  if (!bar && document.body) {
    bar = document.createElement("div");
    bar.id = "mpf-status-bar";
    bar.style.cssText =
      "position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:6px 10px;font-size:11px;font-family:sans-serif;display:flex;justify-content:space-between;align-items:center;color:#fff;box-shadow:0 -2px 6px rgba(0,0,0,0.3);gap:6px;";
    document.body.appendChild(bar);
  }
  if (!bar) return;

  const pendientes = getQueue().length;
  bar.style.background = ultimoEstadoOnline ? "#15803d" : "#b91c1c";
  bar.innerHTML = `
    <span id="mpf-ip-label" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
      ${ultimoEstadoOnline ? `🟢 Online (Cola: ${pendientes})` : `🔴 Offline (${pendientes}) -${detalleEstado}`}
    </span>
    <button id="mpf-btn-seed" style="background:#fbbf24;color:#111;border:none;border-radius:4px;padding:4px 7px;font-weight:bold;font-size:11px;">
      📦 Cargar Local
    </button>
    <button id="mpf-btn-sync" style="background:#fff;color:#111;border:none;border-radius:4px;padding:4px 7px;font-weight:bold;font-size:11px;">
      🔄 Sincronizar
    </button>
  `;

  // Si tocas el texto de estado, te permite cambiar la IP por si tu router la cambió
  const ipLabel = document.getElementById("mpf-ip-label");
  if (ipLabel) {
    ipLabel.onclick = () => {
      const actual = localStorage.getItem("mpf_server_ip") || DEFAULT_IP;
      const nueva = prompt("IP de tu PC donde corre el servidor (puerto 3001):", actual);
      if (nueva) {
        localStorage.setItem("mpf_server_ip", nueva.trim());
        checkPCServer();
      }
    };
  }

  // Botón para restaurar/forzar los datos de db.json en el celular
  const btnSeed = document.getElementById("mpf-btn-seed");
  if (btnSeed) {
    btnSeed.onclick = () => {
      sembrarDatosIniciales(true);
      window.location.reload();
    };
  }

  // Botón para conectar con la PC, subir pendientes y bajar datos nuevos
  const btnSync = document.getElementById("mpf-btn-sync");
  if (btnSync) {
    btnSync.onclick = async () => {
      btnSync.innerText = "⏳...";
      const ok = await checkPCServer();
      if (ok) {
        await sincronizarColaConPC();
        await descargarTodoDesdePC();
        window.location.reload();
      } else {
        actualizarBarraEstado();
      }
    };
  }
}

// 6. Interceptor global de fetch
export function activarModoOffline() {
  sembrarDatosIniciales(false);

  window.fetch = async (input, options = {}) => {
    const urlStr = typeof input === "string" ? input : input?.url || "";

    if (!urlStr.includes(":3001")) {
      return originalFetch(input, options);
    }

    const urlBase = getServerUrl();
    const partes = urlStr.split(":3001");
    const pathAndQuery = partes[1] || "/";
    const [pathname, queryString] = pathAndQuery.split("?");
    const segmentos = pathname.split("/").filter(Boolean);
    const coleccion = segmentos[0];
    const itemId = segmentos[1];
    const method = (options.method || "GET").toUpperCase();
    const cacheKey = `mpf_cache_${coleccion}`;

    // --- LECTURA (GET) ---
    if (method === "GET") {
      if (ultimoEstadoOnline) {
        try {
          const res = await originalFetch(`${urlBase}${pathAndQuery}`, { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            if (!itemId && !queryString) {
              localStorage.setItem(cacheKey, JSON.stringify(data));
            }
            return crearRespuestaJSON(data);
          }
        } catch {
          ultimoEstadoOnline = false;
          actualizarBarraEstado();
        }
      }

      // Leer del almacenamiento local del teléfono
      let localData = [];
      try {
        const raw = localStorage.getItem(cacheKey);
        localData = raw ? JSON.parse(raw) : dbInicial[coleccion] || [];
      } catch {
        localData = dbInicial[coleccion] || [];
      }

      if (itemId) {
        const encontrado = Array.isArray(localData)
          ? localData.find((x) => String(x.id) === String(itemId))
          : localData;
        return crearRespuestaJSON(encontrado || {});
      }

      if (queryString && Array.isArray(localData)) {
        const params = new URLSearchParams(queryString);
        params.forEach((valor, clave) => {
          localData = localData.filter((item) => String(item[clave]) === String(valor));
        });
      }

      return crearRespuestaJSON(localData);
    }

    // --- ESCRITURA (POST, PUT, PATCH, DELETE) ---
    const bodyData = options.body ? JSON.parse(options.body) : null;
    let localData = JSON.parse(
      localStorage.getItem(cacheKey) || JSON.stringify(dbInicial[coleccion] || [])
    );
    let respuestaLocal = bodyData;

    if (method === "POST") {
      respuestaLocal = { ...bodyData, id: bodyData?.id || String(Date.now()) };
      if (Array.isArray(localData)) localData.push(respuestaLocal);
    } else if (method === "PUT" || method === "PATCH") {
      if (Array.isArray(localData)) {
        localData = localData.map((item) => {
          if (String(item.id) === String(itemId)) {
            respuestaLocal =
              method === "PUT" ? { ...bodyData, id: item.id } : { ...item, ...bodyData };
            return respuestaLocal;
          }
          return item;
        });
      }
    } else if (method === "DELETE") {
      if (Array.isArray(localData)) {
        localData = localData.filter((item) => String(item.id) !== String(itemId));
      }
      respuestaLocal = {};
    }
    localStorage.setItem(cacheKey, JSON.stringify(localData));

    const online = await checkPCServer();
    if (online) {
      await sincronizarColaConPC();
      try {
        const res = await originalFetch(`${urlBase}${pathAndQuery}`, {
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

  window.addEventListener("DOMContentLoaded", () => {
    actualizarBarraEstado();
    checkPCServer();
  });
  setTimeout(() => {
    actualizarBarraEstado();
    checkPCServer();
  }, 800);

  setInterval(async () => {
    const online = await checkPCServer();
    if (online && getQueue().length > 0) {
      await sincronizarColaConPC();
    }
  }, 5000);
}

activarModoOffline();