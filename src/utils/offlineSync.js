// src/utils/offlineSync.js
import dbInicial from "../../db.json";

const PC_API_URL = "http://192.168.1.119:3001";
const QUEUE_KEY = "mpf_sync_queue";
const originalFetch = window.fetch.bind(window);

// 1. Sembrar los datos de tu db.json en la memoria del teléfono
function inicializarCacheDesdeSemilla() {
  if (!dbInicial) return;
  Object.keys(dbInicial).forEach((coleccion) => {
    const key = `mpf_cache_${coleccion}`;
    const actual = localStorage.getItem(key);
    // Si no existe o quedó guardado como array vacío "[]", carga los datos de db.json
    if (!actual || actual === "[]") {
      localStorage.setItem(key, JSON.stringify(dbInicial[coleccion]));
    }
  });
}

const getQueue = () => JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
const saveQueue = (q) => localStorage.setItem(QUEUE_KEY, JSON.stringify(q));

// 2. Verificar si la PC está alcanzable en el puerto 3001
export async function checkPCServer() {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1500);
    const res = await originalFetch(`${PC_API_URL}/productos`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(id);
    return res.ok;
  } catch {
    return false;
  }
}

// 3. Subir cambios acumulados a la PC
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
}

// 4. Redirigir todas las llamadas al puerto 3001
export function activarModoOffline() {
  inicializarCacheDesdeSemilla();

  window.fetch = async (input, options = {}) => {
    const urlStr = typeof input === "string" ? input : input.url;

    // Detectar cualquier llamada al puerto 3001 (sea localhost o 192.168.1.119)
    if (!urlStr.includes(":3001")) {
      return originalFetch(input, options);
    }

    const urlObj = new URL(urlStr, PC_API_URL);
    const path = urlObj.pathname + urlObj.search;
    const segmentos = urlObj.pathname.split("/").filter(Boolean);
    const coleccion = segmentos[0];
    const itemId = segmentos[1];
    const method = (options.method || "GET").toUpperCase();
    const cacheKey = `mpf_cache_${coleccion}`;

    // --- LECTURA (GET) ---
    if (method === "GET") {
      const online = await checkPCServer();
      if (online) {
        await sincronizarColaConPC();
        try {
          const res = await originalFetch(`${PC_API_URL}${path}`);
          if (res.ok) {
            const data = await res.clone().json();
            if (!itemId) {
              localStorage.setItem(cacheKey, JSON.stringify(data));
            }
            return res;
          }
        } catch {
          // Si falla la red, cae al respaldo local de abajo
        }
      }

      // Si no pudo conectar a la PC, entrega los datos guardados en el celular
      const localData = JSON.parse(
        localStorage.getItem(cacheKey) || JSON.stringify(dbInicial[coleccion] || [])
      );
      const resultado = itemId
        ? localData.find((x) => String(x.id) === String(itemId)) || {}
        : localData;

      return new Response(JSON.stringify(resultado), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // --- ESCRITURA (POST, PUT, PATCH, DELETE) ---
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
        const res = await originalFetch(`${PC_API_URL}${path}`, {
          ...options,
          method,
          headers: { "Content-Type": "application/json" },
          body: method !== "DELETE" ? JSON.stringify(respuestaLocal) : undefined,
        });
        if (res.ok) return res;
      } catch {
        // Pasa a la cola
      }
    }

    const cola = getQueue();
    cola.push({
      path,
      method,
      body: method !== "DELETE" ? respuestaLocal : null,
      timestamp: Date.now(),
    });
    saveQueue(cola);

    return new Response(JSON.stringify(respuestaLocal), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  setInterval(async () => {
    const online = await checkPCServer();
    if (online && getQueue().length > 0) {
      await sincronizarColaConPC();
    }
  }, 5000);
}